# Latest owner design and historical candidates

September 13, 2026 · Design review and dated work audit.

Start with [LATEST_HUMAN_DESIGN](../LATEST_HUMAN_DESIGN.md), the faithful formalization
of the current owner statement. Then read the [Worker and messaging successor](07-workers-mail-and-prompt-successor.md).
The current direction refines Design 1 with **Workers**: temporary ordinary
Buddies tied to one parent and able to carry several related tasks. Design 2's
task-owned lifetime is owner-rejected. The [three candidates](02-three-final-designs.md)
remain a historical comparison; Design 3 remains unselected.
The owner's later limit-review flow is incorporated in the shared
[check-ins and limits specification](../BUDGETS_AND_LIMITS.md). The latest
[check-in successor](08-check-ins-and-solo-sessions-successor.md) distinguishes
frequent progress updates from a maximum solo session requiring lead review. Read the
[handoff successor](06-handoff-and-limits-successor.md) for its relationship to
the pending delivery work and preserved worktrees.

| Document | Purpose |
|---|---|
| [Original owner statement](00-owner-statement.md) | Preserved wording and attribution |
| [Object inventory](01-object-inventory.md) | Every relevant current/proposed concept, what collapses and which boundaries survive |
| [Three final designs](02-three-final-designs.md) | Complete alternatives, comparison, recommended defaults, migration and acceptance |
| [Work and usage audit](03-work-and-usage-audit.md) | Current scoped work, stale claims, usage limits and uncovered cases |
| [Decision record](04-decision-record.md) | Prior rationale, current owner direction, assistant recommendation and reconsideration criteria |
| [Source evidence](05-source-evidence.md) | Dated preserved excerpts from 24 sources |
| [Native observations](native-observations.json) | Dated project revisions and bounded execution/receipt observations |
| [Source manifest](source-manifest.json) | Full-source and excerpt hashes |
| [Verification addendum](verification-addendum.md) | Concurrent memory-review edits and the limits of the original check |
| [Handoff and limits successor](06-handoff-and-limits-successor.md) | Owner follow-up, handoff incorporation and decision history |
| [Check-ins and limits](../BUDGETS_AND_LIMITS.md) | Single policy reference for supervision cadence, solo sessions and resource limits |
| [Consolidation verification](limits-consolidation-verification.json) | Fresh links, hashes and preserved-version checks |
| [Workers, Mail and Prompt successor](07-workers-mail-and-prompt-successor.md) | Latest owner feedback, Document explanation, revised ownership and proposed messaging split |
| [Pre-clarification sources](workers-mail-before.json) | Dated full content and hashes of the six documents before this successor |
| [Worker clarification verification](workers-mail-verification.json) | Local links, source integrity and append-only history checks |
| [Check-ins and solo sessions successor](08-check-ins-and-solo-sessions-successor.md) | Owner clarification, proposed supervision rules and pinned predecessor excerpts |

The proposed core types are Buddy, Task, Mail (correspondence Message), Document
and human Conversation. Prompt is a separate execution operation using the existing
input/attempt infrastructure; Worker reuses Buddy. Document means versioned content,
not a required new service or editor. Workspace, authorization and runtime accounting
remain explicit. A small domain vocabulary does not imply five database tables.

Your design does not need a replacement philosophy. It needs precise rules for
persistent identity, report delivery, lead review, effort boundaries and a few
existing system cases such as schedules and restricted memory maintenance.

This is documentation and native evidence recording. Candidate APIs are labeled
as proposed. Operator limit references now point to the shared specification;
their executable contract and runtime behavior have not changed. The original
artifact/verification manifests remain dated evidence; the successor verification
records the revised files.
