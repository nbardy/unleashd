//! Posts: messages, channel posts and task comments are one table (DESIGN B.2). A `Request` to a
//! buddy owes a reply and queues a `Post` run for the recipient; the reply queues a `Reply` run
//! back to the sender.

use crate::error::{CoreError, Result};
use crate::runs::Enqueue;
use crate::store::{Mutation, Store, collect, corrupt, get_buddy, idempotent, new_id, now_iso, require};
use crate::types::*;
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params, params_from_iter};
use serde_json::json;

const POST_COLS: &str = "id, workspace_id, author_id, target_kind, target_id, root_id, reply_to_id, task_id, purpose, \
    body, evidence, reply_state, reply_body, reply_evidence, replied_at, conversation_id, return_conversation_id, created_at";

fn post_row(r: &Row) -> rusqlite::Result<Post> {
    let reply = match r.get::<_, Option<String>>(11)?.as_deref() {
        None => Reply::NotOwed,
        Some("awaiting") => Reply::Awaiting,
        Some("replied") => Reply::Replied {
            body: r.get(12)?,
            evidence: parse_evidence(&r.get::<_, String>(13)?).map_err(corrupt)?,
            replied_at: r.get(14)?,
        },
        Some("cancelled") => Reply::Cancelled,
        Some("failed") => Reply::Failed,
        Some(other) => return Err(corrupt(CoreError::Corrupt(format!("reply_state {other:?}")))),
    };
    Ok(Post {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        author: Actor::from_nullable(r.get(2)?),
        target: Target::from_columns(&r.get::<_, String>(3)?, r.get(4)?).map_err(corrupt)?,
        root_id: r.get(5)?,
        reply_to_id: r.get(6)?,
        task_id: r.get(7)?,
        purpose: r.get(8)?,
        body: r.get(9)?,
        evidence: parse_evidence(&r.get::<_, String>(10)?).map_err(corrupt)?,
        reply,
        conversation_id: r.get(15)?,
        return_conversation_id: r.get(16)?,
        created_at: r.get(17)?,
    })
}

pub(crate) fn get_post(conn: &Connection, id: &str) -> Result<Post> {
    conn.prepare_cached(&format!("SELECT {POST_COLS} FROM post WHERE id = ?1"))?
        .query_row([id], post_row)
        .optional()?
        .ok_or_else(|| CoreError::not_found("post", id))
}

fn one(conn: &Connection, sql: &str, id: &str, kind: &'static str) -> Result<String> {
    conn.prepare_cached(sql)?.query_row([id], |r| r.get(0)).optional()?.ok_or_else(|| CoreError::not_found(kind, id))
}

/// The workspace a post lives in follows from its target (and, for the owner, from the author).
fn post_workspace(tx: &Connection, actor: &Actor, target: &Target) -> Result<String> {
    match (target, actor) {
        (Target::Buddy { id }, _) => Ok(get_buddy(tx, id)?.workspace_id),
        (Target::Channel { id }, _) => one(tx, "SELECT workspace_id FROM channel WHERE id = ?1", id, "channel"),
        (Target::Task { id }, _) => one(tx, "SELECT workspace_id FROM task WHERE id = ?1", id, "task"),
        (Target::Owner, Actor::Buddy { id }) => Ok(get_buddy(tx, id)?.workspace_id),
        (Target::Owner, Actor::Owner) => Err(CoreError::Invalid("the owner cannot post to the owner".into())),
    }
}

fn subject_of(target: &Target) -> Subject {
    match target {
        Target::Buddy { id } => Subject::Buddy { id: id.clone() },
        Target::Owner | Target::Channel { .. } | Target::Task { .. } => Subject::Owner,
    }
}

/// Only a buddy can owe a reply, so only a buddy can receive a `Request`.
fn initial_reply_state(kind: PostKind, target: &Target) -> Result<Option<&'static str>> {
    match (kind, target) {
        (PostKind::Inform, _) => Ok(None),
        (PostKind::Request, Target::Buddy { .. }) => Ok(Some("awaiting")),
        (PostKind::Request, other) => Err(CoreError::Invalid(format!("a request needs a buddy target, got {other:?}"))),
    }
}

impl Store {
    pub fn post(&mut self, actor: &Actor, input: PostInput) -> Result<Post> {
        self.write(|tx| {
            require(tx, actor, Op::Post, &subject_of(&input.target))?;
            let workspace_id = post_workspace(tx, actor, &input.target)?;
            let (target_kind, target_id) = input.target.columns();
            let m = Mutation {
                actor,
                workspace_id: &workspace_id,
                buddy_id: actor.buddy_id(),
                task_id: input.task_id.as_deref(),
                op: "post",
                payload: json!({"target": [target_kind, target_id], "kind": input.kind.as_str(), "body": input.body,
                    "purpose": input.purpose, "evidence": input.evidence, "reply_to": input.reply_to_id, "task": input.task_id}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| insert_post(tx, actor, &workspace_id, &input))?;
            get_post(tx, &id)
        })
    }

    pub fn reply(&mut self, actor: &Actor, input: ReplyInput) -> Result<Post> {
        self.write(|tx| {
            let post = get_post(tx, &input.post_id)?;
            require(tx, actor, Op::Reply, &subject_of(&post.target))?;
            let m = Mutation {
                actor,
                workspace_id: &post.workspace_id,
                buddy_id: actor.buddy_id(),
                task_id: post.task_id.as_deref(),
                op: "reply",
                payload: json!({"post": post.id, "body": input.body, "evidence": input.evidence}),
                key: Some(&input.key),
            };
            idempotent(tx, &m, |tx| {
                match &post.reply {
                    Reply::Awaiting => {}
                    other => return Err(CoreError::Invalid(format!("post {} does not await a reply: {other:?}", post.id))),
                }
                tx.execute(
                    "UPDATE post SET reply_state = 'replied', reply_body = ?2, reply_evidence = ?3, replied_at = ?4 WHERE id = ?1",
                    params![post.id, input.body, evidence_json(&input.evidence), now_iso()],
                )?;
                notify_author(tx, &post)?;
                Ok(post.id.clone())
            })?;
            get_post(tx, &input.post_id)
        })
    }

    /// Newest first, keyset-paged on (created_at, id).
    pub fn list_posts(&self, query: PostQuery, before: Option<Cursor>, limit: i64) -> Result<PostPage> {
        let (filter, mut args): (&str, Vec<Value>) = match query {
            PostQuery::Channel { channel_id } => ("target_kind = 'channel' AND target_id = ? AND root_id IS NULL", vec![channel_id.into()]),
            PostQuery::Thread { root_id } => ("root_id = ?", vec![root_id.into()]),
            PostQuery::Task { task_id } => ("target_kind = 'task' AND target_id = ?", vec![task_id.into()]),
            PostQuery::To { target } => {
                let (kind, id) = target.columns();
                ("target_kind = ? AND target_id IS ?", vec![kind.to_string().into(), id.map(str::to_string).into()])
            }
            PostQuery::From { author } => ("author_id IS ?", vec![author.buddy_id().map(str::to_string).into()]),
        };
        let keyset = match before {
            None => "",
            Some(Cursor { created_at, id }) => {
                args.extend([created_at.into(), id.into()]);
                " AND (created_at, id) < (?, ?)"
            }
        };
        args.push((limit + 1).into());
        let sql = format!("SELECT {POST_COLS} FROM post WHERE {filter}{keyset} ORDER BY created_at DESC, id DESC LIMIT ?");
        let mut posts = collect(self.conn.prepare_cached(&sql)?.query_map(params_from_iter(args), post_row)?)?;
        let next = (posts.len() as i64 > limit).then(|| {
            posts.truncate(limit as usize);
            posts.last().map(|p| Cursor { created_at: p.created_at.clone(), id: p.id.clone() })
        });
        Ok(PostPage { posts, next: next.flatten() })
    }

    pub fn inbox(&self, actor: &Actor, workspace_id: &str) -> Result<Inbox> {
        let me = match actor {
            Actor::Owner => Target::Owner,
            Actor::Buddy { id } => Target::Buddy { id: id.clone() },
        };
        let (kind, id) = me.columns();
        let requests = collect(
            self.conn
                .prepare_cached(&format!(
                    "SELECT {POST_COLS} FROM post WHERE target_kind = ?1 AND target_id IS ?2 AND reply_state = 'awaiting' ORDER BY created_at"
                ))?
                .query_map(params![kind, id], post_row)?,
        )?;
        let waiting_on = collect(
            self.conn
                .prepare_cached(&format!(
                    "SELECT {POST_COLS} FROM post WHERE author_id IS ?1 AND reply_state = 'awaiting' ORDER BY created_at"
                ))?
                .query_map([actor.buddy_id()], post_row)?,
        )?;
        let unread = collect(
            self.conn
                .prepare_cached(
                    "SELECT c.id, c.name, (SELECT count(*) FROM post p WHERE p.target_kind = 'channel' AND p.target_id = c.id
                        AND (p.created_at, p.id) > (coalesce(r.last_post_at, ''), coalesce(r.last_post_id, '')))
                     FROM channel c LEFT JOIN post_read r ON r.reader = ?1 AND r.channel_id = c.id
                     WHERE c.workspace_id = ?2 ORDER BY c.name",
                )?
                .query_map(params![actor.key(), workspace_id], |r| {
                    Ok(ChannelUnread { channel_id: r.get(0)?, name: r.get(1)?, unread: r.get(2)? })
                })?,
        )?;
        Ok(Inbox { requests, waiting_on, unread })
    }

    pub fn mark_read(&mut self, actor: &Actor, channel_id: &str, post_id: &str) -> Result<()> {
        self.write(|tx| {
            let post = get_post(tx, post_id)?;
            tx.execute(
                "INSERT INTO post_read (reader, channel_id, last_post_id, last_post_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(reader, channel_id) DO UPDATE SET last_post_id = excluded.last_post_id,
                   last_post_at = excluded.last_post_at, updated_at = excluded.updated_at",
                params![actor.key(), channel_id, post.id, post.created_at, now_iso()],
            )?;
            Ok(())
        })
    }

    pub fn create_channel(&mut self, actor: &Actor, input: ChannelInput) -> Result<Channel> {
        self.write(|tx| {
            require(tx, actor, Op::Post, &Subject::Owner)?;
            let m = Mutation {
                actor,
                workspace_id: &input.workspace_id,
                buddy_id: actor.buddy_id(),
                task_id: None,
                op: "channel.create",
                payload: json!({"name": input.name, "purpose": input.purpose}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| {
                let id = new_id("list");
                tx.execute(
                    "INSERT INTO channel (id, workspace_id, name, purpose, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![id, input.workspace_id, input.name, input.purpose, actor.buddy_id(), now_iso()],
                )?;
                Ok(id)
            })?;
            get_channel(tx, &id)
        })
    }

    pub fn list_channels(&self, workspace_id: &str) -> Result<Vec<Channel>> {
        let sql = format!("SELECT {CHANNEL_COLS} FROM channel WHERE workspace_id = ?1 ORDER BY name");
        collect(self.conn.prepare_cached(&sql)?.query_map([workspace_id], channel_row)?)
    }
}

const CHANNEL_COLS: &str = "id, workspace_id, name, purpose, created_by, created_at";

fn channel_row(r: &Row) -> rusqlite::Result<Channel> {
    Ok(Channel {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        name: r.get(2)?,
        purpose: r.get(3)?,
        created_by: Actor::from_nullable(r.get(4)?),
        created_at: r.get(5)?,
    })
}

fn get_channel(conn: &Connection, id: &str) -> Result<Channel> {
    Ok(conn.prepare_cached(&format!("SELECT {CHANNEL_COLS} FROM channel WHERE id = ?1"))?.query_row([id], channel_row)?)
}

fn insert_post(tx: &Transaction, actor: &Actor, workspace_id: &str, input: &PostInput) -> Result<String> {
    let reply_state = initial_reply_state(input.kind, &input.target)?;
    let root_id = input.reply_to_id.as_deref().map(|parent| thread_root(tx, parent, &input.target)).transpose()?;
    let id = new_id("post");
    let (target_kind, target_id) = input.target.columns();
    tx.prepare_cached(
        "INSERT INTO post (id, workspace_id, author_id, target_kind, target_id, root_id, reply_to_id, task_id, purpose, body,
           evidence, reply_state, return_conversation_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
    )?
    .execute(params![
        id,
        workspace_id,
        actor.buddy_id(),
        target_kind,
        target_id,
        root_id,
        input.reply_to_id,
        input.task_id,
        input.purpose,
        input.body,
        evidence_json(&input.evidence),
        reply_state,
        input.from_conversation_id,
        now_iso()
    ])?;
    if let (Some(_), Target::Buddy { id: recipient }) = (reply_state, &input.target) {
        tx.enqueue(EnqueueInput {
            buddy_id: recipient.clone(),
            input: RunInput::Post { post_id: id.clone() },
            conversation_id: None,
            task_id: input.task_id.clone(),
            after_run_id: None,
            deadline: None,
        })?;
    }
    Ok(id)
}

/// A reply joins its parent's thread, which must be on the same target.
fn thread_root(tx: &Transaction, parent_id: &str, target: &Target) -> Result<String> {
    let parent = get_post(tx, parent_id)?;
    match &parent.target == target {
        true => Ok(parent.root_id.unwrap_or(parent.id)),
        false => Err(CoreError::Invalid(format!("post {parent_id} is on a different target"))),
    }
}

/// A reply goes back to a buddy author as a `Reply` run; the owner reads it in the UI.
fn notify_author(tx: &Transaction, post: &Post) -> Result<()> {
    match &post.author {
        Actor::Owner => Ok(()),
        Actor::Buddy { id } => tx
            .enqueue(EnqueueInput {
                buddy_id: id.clone(),
                input: RunInput::Reply { post_id: post.id.clone() },
                conversation_id: post.return_conversation_id.clone(),
                task_id: post.task_id.clone(),
                after_run_id: None,
                deadline: None,
            })
            .map(|_| ()),
    }
}
