# Conversation-first Buddy detail — September 16, 2026

Owner requested a leaner individual Buddy page with conversations as the default.

Implemented in the existing desktop and mobile views:
- Mobile redirects the bare Buddy URL to conversations, matching desktop.
- Shared navigation exposes Chats, Work, Team and a More disclosure for Mailbox,
  Background tasks, Memory, Automations and Settings. All remain real routes.
- Shared conversation rows replace large status cards. Rows show available message
  text, relative activity and live Running state, ordered running-first then recent.
  Missing preview text gets a dated fallback. Deleted/unavailable threads are not links.
- One new-chat action, compact mobile header, collapsed About details. Desktop
  execution profile moved to Settings; mobile model editing remains inside chat.
- Derived Jotai projection owns ordering and deduplication; rows subscribe per ID.

Validation:
- Client `tsc -b` passed.
- Five conversation/navigation render tests passed, including completion reordering,
  duplicate rows and stale-link guards.
- All six client invariant gates passed; scoped git diff whitespace check passed.
- Live browser at localhost:7489, 390×844 mobile and 1440×1000 desktop.
  Bare Buddy URL redirected to conversations; More → Memory and Back preserved routes.
- Screenshots: mobile.png and desktop.png (real Product Development Lead data).

Preview text comes from the existing conversation snapshot; it may be the latest
assistant preview when full history is not hydrated. No transcript fetch fan-out
or separate title persistence was added. No backend restart or deployment required.

Existing shared checkout changes were preserved; no commit or push performed.
