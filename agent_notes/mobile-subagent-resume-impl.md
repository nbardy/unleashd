# Mobile sub-agent / resume UI wiring — ConversationView

Date: 2026-08-20
Branch: mobile-fixes-and-audit-2026-08-18 (commit 0d7ec84 base)

## Objective
Wire desktop `Chat.tsx:43,44` sub-agent/resume affordances into `mobile/conversations/ConversationView.tsx`, reusing shared derivation and rendering with `mobile-ui` primitives per `docs/mobile-view-tree.md`.

## What was missing
`ConversationView.tsx` rendered only flat `MessageRow` list + `ForkButton`. It was missing all four desktop affordances:
- `SubAgentPanel` (unified sub-agents)
- `SwarmConvoPrefix` (swarm debug prefix)
- `ResumeThreadWidget` (fork lineage)
- `MergeProgressStrip` (merge-parent review progress)
Derivation via `buildUnifiedSubAgents` (`utils/subAgents.ts`) and `virtualizedMessageList` grouping + `effectiveSwarmDebugPrefix` was desktop-only.

## Implementation
Single-file change: `client/src/mobile/conversations/ConversationView.tsx`

### Data derivation — reused, not duplicated
- `import { buildUnifiedSubAgents } from '../../utils/subAgents'` — same util as `Chat.tsx:41`.
- `import { effectiveSwarmDebugPrefix } from '../../components/buddies/ui-contract'` — allowed `components/buddies/` exception per G3. Called with `getBuddyContext(conversation)` + `conversation.kind` + `conversation.swarmDebugPrefix`, identical suppression rule as desktop (buddy kinds suppress swarm prefix).
- `import { childConversationsAtomFamily, conversationAtomFamily }` — per-ID atoms, same subscriptions as `Chat.tsx:101`. `unifiedSubAgents = buildUnifiedSubAgents(conversation, childConversations)` memoized identically.
- `resumedFromConversationId` + `resumedFromConversation` via `conversationAtomFamily(resumedFromConversationId)` — mirrors `Chat.tsx:109`.
- `parseStatsFromPrefix` from `utils/swarmConvoParsers` (mobile-allowed `utils/` path, not `components/SwarmConvoPrefix`).

No duplication of sub-agent merging logic; no new atoms.

### Rendering — mobile primitives, not desktop view tree
Per task: use `MobileSection`/`MobileSurface`/`MobileBadge` from `mobile/components/MobileUI.tsx`, not `VirtualizedMessageList`.

Four local helpers inside same file (no `components/*` imports, so G3 holds):
- `MobileMergeProgressStrip` + `MergeChip` — reads `mergeChildStatusAtomFamily` / `mergeChildErrorAtomFamily` per child (same atoms as `MergeProgressStrip`). Renders as `MobileSection title="Reviews"` with `MobileBadge` chips (`accent` complete, `active` spinning, `neutral` error).
- `MobileSubAgentPanel` — partitions `running|pending` vs last 3 `completed|error` like `SubAgentPanel.tsx`, renders each as `MobileSurface` card with status badge and `description`/`currentAction`/`toolUses`/`tokens`.
- `MobileResumeWidget` — renders `resumedFrom` as `MobileSection` + linked `MobileSurface` card (`Link to /chat/:id`), showing short ID, provider badge, and tilde-shortened folder. Mirrors `ResumeThreadWidget` contract.
- `MobileSwarmPrefix` — collapsed by default (desktop is expanded; mobile defaults collapsed to save vertical space). Uses `parseStatsFromPrefix` for chips/rows, shows `Runs`/`Project`/`Primary Config` + stat grid + collapsible `<details>Raw CLI context</details>`.

Layout order mirrors `Chat.tsx:806-844`: merge strip first, then sub-agents, then resume, then swarm prefix — all inside a `mobile-chat__thread-context` grid inserted between header and `mobile-chat__messages`. Flat `MessageRow` list is unchanged (no `VirtualizedMessageList`).

Not imported: `SubAgentPanel`, `SwarmConvoPrefix`, `ResumeThreadWidget`, `MergeProgressStrip`, `VirtualizedMessageList` — keeps G3 PASS.

### Kept sharing
`useConversationDraft` and `usePendingAttachments` remain owned by `ComposerMobile` (same hooks `Chat.tsx` uses), unchanged. No inline draft/attachment state introduced.

### Respect for `docs/mobile-view-tree.md`
- Allowed imports only: `atoms/*`, `hooks/*`, `utils/*`, `shared/*`, `components/buddies/{ui-contract}`. No `components/*.tsx` or CSS.
- Pane still fills parent (`mobile-chat` inside `.mobile-content--pane`), not viewport — layout contract preserved.
- `ChatMobile` remains a thin wrapper; logic lives in `ConversationView` so embedded buddy threads get it.

## Gates
`bash tools/check-client-invariants.sh` — G1-G5 PASS (verified).
`npx tsc --noEmit --project client/tsconfig.json` — PASS.

## Files
- `client/src/mobile/conversations/ConversationView.tsx` — wired utils + four mobile panels.
- `agent_notes/mobile-subagent-resume-impl.md` — this note.

## Risks / follow-ups
- Swarm prefix collapsed default diverges from desktop expanded default — intentional for viewport; consider persisting via `localStorage` if users expect expanded.
- No virtualized list — large swarms (many workers) render full `MobileSection` stats; acceptable for mobile v1.
- Stale link `/swarms/project` noted in `docs/mobile-view-tree.md` — not copied to mobile.
