import { z } from 'zod';

export const MailDraftSchema = z
  .object({
    accountId: z.string().min(1),
    to: z.array(z.string().email()).min(1).max(20),
    subject: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(32000),
    demo: z
      .object({
        projectId: z.string().min(1),
        revision: z.number().int().positive(),
        evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();
export type MailReceipt = {
  status: 'sent' | 'not_sent' | 'unknown';
  providerId?: string;
  detail?: string;
};
export type MailEffect = {
  id: string;
  account_id: string;
  workspace_id: string;
  status: string;
  payload: z.infer<typeof MailDraftSchema>;
};
export interface MailboxLedger {
  getMailEffect(id: string, authority: { actor: string; workspaceId: string }): MailEffect;
  claimMailEffect(
    id: string,
    authority: { actor: string; workspaceId: string }
  ): { claimed: boolean; effect: MailEffect };
  settleMailEffect(
    id: string,
    receipt: MailReceipt,
    authority: { actor: string; workspaceId: string }
  ): MailEffect;
  recordInboundMail(
    input: { accountId: string; eventId: string; payload: unknown },
    authority: { workspaceId: string }
  ): unknown;
}
/** Adapters own credentials. No account IDs or credentials are inferred from repository folders. */
export interface MailboxAccount {
  id: string;
  workspaceId: string;
  send(
    draft: z.infer<typeof MailDraftSchema>,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<MailReceipt>;
  reconcile(idempotencyKey: string, signal: AbortSignal): Promise<MailReceipt>;
}
export class BuddyMailbox {
  constructor(
    private ledger: MailboxLedger,
    private accounts: ReadonlyMap<string, MailboxAccount>
  ) {}
  async send(
    id: string,
    authority: { actor: string; workspaceId: string },
    signal: AbortSignal,
    assertCurrentAuthority: () => void
  ) {
    signal.throwIfAborted();
    assertCurrentAuthority();
    const effect = this.ledger.getMailEffect(id, authority);
    const account = this.account(effect);
    MailDraftSchema.parse(effect.payload);
    const claim = this.ledger.claimMailEffect(id, authority);
    if (!claim.claimed) return claim.effect;
    // No await between authorization/claim and provider submission.
    try {
      return this.ledger.settleMailEffect(
        id,
        await account.send(effect.payload, effect.id, signal),
        authority
      );
    } catch {
      return this.ledger.getMailEffect(id, authority);
    }
  }
  async reconcile(
    id: string,
    authority: { actor: string; workspaceId: string },
    signal: AbortSignal
  ) {
    signal.throwIfAborted();
    const effect = this.ledger.getMailEffect(id, authority);
    if (effect.status !== 'unknown') return effect;
    const result = await this.account(effect).reconcile(effect.id, signal);
    return this.ledger.settleMailEffect(id, result, authority);
  }
  receive(accountId: string, eventId: string, payload: unknown) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Mailbox account is not connected');
    return this.ledger.recordInboundMail(
      { accountId, eventId, payload },
      { workspaceId: account.workspaceId }
    );
  }
  private account(effect: MailEffect) {
    const account = this.accounts.get(effect.account_id);
    if (!account || account.workspaceId !== effect.workspace_id)
      throw new Error('Mailbox account is not connected in this workspace');
    return account;
  }
}
