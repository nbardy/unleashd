# Owner correction: files, Mail and inherited Buddy memory

September 13, 2026. Owner-selected simplification, formalized by Buddies
Development Lead. This supersedes the Document object, knowledge tools, discovery
workflow and catalog counts in [v2](03-v2.md), its [MCP contract](04-mcp-contract.md)
and its [removal map](05-code-and-removal-map.md). Their execution, Task, reporting
and supervision proposals remain available for review; this correction does not
make all of those proposals owner-accepted. Runtime implementation is separate.

## The information model

**Mail tells someone now. An agent note leaves knowledge for later discovery.**

Mail is directed: send information, a question, feedback or a file reference to a
named recipient through the existing inbox/delivery mechanism. Notes are durable
Markdown files that agents can write, find and read without choosing a recipient.
Writing a note does not itself send Mail or request execution. Send Mail when
someone needs the information now; include the note path when detail lives there.
This clarifies the information channels without adding another execution verb.

Reuse the existing convention exactly:

```text
agent_notes/{optional_group}/{datetime}_{topic}.md
```

For example:

```text
agent_notes/buddies/20260913T063000Z_worker-memory-decision.md
```

The group is an ordinary optional directory. Date and topic make filenames useful
for filtering; the Markdown body makes content searchable. Use normal file
creation, reading and search. No note registration, opaque document ID, custom
search operation, publication step or mandatory metadata schema is needed.

A brief or deliverable is also a normal file, located where that work belongs.
Mail, Tasks and reports carry file paths; use a commit or content hash when the
recipient needs an exact historical version. A path can be useful without first
becoming an application resource. Notes preserve reasoning and learning; Tasks
continue to own current assignments, status, blockers and completion evidence.

The core product objects are now **Buddy, Task, Mail and human Conversation**.
Worker remains a temporary parent-owned Buddy mode. Files are files; remove
Document from the managed object inventory.

## Workers inherit the Buddy memory system

A Worker goes through the same memory initialization, context injection,
background review and subsequent-turn refresh as an ordinary Buddy. Reuse that
code path and its existing lifecycle. No Worker-specific memory implementation,
reviewer type, second knowledge store or foreground memory-maintenance ritual.

Agents may leave useful detailed notes during work using ordinary file tools.
The background reviewer curates compact memory and uses those same note files as
detailed evidence. Its note persistence/search should converge on `agent_notes`,
not retain a parallel managed-note collection. Compact-memory maintenance remains
the existing Buddy system's responsibility; it is not part of employee MCP.

The runtime supplies the applicable memory context and file locations. Worker
creation must actually attach the ordinary Buddy memory lifecycle; it must not
silently omit review because the Worker executes in a background lane. This
reuses the existing rules for which completed turns receive review.

The owner's instruction selects a common memory system. It does not require
rewriting the compact-memory storage backend as part of the Worker design.
Applicable file access continues to come from the execution environment; a group
directory organizes notes and is not a new access-control object.

## Delete the employee knowledge API

| Remove | Replacement |
|---|---|
| `remember_note` | Write `agent_notes/.../{datetime}_{topic}.md` with ordinary file tools |
| `recall` | Find and search note files with ordinary file tools |
| `get_document` | Read the file; compact Buddy memory arrives through existing context injection |
| `update_document` | Edit work files normally; background memory curation remains internal |
| Managed shared/note Document object and publication/discovery workflow | Files and references in Mail, Tasks or reports |
| Instructions to read/preview/apply memory changes during normal work | Existing automatic Buddy memory process |
| Separate Worker memory setup or maintenance tools | Ordinary Buddy memory lifecycle |

Remove these four tools from all employee profiles, rather than keeping them as
optional fallbacks or renaming them. Owner identity/profile editing and the
reviewer's compact-memory internals stay in their existing dedicated flows; they
do not justify a general employee Document API. The managed shared/note artifact
path should be retired after preserving existing content as files.

## Revised employee catalog

This is v2's remaining catalog after the four explicit removals. The owner has
selected the information simplification; the other tool shapes remain proposals.
No claim is made that 21 is the final irreducible tool count.

| Profile | Tools | Count |
|---|---|---|
| Worker/basic work | `get_current_work`, `update_task`, `get_inbox`, `get_message`, `mail`, `report`, `get_team_state`, `stop` | 8 |
| Lead coordination | Worker/basic tools plus `new_task`, `list_buddies`, `get_capabilities`, `create_worker`, `prompt`, `retire_buddy` | 14 total |
| Granted administration/diagnostics | Additional `get_runs`, `get_profile`, `update_profile`, `create_buddy`, `set_relationship`, `get_automations`, `set_automation` | 7 additional; union 21 |

Normal coding/file tools are supplied by the harness, not replicated in Buddy
MCP. The retained tools' execution and work semantics are specified in the
[v2 contract](04-mcp-contract.md); references there to keeping the four removed
tools and to managed Documents are superseded by this page.

## Code and removal changes to the v2 map

| Area | Required change |
|---|---|
| Employee MCP catalog, schemas and `operations.ts` routing | Delete the four tools, their aliases and employee knowledge-dispatch cases; publish the reduced profiles |
| `integration.ts` and Worker initialization | Reuse ordinary Buddy memory composition/refresh; replace note/document operation instructions with the filesystem convention |
| `knowledge.ts`, `resources.ts`, shared document schemas and package knowledge paths | Retire employee shared/note resource creation, publishing and discovery; preserve compact-memory consumers until they use the ordinary memory internals directly |
| Existing memory review pipeline | Same lifecycle for ordinary Buddies and Workers; note reads/writes use the common files; preserve the reviewer mandate and compact-memory behavior |
| Owner/Builder flows and memory UI | Keep identity editing and existing memory inspection in their own flows; do not require the removed employee artifact API or add a Documents product |
| Mail, Task evidence and report checkpoints | Reference ordinary files; no document-registration prerequisite |
| Existing stored shared/note content | Export once to the existing filename convention and preserve old references for history; stop new writes through the old note/document path |

This is a deletion plan, not a reason to create a filesystem-backed replica of
`get_document`, `recall` or `remember_note`. The existing memory reviewer remains
restricted to its maintenance work; ordinary Workers use their normal file tools.

## What implementation must demonstrate

1. A Worker writes a note using ordinary file tools. Another Buddy finds it by
   group, filename or content and reads it without any Buddy knowledge call.
2. Mail delivers a directed reference to that file without registering a Document.
3. A completed Worker turn uses the same background memory-review path as an
   ordinary Buddy; subsequent Worker turns receive the resulting compact memory.
4. Employee catalogs and briefings contain none of the four removed operations,
   including aliases and optional profiles. Existing notes remain accessible.

These are future implementation checks. This revision changes the design and
records the owner decision; it does not claim those runtime checks have passed.

The [decision note](../../../agent_notes/buddies/20260913T063400Z_files-mail-memory-simplification.md)
preserves the owner's wording, previous recommendation, rationale and source
versions. [Pre-change evidence](files-mail-before.json) preserves v1/v2 hashes
and the previous entry-point contents.
