---
kind: "correction"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T08:41:44.452Z
trust: workspace_source
evidence: ["14 targeted server tests and all 68 client tests passed; server/client typechecks and six client invariant gates passed.","Disk-to-desktop/mobile integration test confirms exact input text, literal marker rendering, copy content, and bounded summaries.","42 real saved custom exec inputs matched source exactly; a temporary Vite preview using the actual expanded production renderer displayed both selected recorded scripts. Preview removed after inspection.","Running backend still needs its next safe reload before existing conversations receive cache-v5 details; no forced restart performed."]
---
Owner reported that expanded saved tool calls remained empty after the earlier history/count fixes. The Codex importer retained call names but discarded freeform scripts and JSON arguments. Added Message.toolCall.input, preserving custom-tool text exactly and pretty-printing valid function-call JSON while retaining malformed text. Desktop and mobile render literal code; Copy/transcript include the input. Session cache v5 reparses v4 name-only projections. Bounded conversation summaries omit full inputs. Earlier count-only validation missed the actual user need: verify source transcript through schema, cache, and expanded rendering. General tool output blobs are not imported by this change.
