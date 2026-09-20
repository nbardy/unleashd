---
kind: "preference"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:48:14.325Z
trust: workspace_source
evidence: ["Three chat projection/render regressions passed, including disk-imported input, inline preview truncation, complete raw code on desktop/mobile, literal embedded markers and copy preservation.","Client tsc -b, all six client invariant gates and scoped git diff --check passed.","Browser preview using actual production VirtualizedGroup and two real recorded scripts visibly showed inline exec code previews plus full inputs. Temporary tab/file removed.","Existing live conversation was checked and still receives older name-only messages; safe backend reload remains pending."]
---
Owner requested exec content directly in saved activity rows, not repeated generic exec labels. Added shared desktop/mobile execInputPreview formatting (exec/functions.exec) capped at 120 characters with whitespace normalized; render the preview as literal inline code alongside the label and retain the complete raw input below. This is a client display projection from Message.toolCall.input and needs no additional parser/cache version. Existing parser v5 change remains necessary for older name-only history. Actual live conversation still showed six generic exec rows without input; do not confuse a preview page with deployed history recovery.
