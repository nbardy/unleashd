import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { BuddyMailbox, type MailboxAccount, type MailboxLedger } from '../src/buddies/mailbox';

test('mailbox adapter preserves unknown delivery and reconciles without resending', async () => {
  const store = new BuddiesStore(':memory:');
  try {
    const workspace = store.createWorkspace({ name: 'Mailbox', rootPath: '/tmp' });
    const buddy = store.createBuddy({ project: workspace.id, name: 'Lead', role: 'Prepare' });
    const authority = { actor: buddy.id, workspaceId: workspace.id };
    const project = store.createCoordinatedProject(
      {
        workspaceId: workspace.id,
        ownerId: buddy.id,
        title: 'Review demo',
        definitionOfDone: 'Reviewed video',
      },
      { actor: buddy.id, key: 'demo' }
    );
    const accepted = store.updateCoordinatedProject(
      project.id,
      { baseRevision: project.revision, status: 'done', evidence: ['fixture:demo-video'] },
      { actor: buddy.id, key: 'accepted' }
    );
    const evidenceHash = createHash('sha256')
      .update(
        JSON.stringify({
          criteria: accepted.definition_of_done,
          evidence: JSON.parse(accepted.completion_evidence),
        })
      )
      .digest('hex');
    const draft = store.prepareMailEffect(
      {
        accountId: 'mailbox',
        to: ['buyer@example.com'],
        subject: 'Reviewed demo',
        text: 'Exact approved draft',
        demo: { projectId: accepted.id, revision: accepted.revision, evidenceHash },
      },
      { ...authority, key: 'draft' }
    );
    store.authorizeMailEffect(
      {
        id: draft.id,
        fingerprint: draft.fingerprint,
        authorized: true,
        reason: 'Fixture explicit approval',
      },
      { actor: 'owner', workspaceId: workspace.id, ownerInputId: 'approve' }
    );
    let sends = 0;
    const account: MailboxAccount = {
      id: 'mailbox',
      workspaceId: workspace.id,
      send: async () => {
        sends++;
        throw new Error('Connection lost after possible send');
      },
      reconcile: async () => ({ status: 'sent', providerId: 'provider-receipt' }),
    };
    const ledger = store as unknown as MailboxLedger;
    const signal = new AbortController().signal;
    await assert.rejects(
      new BuddyMailbox(ledger, new Map()).send(draft.id, authority, signal, () => {}),
      /not connected/
    );
    assert.equal(store.getMailEffect(draft.id, authority).status, 'prepared');
    const mailbox = new BuddyMailbox(ledger, new Map([[account.id, account]]));
    await assert.rejects(
      mailbox.send(draft.id, authority, signal, () => {
        throw new Error('Turn revoked');
      }),
      /revoked/
    );
    assert.equal(sends, 0);
    assert.equal((await mailbox.send(draft.id, authority, signal, () => {})).status, 'unknown');
    assert.equal((await mailbox.send(draft.id, authority, signal, () => {})).status, 'unknown');
    assert.equal(sends, 1);
    assert.equal((await mailbox.reconcile(draft.id, authority, signal)).status, 'sent');
    assert.equal(sends, 1);
  } finally {
    store.close();
  }
});
