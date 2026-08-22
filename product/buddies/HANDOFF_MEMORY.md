# HANDOFF_MEMORY.md — Buddy memory design, for review

*Date: 2026-08-21 · Branch: `mobile-fixes-and-audit-2026-08-18` · Prepared by: Buddies Development Lead*
*Status: design complete and committed. **Nothing is built.** No runtime code changed.*

You are reviewing a design, not a diff. Everything below is documentation.

---

## 1. What to read, in order

| # | Doc | Why |
|---|---|---|
| 1 | `product/buddies/PLANNING_MEMORY.md` | The design. 603 lines, 20 sections. |
| 2 | `agent_notes/2026-08-21_memory-architecture-research_buddies-development-lead.md` | Every measurement and external comparison the design rests on. |
| 3 | `product/buddies/PLANNING_PRIMITIVES.md` | Locked decisions that constrain this design (§19 reconciles against it). |
| 4 | `agent_notes/2026-08-21_buddy-automations-reference.md` | The scheduler this design deliberately does not lean on. |

Commits: `941b240` → `d1a7759` → `d9794c1` → `2d70078`. Nothing pushed.

## 2. The design in six lines

- **Two primitives**: a `versioned_doc` (rewritten, chain is history) and an
  `append_note` (written once, directory is history).
- **Four layers**: `BUDDY_SOUL.md` (human), `LONG_TERM_MEMORY.md`,
  `WORKING_MEMORY.md`, `agent_notes/`. **Density is the axis** — the three docs
  are dense because they are always injected; notes are verbose because nothing
  loads them.
- **Three verbs**: `remember`, `recall`, `update_memory`.
- `recall` is **ripgrep**, not an index. The filename is the index.
- Caps are **write-time invariants**, not read-time truncation.
- Concurrent writes use **compare-and-swap**, not last-write-wins.

## 3. Verify the claims — do not trust them

Every load-bearing number is reproducible. Please re-run at least the first two.

```bash
# The memory system is unused (claim: 6 files, 24 KB, 4 of 16 buddies)
cd ~/git/buddies/profiles && for d in */memory; do
  printf "%-22s files=%s %s\n" "$d" "$(find $d -type f | wc -l)" "$(du -sh $d | cut -f1)"; done

# agent_notes is what agents actually do
git ls-files agent_notes/ | wc -l

# Transcripts: 43.5 GB, top 100 files are 62%, conversation is ~1% of bytes
du -sh ~/.codex/sessions ~/.claude/projects

# Defect D1 — truncation keeps the HEAD while writes append to the TAIL
sed -n '19,22p;233,240p' server/src/buddies/integration.ts

# Defect D2 — journal read walks back 7 CALENDAR days from today
sed -n '2505,2517p' ~/git/buddies/src/store.js

# Soul has no update path anywhere
rg -n "soul" ~/git/buddies/src/store.js | rg -i "write|update"
```

## 4. What is locked, and what is not

**Locked by the owner in conversation** — do not relitigate without new evidence:

- Long-term memory is **per-buddy**, not per-repo.
- The append-only layer is `agent_notes/`, file-separated, buddy slug in the
  filename.
- Notes are **never auto-injected**. Pull-only.
- Souls evolve **only on explicit request**, never autonomously; immutable prior
  versions with justifications, current as a pointer.
- `product/` is organised **per workstream**, `agent_notes/` stays flat.

**Open — eight decisions in §18.** The two that most need an owner: cap values,
and whether `remember` auto-commits each note.

## 5. Where I would attack this design

Ranked. I believe the design is right, but these are its soft spots and a review
that does not press on them has not reviewed it.

1. **The whole thing assumes discretionary writes work.** The current system also
   relies on a buddy choosing to call `remember`, and it has accumulated 24 KB in
   months. If buddies do not write notes, this design degrades to exactly what
   exists. The mitigation is the automatic review at conversation end (§8) — but
   that is the one component with no proof it produces good working memory,
   because it has never been run. **This is the highest risk in the design.**
2. **Caps are guesses.** 2 KB working / 8 KB long-term came from judgement, not
   measurement. Too tight and the review thrashes; too loose and the layers
   collapse into each other. Nothing validates them yet.
3. **Density-as-axis is asserted.** It is a clean principle, but no one has run a
   buddy under it. The failure to watch for is working memory drifting into
   long-term memory's job (§15 F4).
4. **`recall` assumes buddies write decent `rg` patterns.** Untested. If they
   write bad regexes, "no index" stops looking like simplicity.
5. **Operation count is +1** against a primitives doc that forbids proliferation.
   §19 argues memory reads have no verb at all today so this is not the
   proliferation being forbidden. Push on that if you disagree — it is the one
   place two locked directions rub.
6. **Rewrite can drop facts.** The chain preserves history, but the live doc can
   omit and only `reasoning` explains why. Accepted cost (§11), not a solved one.
7. **The soul chain needs `profiles/<slug>/` provisioning**, which is currently
   broken on the Lead itself. Slice 4 depends on an Owner decision already on the
   sprint board.

## 6. Sequencing

Four slices in §17. Slices 1 and 2 are independently shippable, fix live defects,
and need no migration:

- **Slice 1** — write-time caps + typed rejection. Kills D1 by construction.
- **Slice 2** — `remember` writes to `agent_notes/`; `recall` ships as `rg`.
  **Dissolves the "Lead memory path" blocker** on the sprint board: `remember`
  stops depending on `memory_path` at all.

Migration cost is ~zero: 24 KB across 6 files, and 12 of 16 buddies have no
memory.

**Sequencing note:** the primitives handoff records *"no continuity across
scheduled runs — memory is the only carrier."* Memory is on the critical path for
the wait/loop work, not adjacent to it. Do not schedule it after.

## 7. Repo state you are inheriting

Committed and clean: everything in §1.

**Still untracked, not mine to commit** — at risk in this shared checkout, which
has already lost a verified changeset to a concurrent `git reset`:

```
agent_notes/2026-08-20_buddy-mcp-harness-boundary.md
agent_notes/2026-08-20_buddy-mcp-partial.patch        ← removed 2026-08-22; it was not a real patch
agent_notes/2026-08-21_buddy-automations-reference.md ← AGENTS.md links this; the link dangles
agent_notes/2026-08-21_turn-lifecycle-RFR.md
agent_notes/2026-08-21_turn-lifecycle-design.md
vendor/agent-cli-tool                                 ← 4 dirty files
.buddies/
```

Two traps in there:

- **`AGENTS.md` links a file that is not in the repo.** The automations reference
  is committed-linked but untracked. Either commit it or the index lies.
- **`buddy-mcp-partial.patch` was not a patch and was removed on 2026-08-22.**
  It had zero `@@` hunks — an rtk compressed summary saved to a `.patch` name.
  The work is the dirty submodule, not that artifact. Written up in
  `agent_notes/2026-08-21_rtk-diff-is-not-a-patch_buddies-development-lead.md`.

Also fixed in passing: `.gitignore` had `product/**` with `!product/*.md`, which
re-includes the **top level only**. Foldering the docs silently re-ignored three
of them. The negation now covers subdirectories — if you add a `product/` subfolder,
that rule is why it works.

## 8. If you only do one thing

Read `PLANNING_MEMORY.md` §14 (use cases) and §16 (rejected alternatives). §14 is
where the design either obviously works or obviously does not. §16 is where you
find out whether a "why didn't you just…" has already been answered with
measurements.
