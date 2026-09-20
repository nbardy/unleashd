/**
 * Regression guards for the two 2026-09-20 optimistic-send defects. Both were
 * introduced with 5c0cec4 and are properties of the submission domain, so they
 * are tested against the real take/run pair rather than a rendered composer:
 *
 *  1. An attachment with no text could be queued twice. Clearing only the text
 *     left `pendingFiles.length > 0`, so the emptiness predicate stayed false
 *     and the Send button stayed enabled during the in-flight send.
 *  2. A rejection restored the draft through the LIVE composer, so a reconnect
 *     after the user switched threads pasted the old thread's text into the new
 *     one and overwrote its draft. `rejectPendingMessageCommands` settles every
 *     in-flight command at once, so this fired on any reconnect.
 *
 * The fake composer below is the store, not a mock of a collaborator: these
 * three effects ARE the boundary the submission path is defined against.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ComposerEffects,
  runComposerSubmission,
  takeComposerSubmission,
} from '../src/hooks/useComposerSubmission';
import type { PendingFile } from '../src/hooks/usePendingAttachments';

const file = (name: string): PendingFile => ({
  originalName: name,
  absolutePath: `/tmp/${name}`,
  mimeType: 'image/png',
  size: 10,
  previewUrl: null,
});

function composerOn(conversationId: string) {
  const drafts = new Map<string, string>();
  const trays = new Map<string, PendingFile[]>();
  let showing = conversationId;
  return {
    drafts,
    trays,
    show: (id: string) => {
      showing = id;
    },
    type: (text: string) => drafts.set(showing, text),
    attach: (f: PendingFile) => trays.set(showing, [...(trays.get(showing) ?? []), f]),
    take: () =>
      takeComposerSubmission(showing, drafts.get(showing) ?? '', trays.get(showing) ?? []),
    effects: (deliver: ComposerEffects['deliver']): ComposerEffects => ({
      // Mirrors the hook: the clear is addressed to what is on screen...
      clear: () => {
        drafts.delete(showing);
        trays.delete(showing);
      },
      deliver,
      // ...the restore is addressed to the submission's own conversation.
      restore: (s) => {
        drafts.set(s.conversationId, s.text);
        trays.set(s.conversationId, s.files);
      },
    }),
  };
}

test('an attachment with no text cannot be submitted twice while the first send is in flight', async () => {
  const composer = composerOn('a');
  composer.attach(file('shot.png'));

  const delivered: string[] = [];
  const effects = composer.effects(async (_id, content) => {
    delivered.push(content);
    await new Promise(() => {}); // never acks — the whole point is the in-flight window
  });

  void runComposerSubmission(composer.take(), effects);
  await Promise.resolve();
  assert.equal(delivered.length, 1);

  // The second click/Enter during the in-flight send. Before the fix the tray
  // still held the file here, so this produced a second identical delivery.
  const second = composer.take();
  assert.equal(second.kind, 'empty');
  assert.equal(await runComposerSubmission(second, effects).then((o) => o.kind), 'idle');
  assert.equal(delivered.length, 1);
});

test('a rejection returns text and files to the conversation they were typed into', async () => {
  const composer = composerOn('a');
  composer.type('half-written thought');
  composer.attach(file('notes.png'));

  let reject: (error: Error) => void = () => {};
  const inFlight = new Promise<void>((_resolve, r) => {
    reject = r;
  });
  const pending = runComposerSubmission(
    composer.take(),
    composer.effects(() => inFlight)
  );

  // The user moves on and starts a different thread while the send is in flight.
  composer.show('b');
  composer.type("b's own draft");
  reject(new Error('Connection restarted before the message was accepted'));

  const outcome = await pending;
  assert.equal(outcome.kind, 'rejected');
  assert.equal(composer.drafts.get('a'), 'half-written thought');
  assert.deepEqual(
    composer.trays.get('a')?.map((f) => f.originalName),
    ['notes.png']
  );
  // The defect: 'a' text landed here and clobbered what the user was writing.
  assert.equal(composer.drafts.get('b'), "b's own draft");
  assert.equal(composer.trays.get('b'), undefined);
});

test('an accepted submission leaves the composer empty', async () => {
  const composer = composerOn('a');
  composer.type('ship it');
  composer.attach(file('diff.png'));

  const outcome = await runComposerSubmission(
    composer.take(),
    composer.effects(async () => {})
  );

  assert.equal(outcome.kind, 'sent');
  assert.equal(composer.take().kind, 'empty');
  assert.equal(composer.drafts.get('a'), undefined);
  assert.equal(composer.trays.get('a'), undefined);
});

test('attachments are framed into the delivered content, so a text-free send is not blank', async () => {
  const composer = composerOn('a');
  composer.attach(file('shot.png'));

  let sent = '';
  await runComposerSubmission(
    composer.take(),
    composer.effects(async (_id, content) => {
      sent = content;
    })
  );

  assert.match(sent, /^\[Attached files\]\n\/tmp\/shot\.png\n$/);
});
