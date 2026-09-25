//! Team admin: creating buddies and changing their profile, manager, limits and status. Owner
//! only (`Op::Admin`); a buddy never edits the team (02 §8.3 `team_admin`).

use crate::error::{CoreError, Result};
use crate::store::{Mutation, Store, get_buddy, idempotent, new_id, now_iso, require};
use crate::types::*;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::json;

impl Store {
    /// Registers a folder as a workspace. The root path is the natural key: registering the same
    /// folder again returns the existing workspace.
    pub fn create_workspace(&mut self, actor: &Actor, input: WorkspaceInput) -> Result<Workspace> {
        self.write(|tx| {
            require(tx, actor, Op::Admin, &Subject::Owner)?;
            if let Some(found) = workspace_at(tx, &input.root_path)? {
                return Ok(found);
            }
            let id = new_id("project");
            let m = Mutation {
                actor,
                workspace_id: &id,
                buddy_id: None,
                task_id: None,
                op: "workspace.create",
                payload: json!({"name": input.name, "root_path": input.root_path}),
                key: None,
            };
            idempotent(tx, &m, |tx| {
                tx.execute(
                    "INSERT INTO workspace (id, name, root_path, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![id, input.name, input.root_path, now_iso()],
                )?;
                Ok(id.clone())
            })?;
            workspace_at(tx, &input.root_path)?.ok_or_else(|| CoreError::not_found("workspace", &id))
        })
    }

    pub fn create_buddy(&mut self, actor: &Actor, input: BuddyCreate) -> Result<Buddy> {
        self.write(|tx| {
            require(tx, actor, Op::Admin, &Subject::Owner)?;
            let m = Mutation {
                actor,
                workspace_id: &input.workspace_id,
                buddy_id: None,
                task_id: None,
                op: "buddy.create",
                payload: json!({"slug": input.slug, "name": input.name, "role": input.role, "manager": manager_id(&input.manager),
                    "provider": input.provider, "model": input.model, "effort": input.reasoning_effort,
                    "background": input.background_enabled}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| {
                if let ManagerRef::Buddy { id } = &input.manager {
                    get_buddy(tx, id)?;
                }
                let id = new_id("buddy");
                tx.execute(
                    "INSERT INTO buddy (id, workspace_id, slug, name, role, status, manager_id, provider, model, reasoning_effort,
                       background_enabled, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        id,
                        input.workspace_id,
                        input.slug,
                        input.name,
                        input.role,
                        manager_id(&input.manager),
                        input.provider,
                        input.model,
                        input.reasoning_effort,
                        input.background_enabled,
                        now_iso()
                    ],
                )?;
                Ok(id)
            })?;
            get_buddy(tx, &id)
        })
    }

    pub fn update_buddy(&mut self, actor: &Actor, input: BuddyUpdate) -> Result<Buddy> {
        self.write(|tx| {
            require(tx, actor, Op::Admin, &Subject::Owner)?;
            let buddy = get_buddy(tx, &input.buddy_id)?;
            let c = &input.changes;
            let m = Mutation {
                actor,
                workspace_id: &buddy.workspace_id,
                buddy_id: Some(&buddy.id),
                task_id: None,
                op: "buddy.update",
                payload: json!({"name": c.name, "role": c.role, "manager": c.manager.as_ref().map(manager_id),
                    "provider": c.provider, "model": c.model, "effort": c.reasoning_effort, "background": c.background_enabled,
                    "max_active_runs": c.max_active_runs, "status": c.status.map(BuddyStatus::as_str)}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| {
                if let Some(ManagerRef::Buddy { id }) = &c.manager {
                    reject_cycle(tx, &buddy.id, id)?;
                }
                tx.execute(
                    "UPDATE buddy SET name = coalesce(?2, name), role = coalesce(?3, role),
                       manager_id = CASE ?4 WHEN 1 THEN ?5 ELSE manager_id END,
                       provider = coalesce(?6, provider), model = coalesce(?7, model), reasoning_effort = coalesce(?8, reasoning_effort),
                       background_enabled = coalesce(?9, background_enabled), max_active_runs = coalesce(?10, max_active_runs),
                       status = coalesce(?11, status)
                     WHERE id = ?1",
                    params![
                        buddy.id,
                        c.name,
                        c.role,
                        c.manager.is_some(),
                        c.manager.as_ref().and_then(manager_id),
                        c.provider,
                        c.model,
                        c.reasoning_effort,
                        c.background_enabled,
                        c.max_active_runs,
                        c.status
                    ],
                )?;
                archive_side_effects(tx, &buddy.id, c.status)?;
                Ok(buddy.id.clone())
            })?;
            get_buddy(tx, &id)
        })
    }
}

fn workspace_at(conn: &Connection, root_path: &str) -> Result<Option<Workspace>> {
    Ok(conn
        .prepare_cached("SELECT id, name, root_path, created_at FROM workspace WHERE root_path = ?1")?
        .query_row([root_path], |r| Ok(Workspace { id: r.get(0)?, name: r.get(1)?, root_path: r.get(2)?, created_at: r.get(3)? }))
        .optional()?)
}

fn manager_id(manager: &ManagerRef) -> Option<&str> {
    match manager {
        ManagerRef::Nobody => None,
        ManagerRef::Buddy { id } => Some(id),
    }
}

/// A buddy cannot report to itself or to anyone who (transitively) reports to it.
fn reject_cycle(conn: &Connection, buddy: &str, manager: &str) -> Result<()> {
    get_buddy(conn, manager)?;
    let sql = "WITH RECURSIVE up(id) AS (
                 SELECT ?1 UNION SELECT b.manager_id FROM buddy b JOIN up ON b.id = up.id WHERE b.manager_id IS NOT NULL)
               SELECT EXISTS(SELECT 1 FROM up WHERE id = ?2)";
    let cycles: bool = conn.prepare_cached(sql)?.query_row(params![manager, buddy], |r| r.get(0))?;
    match cycles {
        true => Err(CoreError::Invalid(format!("{buddy} cannot report to {manager}: that is a reporting cycle"))),
        false => Ok(()),
    }
}

/// Archiving a buddy cancels its queued runs: an archived buddy is never claimed again, so they
/// would otherwise stay queued forever. Running runs end when their runner settles them.
fn archive_side_effects(tx: &Transaction, buddy: &str, status: Option<BuddyStatus>) -> Result<()> {
    match status {
        Some(BuddyStatus::Archived) => {
            tx.execute(
                "UPDATE run SET status = 'cancelled', error_code = 'archived', error = 'the buddy was archived', ended_at = ?2
                 WHERE buddy_id = ?1 AND status = 'queued'",
                params![buddy, now_iso()],
            )?;
            Ok(())
        }
        Some(BuddyStatus::Active) | None => Ok(()),
    }
}
