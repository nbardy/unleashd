---
kind: "conversation-memory-review"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-10T19:17:14.879Z
trust: workspace_source
evidence: [{"conversationId":"7d9d117f-7a13-46e2-bf6a-95da591d6e2b","attemptId":"a540b0ad-bba5-4e62-91d4-d419e7c340b6","reviewId":"53b54199dfabab02bd9d3f80ec75a519001d26878bd91e1c23addc12b191bf1f","model":"gpt-5.6-luna"}]
---
Fresh-eyes review after implementation found five reproducible defects despite passing focused/full suites and one successful live round trip: (1) project-scoped team turns can read unrelated participant-private messages when they share a project reference; (2) reviewer writes scoped memory while ordinary reads/Memory panel use global memory, making knowledge disappear and reviewer notes undiscoverable; (3) routine memory updates alter the provider-context/audience key and unnecessarily reset model continuity; (4) work filtering occurs after pagination, allowing an empty page/no cursor despite readable work; (5) retry after conversation registration but failed linking can finish without repairing the link. Earlier completion claim is overstated for these longer sequences and failure boundaries. Additional gaps: shared-document publishing/discovery, Memory UI scope selection, and actual mailbox integration. Architecture/owner-accepted Direction 1 still fits; simplest repair is one effective memory resolver/audience policy, filter-before-pagination, and one creation-readiness path on retry, while separating permission changes from ordinary content updates. Evidence: /Users/nicholasbardy/git/unleashd/product/buddies/REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.md (uncommitted historical citation not independently hashed here). No runtime or production-team changes made in this review.
