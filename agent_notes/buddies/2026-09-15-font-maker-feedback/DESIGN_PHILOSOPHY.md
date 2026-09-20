# Buddies design philosophy

Owner direction · September 14, 2026

This is the short statement of intent for future design conversations. The quotes
below are verbatim excerpts from the owner's messages, including their typos.
Connecting prose is an editorial summary. This records product direction, not
proof of implementation or permission to perform operations.

## Three core components

**Buddies, Mail and Tasks.** The Buddy is the main entity the user interacts with.
Memory is how it maintains identity and continuity across sessions.

> should of been 3 Buddies is thecore memories is an implimentation details of buddies

Buddies organize continuity around an identity. Tasks organize continuity around
an effort. Mail connects Buddies across sessions.

> Mail is about persistent inter agent communication
> And Tasks is about organizing progress of work and coordinating work efforst specifically.

## Files carry collaboration

> And yea its good to hglight "files" as a part of the dat model as "checkpoints" can just be files on disc and reord and communicated via task and converaitsons and mail informallym, lots of collaboration belongs in files,

Use ordinary files for notes, plans, code, checkpoints and deliverables. Link
them where useful. Comments, commits, notes, conversations and Mail complement
each other; they do not need to become one system or a mandatory reporting ritual.

> I feel like we should be able to append commetns to tasks and agent should be encouraged to make commits and to write progress to note files and when appropiate attach notes andinfo in messages , mail or tasks

## Why keep Tasks?

> One could aruge tasks can dissapear to simplify but I think its a good primiitve to have even though its not ncessary to keep formal progress log and also its strong point is that it gives "persistent identity" to work streams so we can have a long standing pillar for communication around Work and agents

A Task gives the work a lasting address. Its goals, comments and references can
remain connected as contributors and conversations change. Shared work context
belongs to the effort, rather than being stranded in one Buddy's memory.

## How we arrived here

The owner's account of the starting point:

> Unleashd started as a simple set of converstaions and each thread recorded its own notes on files , these were used to persists information between threads this works suprsingly wel, but requries each agent booting from scratch each time.

Keep what worked: agents collaborating through files. Add explicit continuity for
who is working, who is communicating and what the work is about. Sessions still
load context, but have dependable identities and places to recover it from.
This is the owner's historical account, not an independently verified chronology.

## How this steers future choices

First compose Buddies, Mail, Tasks and files. Add a formal concept only for a
demonstrated responsibility existing primitives cannot handle. Keep authority in
one place; link information rather than duplicating competing state. Judge
simplification by the resulting workflow and code, not by shorter names.

The [core model](CORE_DESIGN.md) translates this intent into responsibilities,
boundaries and implementation evidence. The
[progress and returns draft](DESIGN_PROGRESS_AND_RETURNS.md) proposes concrete
types, APIs, code changes and deletions; its proposals are not shipped behavior.
Older wording remains in dated decision records. The owner's explicit three-part
correction supersedes the assistant's earlier four-component interpretation.
