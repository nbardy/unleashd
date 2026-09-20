---
kind: "correction"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T06:56:20.517Z
trust: workspace_source
evidence: []
---
Initial radio-picker change was marked complete using typecheck/invariants without browser QA. Owner screenshot showed an empty dialog: catalog null gated all contents; useProviderCatalog retains failures without retry while mounted. Added catalog retry when opening, explicit loading/error with Retry, and unavailable-config message. Live catalog returned HTTP 200 and passed current schema; original transient failure cause was not captured. Browser QA also found Sidebar CSS hid native radios through equal-specificity import order; raised scoped selector specificity. Verified actual chat in browser, deliberately aborted catalog request, observed error, removed interception, clicked Retry, and saw all three radio groups and native radios restored. Typecheck and all six invariants pass.
