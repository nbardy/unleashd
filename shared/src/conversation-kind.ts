import { z } from 'zod';
import { type BuddyContext, BuddyContextSchema } from './conversation-config.js';

/**
 * Canonical conversation kind — holistic sum type (D = ⊕ᵢ Dᵢ).
 *
 * Replaces the scattered `buddyContext: BuddyContext|null` + `purpose` + hidden HTML
 * markers with one explicit discriminant. Every Conversation is exactly one kind.
 * This is the "one clean path" model: structural branching lives ONLY in the thin
 * dispatcher `matchConversationKind`; handlers for each variant have zero structural
 * branching (R1, D2).
 *
 * Non-breaking migration: legacy records may still carry `buddyContext` / `purpose`
 * without `kind`. Use `getConversationKind()` to obtain the effective kind — it
 * derives from legacy fields when `kind` is absent. New writes set both `kind` and
 * the legacy fields so old clients/parsers keep working until the next breaking window.
 */
export const ConversationKindSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general') }),
  z.object({
    kind: z.literal('buddy'),
    buddyId: z.string().min(1),
    workspaceId: z.string().min(1),
    buddyProjectId: z.string().min(1).nullish(),
    legacyWorkItemId: z.string().min(1).nullish(),
    automationRunId: z.string().min(1).nullish(),
    delegatedByBuddyId: z.string().min(1).nullish(),
    parentBuddyConversationId: z.string().uuid().nullish(),
    allowedBuddyOperations: z.array(z.string().min(1)).min(1).optional(),
    // briefing is first-turn hidden content, not durable identity, but may be
    // present when migrating from runtime's buddyBriefing; keep optional.
    briefing: z.string().optional(),
  }),
  z.object({ kind: z.literal('buddy_builder') }),
]);

export type ConversationKind = z.infer<typeof ConversationKindSchema>;
export type GeneralKind = Extract<ConversationKind, { kind: 'general' }>;
export type BuddyKind = Extract<ConversationKind, { kind: 'buddy' }>;
export type BuddyBuilderKind = Extract<ConversationKind, { kind: 'buddy_builder' }>;

// ── thin dispatcher δ = ⟦h_general, h_buddy, h_buddyBuilder⟧ ─────────────────
// The dispatcher switches ONLY to select a handler. Body is trivial (D1).
export function matchConversationKind<T>(
  kind: ConversationKind,
  handlers: {
    general: (v: GeneralKind) => T;
    buddy: (v: BuddyKind) => T;
    buddy_builder: (v: BuddyBuilderKind) => T;
  }
): T {
  switch (kind.kind) {
    case 'general':
      return handlers.general(kind);
    case 'buddy':
      return handlers.buddy(kind);
    case 'buddy_builder':
      return handlers.buddy_builder(kind);
  }
}

// ── one clean handler per type (no structural branching inside) ──────────────
export function isBuddyKind(kind: ConversationKind): kind is BuddyKind {
  return kind.kind === 'buddy';
}
export function isGeneralKind(kind: ConversationKind): kind is GeneralKind {
  return kind.kind === 'general';
}
export function isBuddyBuilderKind(kind: ConversationKind): kind is BuddyBuilderKind {
  return kind.kind === 'buddy_builder';
}

// ── canonical constructors (κ at the ingestion boundary) ─────────────────────
/**
 * CANONICAL ABSENCE INVARIANT (BuddyKind ⇄ BuddyContext).
 *
 * The two directions used to disagree: `buddyKindFromContext` normalized absence to
 * `null` while `buddyContextFromKind` normalized it back to `undefined`, so a
 * round-trip of `{ buddyProjectId: null }` silently became `undefined` (and every
 * absent field materialized as a present-but-undefined key, breaking deepStrictEqual
 * and JSON shape stability). The invariant is now:
 *
 *   - `.nullish()` scalar fields (buddyProjectId, legacyWorkItemId, automationRunId,
 *     delegatedByBuddyId, parentBuddyConversationId) → absence is ALWAYS `null`,
 *     present as an explicit key in both directions. `null` (not `undefined`) is the
 *     representation the rest of the repo already writes and persists — see
 *     server/src/buddies/routes.ts, integration.ts, session-loader.ts and the client
 *     dashboard, which all emit `buddyProjectId: null`. JSON round-trips preserve
 *     `null` but drop `undefined`, so `null` is the only stable durable form.
 *   - `allowedBuddyOperations` is `.optional()` (NOT nullish) in both schemas, so
 *     `null` is invalid; absence is represented by OMITTING the key entirely.
 *   - `briefing` is likewise omit-when-absent.
 *
 * Consequence: `buddyContextFromKind(buddyKindFromContext(ctx))` is idempotent and
 * deep-equal-stable. Do not reintroduce `?? undefined` on the nullish fields.
 */
export function buddyKindFromContext(context: BuddyContext, briefing?: string): BuddyKind {
  return {
    kind: 'buddy',
    buddyId: context.buddyId,
    workspaceId: context.workspaceId,
    buddyProjectId: context.buddyProjectId ?? null,
    legacyWorkItemId: context.legacyWorkItemId ?? null,
    automationRunId: context.automationRunId ?? null,
    delegatedByBuddyId: context.delegatedByBuddyId ?? null,
    parentBuddyConversationId: context.parentBuddyConversationId ?? null,
    ...(context.allowedBuddyOperations !== undefined
      ? { allowedBuddyOperations: context.allowedBuddyOperations }
      : {}),
    ...(briefing !== undefined ? { briefing } : {}),
  };
}

export function buddyContextFromKind(kind: BuddyKind): BuddyContext {
  return {
    buddyId: kind.buddyId,
    workspaceId: kind.workspaceId,
    buddyProjectId: kind.buddyProjectId ?? null,
    legacyWorkItemId: kind.legacyWorkItemId ?? null,
    automationRunId: kind.automationRunId ?? null,
    delegatedByBuddyId: kind.delegatedByBuddyId ?? null,
    parentBuddyConversationId: kind.parentBuddyConversationId ?? null,
    ...(kind.allowedBuddyOperations !== undefined
      ? { allowedBuddyOperations: kind.allowedBuddyOperations }
      : {}),
  };
}

// Bounded, throw-free rendering of an arbitrary rejected value for a log line.
function truncateForLog(value: unknown, max = 400): string {
  const text = ((): string => {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  })();
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text;
}

// Legacy → kind (used on load). This is the ingestion boundary κ: messy legacy
// records in, canonical ConversationKind out.
//
// RULE T4 (no silent fallbacks): a MALFORMED `input.kind` must never be quietly
// downgraded. It is loud-logged with the zod issues plus a truncated dump of the
// offending value, then we continue the legacy derivation chain. (A typed Unknown
// variant would be the fully-correct model, but that is a schema change; the
// scoped fix here is a logged fallback.) A legitimately ABSENT `kind` is not a
// fallback — it is the documented legacy shape — so it logs nothing.
export function conversationKindFromLegacy(input: {
  buddyContext?: BuddyContext | null;
  purpose?: string | null;
  kind?: ConversationKind | null;
}): ConversationKind {
  if (input.kind) {
    const parsed = ConversationKindSchema.safeParse(input.kind);
    if (parsed.success) return parsed.data;
    console.warn(
      '[conversation-kind] invalid `kind` rejected by ConversationKindSchema; falling back to legacy derivation.',
      { issues: parsed.error.issues, raw: truncateForLog(input.kind) }
    );
  }
  if (input.buddyContext) {
    const ctx = BuddyContextSchema.safeParse(input.buddyContext);
    if (ctx.success) return buddyKindFromContext(ctx.data);
  }
  if (input.purpose === 'buddy_builder') return { kind: 'buddy_builder' };
  return { kind: 'general' };
}

// Effective kind for any Conversation-shaped object (compat: derives when field absent).
export function getConversationKind(
  value:
    | {
        kind?: ConversationKind | null;
        buddyContext?: BuddyContext | null;
        purpose?: string | null;
      }
    | null
    | undefined
): ConversationKind {
  if (!value) return { kind: 'general' };
  return conversationKindFromLegacy({
    buddyContext: value.buddyContext ?? null,
    purpose: value.purpose ?? null,
    kind: value.kind ?? null,
  });
}

export function isBuddyConversation(
  value:
    | {
        kind?: ConversationKind | null;
        buddyContext?: BuddyContext | null;
        purpose?: string | null;
      }
    | null
    | undefined
): boolean {
  return getConversationKind(value).kind === 'buddy';
}

export function isBuddyBuilderConversation(
  value:
    | {
        kind?: ConversationKind | null;
        buddyContext?: BuddyContext | null;
        purpose?: string | null;
      }
    | null
    | undefined
): boolean {
  return getConversationKind(value).kind === 'buddy_builder';
}

export function getBuddyContext(
  value:
    | {
        kind?: ConversationKind | null;
        buddyContext?: BuddyContext | null;
      }
    | null
    | undefined
): BuddyContext | null {
  if (!value) return null;
  const kind = getConversationKind(
    value as { kind?: ConversationKind | null; buddyContext?: BuddyContext | null }
  );
  if (isBuddyKind(kind)) return buddyContextFromKind(kind);
  return value.buddyContext ?? null;
}

export function getBuddyId(
  value:
    | {
        kind?: ConversationKind | null;
        buddyContext?: BuddyContext | null;
      }
    | null
    | undefined
): string | null {
  if (!value) return null;
  const kind = getConversationKind(
    value as { kind?: ConversationKind | null; buddyContext?: BuddyContext | null }
  );
  return isBuddyKind(kind) ? kind.buddyId : null;
}

export function getWorkspaceId(value: {
  kind?: ConversationKind | null;
  buddyContext?: BuddyContext | null;
}): string | null {
  const kind = getConversationKind(
    value as { kind?: ConversationKind | null; buddyContext?: BuddyContext | null }
  );
  return isBuddyKind(kind) ? kind.workspaceId : null;
}
