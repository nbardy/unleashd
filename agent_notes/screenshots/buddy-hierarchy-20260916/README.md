# Buddy hierarchy review — 16 September 2026

Reviewed the mobile directory and all eight Buddy detail routes against the owner's screenshot. Changes are local in the running Vite client, uncommitted in the existing shared working tree.

## Screenshot → improve → screenshot → reflect → improve

Baseline: names, descriptions, controls and labels used similar contrast; directory avatars competed with names; Settings exposed nested forms; Mailbox led with delivery diagnostics; Work mixed finished tasks with current work. The initial captures of Chats, Team and Memory caught loading states, so those were recaptured after network idle before review.

First pass: stronger name/title contrast and scale, quieter project labels and metadata, smaller avatars, restrained separators, request-first Mailbox, and collapsible execution receipts. Split current and completed work into a shared derived atom.

Reflection: the first directory pass was too airy. Settings was still a wall of forms. The memory audience select overflowed its content width and used native browser styling. These became the second pass: tighter groups, expandable Settings sections, bounded themed form controls, and a smaller memory editor. Narrow screenshots then exposed a wrapping Background tasks navigation label; mobile now uses Tasks. Desktop Work also received expandable tasks and the same current/completed partition.

## Verification

- Captured all nine mobile views before, after pass 1, and after refinement at 390×844.
- Captured all nine at 320×740; browser geometry sweep found zero elements beyond the viewport. Expanded recurring settings also had zero horizontal overflow.
- Captured and visually reviewed all nine desktop views at 1440×1000 for shared-component regressions. The desktop directory's existing card design was retained.
- `pnpm -C client exec tsc -b`: passed.
- `bash tools/check-client-invariants.sh`: all six gates passed.
- Existing tests for messages, team receipts, conversation links, memory, CSS classes and CSS tokens: 20 passed. Updated the rendered mailbox-copy assertion to match the shorter introduction.
- Browser error list was empty during the mobile review.

## Screenshot index

| View | Before | First pass | Final 390px | 320px | Desktop |
|---|---|---|---|---|---|
| Directory | [View](before/directory.png) | [View](pass1/directory.png) | [View](final/directory.png) | [View](narrow/directory.png) | [View](desktop/directory.png) |
| Conversations | [View](before/conversations.png) | [View](pass1/conversations.png) | [View](final/conversations.png) | [View](narrow/conversations.png) | [View](desktop/conversations.png) |
| Work | [View](before/work.png) | [View](pass1/work.png) | [View](final/work.png) | [View](narrow/work.png) | [View](desktop/work.png) |
| Team | [View](before/team.png) | [View](pass1/team.png) | [View](final/team.png) | [View](narrow/team.png) | [View](desktop/team.png) |
| Mailbox | [View](before/mailbox.png) | [View](pass1/mailbox.png) | [View](final/mailbox.png) | [View](narrow/mailbox.png) | [View](desktop/mailbox.png) |
| Background | [View](before/background.png) | [View](pass1/background.png) | [View](final/background.png) | [View](narrow/background.png) | [View](desktop/background.png) |
| Memory | [View](before/memory.png) | [View](pass1/memory.png) | [View](final/memory.png) | [View](narrow/memory.png) | [View](desktop/memory.png) |
| Settings | [View](before/settings.png) | [View](pass1/settings.png) | [View](final/settings.png) | [View](narrow/settings.png) | [View](desktop/settings.png) |
| Automations | [View](before/automations.png) | [View](pass1/automations.png) | [View](final/automations.png) | [View](narrow/automations.png) | [View](desktop/automations.png) |

[Expanded settings at 320px](narrow/settings-expanded.png)
