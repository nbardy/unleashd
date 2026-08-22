# product/ — planning and handoff docs, by workstream

One folder per workstream, not per sprint. Sprint-scoped folders age badly:
every doc has to move next sprint, and every link breaks with it.

```
product/
├── buddies/   Buddies feature: primitives, memory, direct reports, sprints
└── mobile/    Mobile view tree and its handoff
```

| Doc | What it is |
|---|---|
| `buddies/PLANNING_MEMORY.md` | Memory design: 2 primitives, 4 layers, 3 verbs |
| `buddies/PLANNING_PRIMITIVES.md` | Coordination primitives; the missing wait |
| `buddies/PLANNING_SUB_BUDDIES.md` | Direct reports: hiring, quota, threat model |
| `buddies/HANDOFF_SUB_BUDDIES.md` | Direct-reports handoff |
| `buddies/SPRINT_BOARD_2026-08-21.md` | Product / design / engineering split |
| `buddies/SPRINT_HANDOFF_2026-08-20.md` | Prior sprint handoff (superseded in part) |
| `mobile/PLANNING_MOBILE.md` | Mobile plan |
| `mobile/HANDOFF_MOBILE.md` | Mobile handoff |

**`agent_notes/` stays flat.** The filename is the index there
(`YYYY-MM-DD_topic_<buddy-slug>.md`) and subfolders would break every glob and
the docs that link notes by exact path. See `buddies/PLANNING_MEMORY.md` §7.

Entry point for agents is the "Read before touching" table in `AGENTS.md`.
