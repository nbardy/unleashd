# Owner selects files and Mail, removes employee knowledge tools

Recorded 2026-09-13 UTC by Buddies Development Lead. Decision-maker: owner.
Status: accepted product/design direction; implementation has not occurred in
this design task. Conversation: `89d40447-9d68-4b53-9688-67c154dbfae2`.

## Owner evidence

The owner's correction, preserving the original wording:

> I think you're defneding to much, i was arguing for removal and more simplification
>
> so we alreayd have "agent_notes" whre we do agent_notes/{possible_group_subfolder}/{datetime}_{topic}.md to make them searchable and filteredable we should just reuse that and remove the remeber_note receall and document stuff
>
> And workers should inherit buddies meory system.
> Otherwise that and mail is enouhg

The final sentence began “Mail lets buddies send information directed and with
immediacy, writing md agentnote lets agents” and was unfinished. The design
paraphrases the established distinction as directed Mail versus discoverable
file knowledge; it does not invent the missing words or a new scheduling rule.

## Question and choice

Do ordinary agents need a managed Document object and four dedicated knowledge
operations, given existing agent notes and background memory curation?

Owner choice: reuse ordinary Markdown notes under the existing optional-group,
datetime/topic convention; remove `remember_note`, `recall`, `get_document` and
`update_document` from the employee design. Workers inherit the ordinary Buddy
memory system. Mail supplies directed communication and notes supply durable
knowledge. The decision is deletion and reuse, not optional tool hiding or a new
filesystem wrapper API.

## Predecessors and what changed

V2 retained all four knowledge tools and a Document product object. The assistant
then proposed removing routine Worker memory editing but retaining optional
scoped recall. That prior recommendation is recorded in owner-thread note
`2026-09-13T06:25:15.282Z:2d5d7a4e-240a-4ff4-9c19-cc7bf31d8ce3`; its content and
the assistant's final answer are present in this conversation. The original v2
decision is `2026-09-13T05:54:25.611Z:d6d76d15-dd61-4822-8f66-f7f869c34cd5`.

The owner explicitly rejected that partial simplification. The assistant had
treated existing storage machinery as a reason to preserve the foreground API.
That does not follow: ordinary file tools already support detailed knowledge,
and the common background Buddy process handles compact-memory curation.

The rationale for durable learning, recorded decisions and automatic memory
refresh still holds. It no longer supports a managed artifact object or a
specialized employee note-search protocol. Task state remains in native work
records. The owner selected a common Buddy/Worker memory lifecycle, not a new
Worker-specific memory service.

## Tradeoffs and implementation interpretation

Use plain filename/content search instead of introducing kind filters, cursors,
opaque document references and publication operations for notes. Notes do not
notify a recipient automatically; pair a file reference with Mail when attention
is needed. An exact historical artifact can use a commit or content hash.

The four deletions reduce the proposed union from 25 to 21 tools, Worker profile
12 to 8 and lead profile 18 to 14. This arithmetic does not approve every retained
tool or claim measured runtime savings. Compact-memory storage and restricted
reviewer internals are part of the existing Buddy memory system; no backend
rewrite is implied merely by Worker inheritance. Shared/note artifact paths
should converge on files and stop maintaining a second active collection.

Revisit only for observed failures of file discovery, handoff or common memory
inheritance. Try improving directory conventions, context pointers and existing
memory integration before proposing a new specialized knowledge API. Earlier
bounded-reviewer concerns remain implementation evidence to handle in the common
memory system, not grounds to retain the rejected employee tools.

## Historical sources

Captured 2026-09-13; exact pre-change entry-point content and all hashes are in
[files-mail-before.json](../../product/buddies/worker-design-review-2026-09-13/files-mail-before.json).

| Source | SHA-256 | Preserved relevant excerpt |
|---|---|---|
| `03-v2.md` | `9196e10813d916662da5f76d26df773108caf47ee71e20bbcc0b0b83551f1554` | “Document is a resource family.” |
| `04-mcp-contract.md` | `7ebad23ab14188235b8de95e1d4df02f2df62e075184957858dd58b32eebfce4` | “The target employee union is exactly **25 tools**.” |
| `05-code-and-removal-map.md` | `3b383403465d52ab46c0cf4fa5fb17d4c94a606b8d78b9a4dd92c57cdcd97e4a` | “expose shared references through existing document search” |
| Previous `LATEST_HUMAN_DESIGN.md` | `6a41b466647259f216ac676c7bee7f1a26555161df394d60b49ef30845081425` | “The inventory's **Document** means named, versioned content” |
| Previous design `README.md` | `d7f64899850710668e6420b71ac64d0145ee452989e039adf16f0f0a16dac823` | “The employee catalog union stays at 25 tools” |

The [successor design](../../product/buddies/worker-design-review-2026-09-13/06-files-mail-memory.md)
records the current choice, revised catalog and removal map. The original v1/v2
files remain unchanged. Native project
`buddy_project_98f532e7-27b7-4260-8243-56fdeda3eac9` owns work status and verification
evidence; this note records decision history.
