# M2 report: v33 → lean memory fold (lane/memory-import)

Commits: `2de05c7` (importer, export, verify, tests), a README commit, and `ea7dce7` (orchestrator decision: the soul is never folded by recency).
Shortstat vs 486a2d3: 6 files changed, 355 insertions(+), 98 deletions(-). `git status --porcelain` is clean.
Nothing was merged or pushed, and `crates/unleashd-buddies` (the M1 lane's crate) was not touched apart from its README.

## Revision after orchestrator decision (ea7dce7)
- Souls do not fold by recency. Only the v33 per-Buddy head can be the imported soul, and it must match SOUL.md as before.
  - `memory_copies` ranks the soul head first.
  - A new `winner` column is `rank = 1 AND (kind != 'soul' OR source = head)`. Import, export and verify all read `winner`, so a Buddy with only scoped soul copies gets no soul doc and has every copy archived.
- Thread, project and workspace soul copies are archived to `memory-archive.md`. Working/long_term fold is unchanged.
- `soul.folded` is removed. The soul-file check compares with the imported soul again (its 486a2d3 form).
- The fold test adds `k8`, a thread soul newer than Worker's head:
  - the head stays `mem_b2_soul`;
  - k8 is archived, giving Worker 4 sections;
  - `folded_copies` is 5.
- Main test: Lead's k1 is archived. `memory_fold_winners[0]` is now `mem_b2_long_term` (k3), and the `soul.folded` assert was removed.
- Real copy: `/Users/nicholasbardy/git/unleashd-lean-scope/memory/tmp-import2/` (left in place as instructed).
  - **Verify ok**: `doc:memory` 156→156, `doc_revision` 291→291, `memory_winners` 156/156, `memory_archive` 30/30, `revision_chains` 291 revisions / 156 docs.
  - Soul: match 45, match_no_header 4, no_path_empty 3.
  - 57 winners are not the head (the 4 thread souls are now archived). 524 folded copies in 30 files; Product Development Lead 113, Buddies Development Lead 94, Wave_sim CEO 50 (unchanged).
- Decision 4 below and the "soul" parts of the first run are superseded by this section.

## Changes
- `import.rs`
  - `memory_copies(db)` is the ranking query shared by import, export and verify. It lists every copy: the legacy head plus every `buddy_knowledge` copy of kind soul/working/long_term, in any scope. Copies are ranked per (buddy, kind) by `updated_at DESC`, and the head wins a tie.
  - `winner_chains(db)` returns each winner's own chain, renumbered 1..n with `row_number`. `legacy.source_revision` keeps the original revision number.
  - Rank 1 becomes `mem_<buddy>_<kind>` (scope `buddy`). Its `legacy` holds `source`, `source_id`, `scope_kind`, `scope_id` and `revision`. Non-winning copies are not imported.
  - Shared docs scoped to owner_thread or project become buddy scope (`scope_id` = buddy). Workspace-scoped shared docs stay workspace.
  - New domain checks abort the import on:
    - two non-workspace shared docs of one Buddy with the same name;
    - a `buddy_knowledge.kind` outside soul/working/long_term/shared/note.
  - Count pairs are now `doc:memory` (distinct buddy/kind), `doc:shared` and `doc_revision` (winner chains + shared).
  - The report no longer has `divergent_thread_souls`. It has `memory_fold_winners` (winners that are not the head) and `folded_copies`.
  - `register_sha256` is now shared.
- `notes.rs`
  - `archive_plan()` writes one `<home workspace root>/agent_notes/buddy-notes/<slug>/memory-archive.md` per Buddy. Each copy gets a section with updated_at, kind, scope, scope id, revision, source id and content, oldest first.
  - `NoteFile` gained `buddy_id`, and `notes` was renamed to `sections`.
  - The folder-collision check is factored into `buddy_folder`.
  - `export-notes` (main.rs) plans notes and archives together, so the existing refuse-if-any-exists rule covers both.
- `verify.rs`
  - Four classes were replaced (`memory_revisions_by_buddy_kind`, `memory_heads_by_buddy_kind`, `knowledge_docs_by_buddy_scope_kind`, `knowledge_revisions_by_buddy_scope_kind`). The new ones are:
    - `memory_winners_by_buddy_kind`: per (buddy, kind), the imported doc's id, scope and content equal the winner's, hash-compared.
    - `shared_docs_by_buddy_scope`.
  - `check_chains` now takes its old side from `winner_chains` plus the shared chains, so only winners are checked.
  - New `memory_archive` RowCheck: for each Buddy, (v33 copies − imported memory docs) must equal the sections `notes::archive_plan` gives that Buddy. The two sides are counted independently: source tables and imported docs on one side, the archive plan on the other.
  - Soul check: the soul file is now compared with the **v33 head** it was rendered from. A new, non-failing `soul.folded` lists Buddies whose imported soul is a newer thread copy. Lost and invented souls still fail. The other classes are unchanged.
- README
  - Deploy step 2 gained one paragraph on the fold and the archive.
  - The one "divergent thread souls" line in the import report list above it was fixed, because it had become false.

## Tests (5 pass; clippy clean; rustfmt applied to the crate)
- New `memory_folds_to_the_newest_copy_and_archives_the_rest` covers Worker's working memory: a legacy head, two thread copies (k5, and k6 with a gapped chain 1,3) and one project copy.
  - Exactly one doc is imported: `mem_b2_working` with k6's content at revision 2, with revisions renumbered `1=1 2=3`.
  - Three archived sections are written, oldest first.
  - Verify passes. Deleting the winner doc makes `memory_archive` fail for b2.
- Existing assertions changed only where the fold changes them:
  - `divergent_thread_souls[0].doc_id == "k1"` became: `memory_fold_winners[0]` is `mem_b1_soul` from k1, and `folded_copies == 1`.
  - Added `soul.folded == ["lead"]`. The `match` split is unchanged because the file is compared with the head.
  - The tamper test now edits `doc_revision` of `mem_b2_long_term` (formerly doc id `k3`). The dropped class name `knowledge_revisions_by_buddy_scope_kind` was replaced by an assert that `revision_chains` flags `mem_b2_long_term`. Verification still fails.
  - `files[0].notes` became `files[0].sections`.

## Real data (~/.buddies/buddies.sqlite, 2026-09-26)
- `export-notes`, read-only with no `--write`:
  - 30 memory-archive files and 524 archived copies in total. That equals 680 copies (156 heads + 524 knowledge) minus 156 winners.
  - Product Development Lead: **113**
  - Buddies Development Lead: **94**
  - Wave_sim CEO: **50**
- Import and verify on a `VACUUM INTO` copy: **verify ok, 0 mismatches**.
  - Counts: `doc:memory` 156→156, `doc:shared` 0→0, `doc_revision` 289→289.
  - `memory_archive`: 30/30 Buddies agree.
  - `revision_chains`: 289 revisions, 156 docs, ok.
  - Soul: match 45, match_no_header 4, no_path_empty 3.
- 61 winners are not the legacy head:
  - long_term: 18 thread, 6 workspace, 6 project
  - working: 13 thread, 9 workspace, 5 project
  - soul: 4 thread (betting-deployment-lead, builder-03dc…, builder-2897…, quant-lead)
- **Blocked:** deleting `/Users/nicholasbardy/git/unleashd-lean-scope/memory/tmp-import/` was refused by the dcg hook (`rm -rf` on a home path). I did not work around it. It still holds `v33.sqlite` (91 MB copy of live data), `new.sqlite*`, `import.json` and `verify.json`. Please remove it manually.

## Decisions
1. **Shared docs:** the live copy has zero shared docs in any scope. Owner_thread and project shared docs are imported as buddy scope. A name clash aborts the import through a domain check (typed error, nothing written) instead of being reported and skipped. It matches zero rows today.
2. **Tie-break:** on equal `updated_at` the legacy head wins, then the lowest source id. The live copy has no ties.
3. **Renumbering:** every winner chain is renumbered, not only gapped ones. The live copy has 5 gapped knowledge chains, and 4 knowledge docs whose stored revision is not the max.
4. **Souls: owner attention.** As the spec says, the newest-wins rule applies to souls. Four thread souls are newer than their heads, so they become those Buddies' only soul. After the swap their soul docs differ from their SOUL.md files. Verify reports this in `soul.folded` and still passes; the file is checked against the head it mirrors. If thread souls should not override, exclude `soul` from `memory_copies` for knowledge rows.
5. **Archive location:** archives go to the Buddy's **home** workspace root. Knowledge `workspace_id` always equals the home workspace on the live copy, so this changes nothing today.
6. **Shared chains:** shared docs keep their original revision numbers (not renumbered). There are none live.
