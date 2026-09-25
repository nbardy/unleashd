//! Posts: every message, channel post and task comment is a post in a channel (DESIGN B.2; owner
//! decision T06b: "direct messages between two buddies or messages to a channel … the same table
//! and the same data type"). A channel is public, direct (a member set) or a task's.
//!
//! A `Request` lives in a direct channel. The other members owe the answer, and each buddy among
//! them gets a `Post` run. The answer is an ordinary post (`reply_to_id` = the request, in its
//! thread). `answer` inserts it, flips the request to answered and queues the `Reply` run back to
//! Pattern: one-write-path (docs/patterns.md#one-write-path)
//! a buddy author, all in one transaction.

use crate::error::{CoreError, Result};
use crate::runs::Enqueue;
use crate::store::{Mutation, Store, collect, corrupt, get_buddy, idempotent, new_id, now_iso, require};
use crate::tasks::get_task;
use crate::types::*;
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params, params_from_iter};
use serde_json::json;

const POST_COLS: &str = "p.id, p.channel_id, p.author_id, p.root_id, p.reply_to_id, p.task_id, p.purpose, p.body, p.evidence, \
    p.request, p.answer_id, p.conversation_id, p.return_conversation_id, p.created_at, p.ord";

fn post_row(r: &Row) -> rusqlite::Result<Post> {
    let request = match (r.get::<_, Option<String>>(9)?.as_deref(), r.get::<_, Option<String>>(10)?) {
        (None, None) => RequestState::None,
        (Some("awaiting"), None) => RequestState::Awaiting,
        (Some("answered"), Some(answer_id)) => RequestState::Answered { answer_id },
        (Some("cancelled"), None) => RequestState::Cancelled,
        (Some("failed"), None) => RequestState::Failed,
        (state, answer) => return Err(corrupt(CoreError::Corrupt(format!("request {state:?} with answer {answer:?}")))),
    };
    Ok(Post {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        author: Actor::from_nullable(r.get(2)?),
        root_id: r.get(3)?,
        reply_to_id: r.get(4)?,
        task_id: r.get(5)?,
        purpose: r.get(6)?,
        body: r.get(7)?,
        evidence: parse_evidence(&r.get::<_, String>(8)?).map_err(corrupt)?,
        request,
        conversation_id: r.get(11)?,
        return_conversation_id: r.get(12)?,
        created_at: r.get(13)?,
        ord: r.get(14)?,
    })
}

pub(crate) fn get_post(conn: &Connection, id: &str) -> Result<Post> {
    conn.prepare_cached(&format!("SELECT {POST_COLS} FROM post p WHERE p.id = ?1"))?
        .query_row([id], post_row)
        .optional()?
        .ok_or_else(|| CoreError::not_found("post", id))
}

const CHANNEL_COLS: &str = "c.id, c.workspace_id, c.kind, c.name, c.purpose, c.member_key, c.task_id, c.created_by, c.created_at";

fn channel_row(r: &Row) -> rusqlite::Result<Channel> {
    let kind = match (r.get::<_, String>(2)?.as_str(), r.get(3)?, r.get(4)?, r.get::<_, Option<String>>(5)?, r.get(6)?) {
        ("public", Some(name), Some(purpose), None, None) => ChannelKind::Public { name, purpose },
        ("direct", None, None, Some(key), None) => ChannelKind::Direct { members: members_of(&key) },
        ("task", None, None, None, Some(task_id)) => ChannelKind::Task { task_id },
        (kind, ..) => return Err(corrupt(CoreError::Corrupt(format!("channel kind {kind:?} with the columns of another kind")))),
    };
    Ok(Channel { id: r.get(0)?, workspace_id: r.get(1)?, kind, created_by: Actor::from_nullable(r.get(7)?), created_at: r.get(8)? })
}

pub(crate) fn get_channel(conn: &Connection, id: &str) -> Result<Channel> {
    find_channel(conn, "id", id)?.ok_or_else(|| CoreError::not_found("channel", id))
}

/// `column` is a unique key of `channel`: id, member_key or task_id.
fn find_channel(conn: &Connection, column: &str, value: &str) -> Result<Option<Channel>> {
    Ok(conn
        .prepare_cached(&format!("SELECT {CHANNEL_COLS} FROM channel c WHERE c.{column} = ?1"))?
        .query_row([value], channel_row)
        .optional()?)
}

/// The channel a ref names. A direct or task channel is created on first use; the unique keys
/// (member_key, task_id) and the write lock keep it to one per member set and per task.
fn open_channel(tx: &Connection, actor: &Actor, channel: &ChannelRef) -> Result<Channel> {
    match channel {
        ChannelRef::Id { id } => get_channel(tx, id),
        ChannelRef::Direct { members } => direct_channel(tx, actor, members),
        ChannelRef::Task { task_id } => task_channel(tx, actor, task_id),
    }
}

/// A direct channel is listed in its creator's workspace (the first buddy member's when the owner
/// creates it). Membership, not the workspace, decides who may read and post.
fn direct_channel(tx: &Connection, actor: &Actor, members: &[Actor]) -> Result<Channel> {
    let key = member_key(members);
    if let Some(found) = find_channel(tx, "member_key", &key)? {
        return Ok(found);
    }
    let members = members_of(&key);
    for id in members.iter().filter_map(Actor::buddy_id) {
        get_buddy(tx, id)?;
    }
    let home = actor
        .buddy_id()
        .or_else(|| members.iter().find_map(Actor::buddy_id))
        .ok_or_else(|| CoreError::Invalid("a direct channel needs a buddy member".into()))?;
    let id = new_id("dm");
    tx.execute(
        "INSERT INTO channel (id, workspace_id, kind, member_key, created_by, created_at) VALUES (?1, ?2, 'direct', ?3, ?4, ?5)",
        params![id, get_buddy(tx, home)?.workspace_id, key, actor.buddy_id(), now_iso()],
    )?;
    for member in &members {
        tx.execute("INSERT INTO channel_member (channel_id, member) VALUES (?1, ?2)", params![id, member.key()])?;
    }
    get_channel(tx, &id)
}

fn task_channel(tx: &Connection, actor: &Actor, task_id: &str) -> Result<Channel> {
    if let Some(found) = find_channel(tx, "task_id", task_id)? {
        return Ok(found);
    }
    let task = get_task(tx, task_id)?;
    let id = new_id("tc");
    tx.execute(
        "INSERT INTO channel (id, workspace_id, kind, task_id, created_by, created_at) VALUES (?1, ?2, 'task', ?3, ?4, ?5)",
        params![id, task.workspace_id, task.id, actor.buddy_id(), now_iso()],
    )?;
    get_channel(tx, &id)
}

/// What a new post asks of the channel. Only a direct channel has members to owe an answer.
enum Ask {
    Inform,
    Request { owed_by: Vec<Actor> },
}

fn ask(kind: PostKind, channel: &Channel, author: &Actor) -> Result<Ask> {
    match (kind, &channel.kind) {
        (PostKind::Inform, _) => Ok(Ask::Inform),
        (PostKind::Request, ChannelKind::Direct { members }) => {
            let others: Vec<Actor> = members.iter().filter(|m| *m != author).cloned().collect();
            // A channel with only the author in it is a note to self: the author owes the answer.
            let owed_by = if others.is_empty() { vec![author.clone()] } else { others };
            Ok(Ask::Request { owed_by })
        }
        (PostKind::Request, other) => Err(CoreError::Invalid(format!("a request needs a direct channel, got {other:?}"))),
    }
}

impl Ask {
    fn column(&self) -> Option<&'static str> {
        match self {
            Ask::Inform => None,
            Ask::Request { .. } => Some("awaiting"),
        }
    }
    fn owed_by(&self) -> &[Actor] {
        match self {
            Ask::Inform => &[],
            Ask::Request { owed_by } => owed_by,
        }
    }
}

impl Store {
    pub fn post(&mut self, actor: &Actor, channel: ChannelRef, input: PostInput) -> Result<Post> {
        self.write(|tx| {
            let channel = open_channel(tx, actor, &channel)?;
            require(tx, actor, Op::Post, &Subject::Channel { id: channel.id.clone() })?;
            let m = Mutation {
                actor,
                workspace_id: &channel.workspace_id,
                buddy_id: actor.buddy_id(),
                task_id: input.task_id.as_deref(),
                op: "post",
                payload: json!({"channel": channel.id, "kind": input.kind.as_str(), "body": input.body, "purpose": input.purpose,
                    "evidence": input.evidence, "reply_to": input.reply_to_id, "task": input.task_id}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| insert_post(tx, actor, &channel, &input))?;
            get_post(tx, &id)
        })
    }

    /// Answers a request: the answer post, the request's flip to answered and the `Reply` run back
    /// to a buddy author commit together or not at all.
    pub fn answer(&mut self, actor: &Actor, input: AnswerInput) -> Result<Post> {
        self.write(|tx| {
            let request = get_post(tx, &input.request_id)?;
            let workspace_id = get_channel(tx, &request.channel_id)?.workspace_id;
            require(tx, actor, Op::Post, &Subject::Channel { id: request.channel_id.clone() })?;
            let m = Mutation {
                actor,
                workspace_id: &workspace_id,
                buddy_id: actor.buddy_id(),
                task_id: request.task_id.as_deref(),
                op: "answer",
                payload: json!({"request": request.id, "body": input.body, "evidence": input.evidence}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| {
                // Insert, then flip only an awaiting request. A request that is no longer awaiting fails
                // the flip, and the error rolls the answer back with the transaction: one answer each.
                let ord = crate::ids::next().to_string();
                let id = format!("post_{ord}");
                tx.execute(
                    "INSERT INTO post (id, channel_id, author_id, root_id, reply_to_id, task_id, body, evidence, created_at, ord)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        id,
                        request.channel_id,
                        actor.buddy_id(),
                        request.root_id.as_deref().unwrap_or(&request.id),
                        request.id,
                        request.task_id,
                        input.body,
                        evidence_json(&input.evidence),
                        now_iso(),
                        ord
                    ],
                )?;
                let flipped = tx.execute(
                    "UPDATE post SET request = 'answered', answer_id = ?2 WHERE id = ?1 AND request = 'awaiting'",
                    params![request.id, id],
                )?;
                if flipped != 1 {
                    return Err(CoreError::Invalid(format!("post {} is not awaiting an answer: {:?}", request.id, request.request)));
                }
                notify_author(tx, &request)?;
                Ok(id)
            })?;
            get_post(tx, &id)
        })
    }

    pub fn get_post(&self, actor: &Actor, id: &str) -> Result<Post> {
        let post = get_post(&self.conn, id)?;
        require(&self.conn, actor, Op::ReadChannel, &Subject::Channel { id: post.channel_id.clone() })?;
        Ok(post)
    }

    /// Finds (or, for a direct or task channel, creates) the channel a ref names.
    pub fn open_channel(&mut self, actor: &Actor, channel: ChannelRef) -> Result<Channel> {
        self.write(|tx| {
            let channel = open_channel(tx, actor, &channel)?;
            require(tx, actor, Op::ReadChannel, &Subject::Channel { id: channel.id.clone() })?;
            Ok(channel)
        })
    }

    /// Newest first, keyset-paged on the ordered id (never on `created_at`, which ties).
    pub fn list_posts(&self, actor: &Actor, query: PostQuery, before: Option<Cursor>, limit: i64) -> Result<PostPage> {
        let (channel_id, filter, mut args): (String, &str, Vec<Value>) = match query {
            PostQuery::Channel { channel_id } => (channel_id.clone(), "p.channel_id = ? AND p.root_id IS NULL", vec![channel_id.into()]),
            PostQuery::Thread { root_id } => (get_post(&self.conn, &root_id)?.channel_id, "p.root_id = ?", vec![root_id.into()]),
        };
        require(&self.conn, actor, Op::ReadChannel, &Subject::Channel { id: channel_id })?;
        let keyset = match before {
            None => "",
            Some(Cursor { ord }) => {
                args.push(ord.into());
                " AND p.ord < ?"
            }
        };
        args.push((limit + 1).into());
        let sql = format!("SELECT {POST_COLS} FROM post p WHERE {filter}{keyset} ORDER BY p.ord DESC LIMIT ?");
        let mut posts = collect(self.conn.prepare_cached(&sql)?.query_map(params_from_iter(args), post_row)?)?;
        let next = (posts.len() as i64 > limit).then(|| {
            posts.truncate(limit as usize);
            posts.last().map(|p| Cursor { ord: p.ord.clone() })
        });
        Ok(PostPage { posts, next: next.flatten() })
    }

    /// Requests the actor owes (across workspaces), its own open requests, and its channels in
    /// `workspace_id` with unread counts.
    pub fn inbox(&self, actor: &Actor, workspace_id: &str) -> Result<Inbox> {
        let (me, my_buddy) = (actor.key(), actor.buddy_id());
        let requests = collect(
            self.conn
                .prepare_cached(&format!(
                    "SELECT {POST_COLS} FROM channel_member m JOIN channel c ON c.id = m.channel_id
                       JOIN post p ON p.channel_id = m.channel_id AND p.request = 'awaiting'
                     WHERE m.member = ?1 AND (p.author_id IS NOT ?2 OR c.member_key = ?1) ORDER BY p.ord"
                ))?
                .query_map(params![me, my_buddy], post_row)?,
        )?;
        let waiting_on = collect(
            self.conn
                .prepare_cached(&format!(
                    "SELECT {POST_COLS} FROM post p WHERE p.author_id IS ?1 AND p.request = 'awaiting' ORDER BY p.ord"
                ))?
                .query_map([my_buddy], post_row)?,
        )?;
        let channels = collect(
            self.conn
                .prepare_cached(&format!(
                    "SELECT {CHANNEL_COLS}, (SELECT count(*) FROM post p WHERE p.channel_id = c.id AND p.author_id IS NOT ?3
                        AND p.ord > coalesce(r.last_ord, ''))
                     FROM channel c LEFT JOIN post_read r ON r.reader = ?1 AND r.channel_id = c.id
                     WHERE c.workspace_id = ?2 AND (c.kind = 'public' OR r.reader IS NOT NULL
                       OR EXISTS (SELECT 1 FROM channel_member m WHERE m.member = ?1 AND m.channel_id = c.id))
                     ORDER BY c.kind, c.name, c.created_at"
                ))?
                .query_map(params![me, workspace_id, my_buddy], |r| Ok(ChannelUnread { channel: channel_row(r)?, unread: r.get(9)? }))?,
        )?;
        Ok(Inbox { requests, waiting_on, channels })
    }

    /// Posts in `workspace_id` whose body contains every word of `query` (literal words, not FTS
    /// syntax), newest first, from the channels the actor may read: public and task channels, and
    /// the direct channels it is a member of (the owner reads every one).
    pub fn search_posts(&self, actor: &Actor, workspace_id: &str, query: &str, limit: i64) -> Result<Vec<Post>> {
        require(&self.conn, actor, Op::SearchPosts, &Subject::Owner)?;
        let words: Vec<String> = query.split_whitespace().map(|w| format!("\"{}\"", w.replace('"', "\"\""))).collect();
        if words.is_empty() {
            return Err(CoreError::Invalid("an empty search".into()));
        }
        let sql = format!(
            "SELECT {POST_COLS} FROM post_search s JOIN post p ON p.rowid = s.rowid JOIN channel c ON c.id = p.channel_id
             WHERE post_search MATCH ?1 AND c.workspace_id = ?2
               AND (?3 = 'owner' OR c.kind != 'direct'
                    OR EXISTS (SELECT 1 FROM channel_member m WHERE m.channel_id = c.id AND m.member = ?3))
             ORDER BY p.ord DESC LIMIT ?4"
        );
        collect(self.conn.prepare_cached(&sql)?.query_map(params![words.join(" "), workspace_id, actor.key(), limit], post_row)?)
    }

    /// Moves the actor's cursor forward to `post_id`; an older post never moves it back.
    pub fn mark_read(&mut self, actor: &Actor, channel_id: &str, post_id: &str) -> Result<()> {
        self.write(|tx| {
            require(tx, actor, Op::ReadChannel, &Subject::Channel { id: channel_id.to_string() })?;
            let post = get_post(tx, post_id)?;
            if post.channel_id != channel_id {
                return Err(CoreError::Invalid(format!("post {post_id} is not in channel {channel_id}")));
            }
            tx.execute(
                "INSERT INTO post_read (reader, channel_id, last_post_id, last_post_at, last_ord, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(reader, channel_id) DO UPDATE SET last_post_id = excluded.last_post_id,
                   last_post_at = excluded.last_post_at, last_ord = excluded.last_ord, updated_at = excluded.updated_at
                 WHERE excluded.last_ord > post_read.last_ord",
                params![actor.key(), channel_id, post.id, post.created_at, post.ord, now_iso()],
            )?;
            Ok(())
        })
    }

    pub fn create_channel(&mut self, actor: &Actor, input: ChannelInput) -> Result<Channel> {
        self.write(|tx| {
            require(tx, actor, Op::CreateChannel, &Subject::Owner)?;
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
                    "INSERT INTO channel (id, workspace_id, kind, name, purpose, created_by, created_at) VALUES (?1, ?2, 'public', ?3, ?4, ?5, ?6)",
                    params![id, input.workspace_id, input.name, input.purpose, actor.buddy_id(), now_iso()],
                )?;
                Ok(id)
            })?;
            get_channel(tx, &id)
        })
    }

    /// The workspace's public channels.
    pub fn list_channels(&self, workspace_id: &str) -> Result<Vec<Channel>> {
        let sql = format!("SELECT {CHANNEL_COLS} FROM channel c WHERE c.workspace_id = ?1 AND c.kind = 'public' ORDER BY c.name");
        collect(self.conn.prepare_cached(&sql)?.query_map([workspace_id], channel_row)?)
    }
}

fn insert_post(tx: &Transaction, actor: &Actor, channel: &Channel, input: &PostInput) -> Result<String> {
    let ask = ask(input.kind, channel, actor)?;
    let root_id = input.reply_to_id.as_deref().map(|parent| thread_root(tx, parent, &channel.id)).transpose()?;
    let ord = crate::ids::next().to_string();
    let id = format!("post_{ord}");
    tx.prepare_cached(
        "INSERT INTO post (id, channel_id, author_id, root_id, reply_to_id, task_id, purpose, body, evidence, request,
           conversation_id, return_conversation_id, created_at, ord)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
    )?
    .execute(params![
        id,
        channel.id,
        actor.buddy_id(),
        root_id,
        input.reply_to_id,
        input.task_id,
        input.purpose,
        input.body,
        evidence_json(&input.evidence),
        ask.column(),
        // Provenance: the conversation the post was written from. A thread seat reads it to skip
        // its own posts. Only a request's answer returns to it.
        input.from_conversation_id,
        ask.column().and(input.from_conversation_id.as_deref()),
        now_iso(),
        ord
    ])?;
    for recipient in ask.owed_by().iter().filter_map(Actor::buddy_id) {
        tx.enqueue(EnqueueInput {
            buddy_id: recipient.to_string(),
            input: RunInput::Post { post_id: id.clone() },
            conversation_id: None,
            task_id: input.task_id.clone(),
            after_run_id: None,
            deadline: None,
        })?;
    }
    Ok(id)
}

/// A reply joins its parent's thread, which must be in the same channel.
fn thread_root(tx: &Transaction, parent_id: &str, channel_id: &str) -> Result<String> {
    let parent = get_post(tx, parent_id)?;
    match parent.channel_id == channel_id {
        true => Ok(parent.root_id.unwrap_or(parent.id)),
        false => Err(CoreError::Invalid(format!("post {parent_id} is in another channel"))),
    }
}

/// An answer goes back to a buddy author as a `Reply` run; the owner reads it in the UI.
fn notify_author(tx: &Transaction, request: &Post) -> Result<()> {
    match &request.author {
        Actor::Owner => Ok(()),
        Actor::Buddy { id } => tx
            .enqueue(EnqueueInput {
                buddy_id: id.clone(),
                input: RunInput::Reply { post_id: request.id.clone() },
                conversation_id: request.return_conversation_id.clone(),
                task_id: request.task_id.clone(),
                after_run_id: None,
                deadline: None,
            })
            .map(|_| ()),
    }
}
