import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { executeCommand } from '@nbardy/agent-cli';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddyControlServer } from '../src/buddies/control-server';
import { knowledgeStore, scopedNote } from '../src/buddies/knowledge';
import {
  BuddyMemoryReviewer,
  MEMORY_REVIEW_INSTRUCTIONS,
  MEMORY_REVIEW_MODEL,
} from '../src/buddies/memory-review';
import { createMemoryReviewRunner } from '../src/buddies/memory-review-runner';
import { MEMORY_REVIEW_TOOLS } from '../src/buddies/memory-review-tools';
import { CURATION_CASES, type CurationCase } from './fixtures/memory-curation/cases';

const baselinePath = join(__dirname, 'fixtures/memory-curation/baseline-2026-09-13.txt');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
type Variant = 'baseline' | 'candidate';

/** Real production runner + scoped MCP + disposable store. No live Buddy state. */
async function evaluateCase(
  example: CurationCase,
  variant: Variant,
  repeat: number,
  output: string
) {
  const root = mkdtempSync(join(tmpdir(), 'buddy-curation-eval-'));
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'BUDDY_SOUL.md'), 'Use measured evidence.');
  const store = new BuddiesStore(join(root, 'state.sqlite'));
  let control: BuddyControlServer | undefined;
  let reviewer: BuddyMemoryReviewer | undefined;
  try {
    const workspace = store.createWorkspace({ name: 'Curation fixture', rootPath: workspaceRoot });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'Fixture reviewer subject',
      role: 'Preserve evidence',
      memoryPath: 'memory',
      soulPath: 'BUDDY_SOUL.md',
    });
    const port = store as unknown as BuddiesStorePort;
    const ledger = knowledgeStore(port);
    const scope = { kind: 'owner_thread' as const, conversationId: 'curation-owner-fixture' };
    const authority = {
      actor: buddy.id,
      workspaceId: workspace.id,
      conversationId: scope.conversationId,
      scope,
    };
    const ref = (kind: 'working' | 'long_term' | 'soul') => ({
      targetBuddyId: buddy.id,
      kind,
      scope,
    });
    for (const [kind, content] of [
      ['working', example.working],
      ['long_term', example.longTerm],
    ] as const) {
      const current = ledger.readKnowledgeDocument(ref(kind), authority);
      ledger.replaceKnowledgeDocument(
        ref(kind),
        { key: `seed:${kind}`, baseRevision: current.revision, content, reason: 'Evaluation seed' },
        authority
      );
    }
    const seededNote = example.note ? scopedNote(port, authority, example.note) : null;
    const siblingScope = {
      kind: 'owner_thread' as const,
      conversationId: 'private-sibling-fixture',
    };
    const privateSentinel = 'FIXTURE_PRIVATE_SIBLING_SENTINEL';
    scopedNote(
      port,
      { ...authority, scope: siblingScope, conversationId: siblingScope.conversationId },
      { topic: 'Private fixture', body: privateSentinel }
    );
    control = new BuddyControlServer({
      getStore: async () => port,
      isConversationActive: () => false,
      dispatchMessage: async () => {
        throw new Error('Evaluation cannot dispatch work');
      },
    });
    const calls: Array<{ operation: string; input: unknown; result?: unknown; error?: string }> =
      [];
    let modelReport: unknown;
    const run = createMemoryReviewRunner(control, (request) => {
      // Hold tools/runtime fixed in both variants: the instruction text is the one variable.
      // Use the runner's existing execute seam; no production override setting is added.
      if (variant === 'baseline') {
        return executeCommand({
          ...request,
          extraArgs: request.extraArgs?.map((arg) =>
            arg.startsWith('model_instructions_file=')
              ? `model_instructions_file=${JSON.stringify(baselinePath)}`
              : arg
          ),
        });
      }
      return executeCommand(request);
    });
    reviewer = new BuddyMemoryReviewer({
      directory: join(root, 'reviews'),
      getStore: async () => port,
      run: async (request) => {
        assert.ok(
          !request.prompt.includes(privateSentinel),
          'private sibling is absent from input'
        );
        modelReport = await run({
          ...request,
          executeTool: (operation, input) => {
            const call: (typeof calls)[number] = { operation, input };
            calls.push(call);
            try {
              call.result = request.executeTool(operation, input);
              return call.result;
            } catch (error) {
              call.error = String(error);
              throw error;
            }
          },
        });
        return modelReport;
      },
    });
    const started = Date.now();
    await control.start();
    await reviewer.initialize();
    reviewer.start();
    reviewer.enqueue({
      attemptId: 'fixture-attempt',
      conversationId: scope.conversationId,
      context: { buddyId: buddy.id, workspaceId: workspace.id, knowledgeScope: scope },
      completedAt: new Date().toISOString(),
      messages: example.messages,
    });
    while (!reviewer.list(buddy.id)[0]?.finishedAt || reviewer.activeCount()) {
      if (Date.now() - started > 150_000) {
        reviewer.stop();
        throw new Error('Reviewer failed to drain within evaluation deadline');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [receipt] = reviewer.list(buddy.id);
    // This benchmark varies ONE thing: the instruction text. If the reviewer
    // ladder fell back to another provider mid-run the comparison is measuring
    // two models, and the baseline variant would also have lost its instruction
    // override (that rewrites codex's model_instructions_file, which muse has
    // no counterpart for). Fail loudly rather than publish a mislabelled result.
    assert.equal(
      receipt.fallbackFrom,
      undefined,
      `${MEMORY_REVIEW_MODEL} is out of credits; top up before benchmarking instead of measuring ${receipt.model}`
    );
    const working = ledger.readKnowledgeDocument(ref('working'), authority);
    const longTerm = ledger.readKnowledgeDocument(ref('long_term'), authority);
    const notes = ledger.listKnowledgeDocuments(
      { targetBuddyId: buddy.id, scope, kinds: ['note'], limit: 30 },
      authority
    );
    const result = {
      case: example.id,
      variant,
      repeat,
      rubric: example.rubric,
      model: receipt.model,
      effort: receipt.reasoningEffort,
      instructionsSha256: sha256(
        variant === 'baseline' ? readFileSync(baselinePath, 'utf8') : MEMORY_REVIEW_INSTRUCTIONS
      ),
      toolDescriptionsSha256: sha256(
        JSON.stringify(
          Object.entries(MEMORY_REVIEW_TOOLS).map(([name, tool]) => [name, tool.description])
        )
      ),
      elapsedMs: Date.now() - started,
      before: { working: example.working, longTerm: example.longTerm, note: seededNote },
      after: { working, longTerm, notes },
      receipt,
      calls,
      modelReport,
    };
    // Persist before assertions, so failures remain inspectable. These are synthetic fixtures.
    const file = join(output, `${example.id}-${variant}-${repeat}.json`);
    writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(
      `${example.id} ${variant} #${repeat}: ${receipt.status}; ${calls.length} calls; ${file}`
    );
    assert.equal(receipt.status, 'complete', receipt.error);
    assert.ok(working.content.length <= 2000 && longTerm.content.length <= 4000);
    assert.equal(
      ledger.readKnowledgeDocument(ref('soul'), authority).content,
      'Use measured evidence.'
    );
    assert.ok(!JSON.stringify({ working, longTerm, notes, calls }).includes(privateSentinel));
    if (variant === 'candidate') {
      for (const doc of ['working', 'long_term']) {
        assert.ok(
          calls.some(
            (call) => call.operation === 'get_memory' && (call.input as { doc: string }).doc === doc
          ),
          `read ${doc} through MCP`
        );
      }
      if (example.noOp) {
        assert.deepEqual(receipt.writes, { working: 0, longTerm: 0, notes: 0 });
        assert.equal(working.content, example.working);
        assert.equal(longTerm.content, example.longTerm);
      }
      if (example.reuseNote) {
        assert.ok(calls.some((call) => call.operation === 'recall'));
        assert.equal(receipt.writes.notes, 0, 'reuse existing evidence');
        assert.equal(notes.length, 1);
      }
      if (example.notePointer) {
        assert.ok(seededNote);
        assert.ok(
          `${working.content}\n${longTerm.content}`.includes(seededNote.ref.name),
          'compact memory links the exact existing native note'
        );
      }
    }
    // Semantic rubric grading uses saved outputs, not a model's self-reported success.
  } finally {
    reviewer?.stop();
    // The runner owns process exit/event drain. Do not tear down capabilities mid-drain.
    while (reviewer?.activeCount()) await new Promise((resolve) => setTimeout(resolve, 100));
    await control?.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  'live curation comparison through the real scoped reviewer',
  { skip: process.env.UNLEASHD_LIVE_MEMORY_CURATION !== '1', timeout: 3_000_000, concurrency: 2 },
  async (t) => {
    const repeats = Number(process.env.UNLEASHD_MEMORY_CURATION_REPEATS ?? 2);
    assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
    const output = process.env.UNLEASHD_MEMORY_CURATION_RESULTS
      ? resolve(process.env.UNLEASHD_MEMORY_CURATION_RESULTS)
      : mkdtempSync(join(tmpdir(), 'buddy-curation-results-'));
    mkdirSync(output, { recursive: true });
    console.log(`Synthetic curation results: ${output}`);
    const selected = CURATION_CASES.filter(
      (example) =>
        !process.env.UNLEASHD_MEMORY_CURATION_CASE ||
        example.id === process.env.UNLEASHD_MEMORY_CURATION_CASE
    );
    assert.ok(selected.length, 'unknown curation case');
    const selectedVariant = process.env.UNLEASHD_MEMORY_CURATION_VARIANT;
    assert.ok(
      !selectedVariant || selectedVariant === 'baseline' || selectedVariant === 'candidate',
      'unknown curation variant'
    );
    const evaluations: Array<Promise<void>> = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const example of selected) {
        // Alternate order so one variant does not always see the earlier service conditions.
        const variants: Variant[] =
          repeat % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
        for (const variant of variants) {
          if (selectedVariant && variant !== selectedVariant) continue;
          evaluations.push(
            t.test(`${example.id}/${variant}/${repeat}`, { timeout: 180_000 }, () =>
              evaluateCase(example, variant, repeat, output)
            )
          );
        }
      }
    }
    await Promise.all(evaluations);
  }
);
