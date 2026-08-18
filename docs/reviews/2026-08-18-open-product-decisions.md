# Two open product decisions — 2026-08-18

Both came out of the mobile audit. Both are **product/UX calls, not bugs**, so
they are written up rather than fixed. Each has a recommendation, but the choice
is yours.

---

## D1 — `AskUserQuestion` options do nothing when tapped

### What happens today

An assistant message can carry an `<!--ask_user_question:…-->` block
(`server/src/adapters/tool-format.ts:333`). Desktop renders it as a widget with
clickable options (`client/src/components/AskUserQuestion.tsx:82-90`). Tapping
one calls `toggle()`, which writes **local `useState` only** — it highlights,
and nothing is ever sent. There is no submit control, no WS command, no
`onSelect` prop. The component's own docstring calls itself "display-only"
(`AskUserQuestion.tsx:7`).

Mobile renders the same options as a plain `<ul>` of `<li>` labels
(`client/src/mobile/components/MessageRow.tsx:143-169`) — inert, but at least
honest about it.

### Why this is the worst finding in the audit

The desktop control **looks like it worked**. It latches to a selected state, so
a user reasonably believes they answered. The agent is still blocked waiting.
The only recovery is realising the click did nothing and retyping the answer in
the composer. Silence plus a convincing affordance is worse than no affordance.

### Options

**A. Make it real — selection queues the answer as a message.**
Tapping an option (or Submit, for multi-select) sends the chosen label(s) through
the existing `queueMessage` / `interruptAndSend` path, exactly as if typed.
- *Pros:* the affordance finally means what it appears to mean; one code path;
  works on both trees; no protocol change.
- *Cons:* the agent receives free text, so it must still parse the answer — this
  is not a structured tool-result round trip. Wording of the synthesised message
  matters (send the raw label? `"<question>: <label>"`?). Multi-select and
  free-text "other" need a decision.
- *Effort:* small — one handler plus a mobile widget.

**B. Structured answer over the WS protocol.**
Add an `answer_user_question` client command carrying the question id and chosen
option ids; the server injects a proper tool result.
- *Pros:* the agent gets unambiguous structured input; correct in principle.
- *Cons:* touches shared schema, server, and the harness seam; needs a question
  id that survives a reload; much larger change. The adapter currently emits the
  block as a *comment in message text*, so there is no id to answer against
  without a format change.
- *Effort:* large.

**C. Make it honestly inert on both trees.**
Render options as non-interactive chips with a line like "answer in the message
box below", and delete the selection state.
- *Pros:* smallest change; removes the lie immediately; no new semantics.
- *Cons:* leaves a manual step that clearly wants to be one tap.
- *Effort:* trivial.

### Recommendation

**C now, A next.** C is minutes of work and stops actively misleading people;
A is the version worth building, and it is small. B is only worth it if you want
the model to receive genuinely structured answers, which is a bigger question
about the tool-format seam.

**Needs your call on (for A):** exactly what text gets sent — bare label, or
question + label — and whether multi-select sends one message or several.

---

## D2 — Human approvals cannot be resolved from a phone

### What happens today

Buddy automations can raise an approval request that blocks further work.
Desktop resolves it in `client/src/components/buddies/BuddyAutomationsTab.tsx:81-123`
→ `POST /api/buddies/approvals/:approvalId/resolve` (server route at
`server/src/buddies/routes.ts:145`).

Mobile loads `employee.approvals` (`BuddyDetailMobile.tsx:130`) and then **never
passes it to any tab**. The mobile Automations tab does not even declare it as a
prop. So a pending approval is invisible on mobile, and the only way to clear it
is to open a laptop.

### Why it matters

This is the human-in-the-loop stop for risky agent actions. A gate that can only
be cleared from a desktop turns "check on my agents from my phone" into "walk to
my desk". It is the one workflow where the phone is the *natural* device — you
are away, the agent needs a yes/no.

### The real question: what may a phone approve?

Approving is a privileged, sometimes irreversible action, and the phone is the
least-protected surface (no auth on the LAN dev server today). Three postures:

**A. Full parity — approve/reject on mobile exactly as desktop.**
- *Pros:* solves the workflow completely; consumes an endpoint that already
  exists; small change (thread the prop, render a card with two buttons).
- *Cons:* a one-tap irreversible approval on an unauthenticated LAN surface. No
  confirmation step, no audit of *where* it came from.
- *Effort:* small.

**B. Parity plus friction.** Same, but destructive/irreversible approvals get a
confirm step, and the resolve call records the origin (device/session).
- *Pros:* keeps the workflow while making the risky path deliberate; the audit
  trail answers "who approved this from where".
- *Cons:* needs a notion of which approvals are "risky" — either a server-side
  flag on the approval, or a blunt confirm-on-everything.
- *Effort:* medium; needs a server field if you want real classification.

**C. Visibility only.** Mobile shows pending approvals and their detail, but
resolving stays desktop-only, with an explicit "resolve on desktop" note.
- *Pros:* removes the *surprise* (today you cannot even see you are blocked)
  with no new risk surface.
- *Cons:* still a walk to the desk; arguably the worst of both — you learn you
  are blocked and cannot act.
- *Effort:* trivial.

### Recommendation

**B**, defaulting to a confirm step on every approval until there is a risk flag
worth branching on. A is defensible if you treat the LAN dev server as trusted —
but note that is the same surface that currently has no auth at all, which is
worth deciding deliberately rather than by omission.

**Needs your call on:** whether the phone may resolve approvals at all; if yes,
whether every approval gets a confirm or only flagged ones; and whether the
resolve call should record its origin.

---

## Not in this document

Everything else from the audit that is a plain bug has either been fixed or is
listed in `2026-08-18-mobile-feature-audit.md` under "confirmed, not fixed" with
a file:line and a suggested fix. These two are here specifically because
implementing them without a decision would be designing product by default.
