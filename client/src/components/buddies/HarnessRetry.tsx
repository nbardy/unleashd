import {
  type BuddyMailingListPost,
  type ConversationConfig,
  RETRY_PROVIDER_EVIDENCE_PREFIX,
  type ProviderCatalog,
  evidenceField,
  isHarnessRetryFailure,
  isOutOfTokensFailure,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { DIRECT_CHAINS_URL, chainForConversation, directChainsAtom } from '../../atoms/dm-chain';
import { type BuddyContext, createConversation } from '../../atoms/pending-creations';
import { invalidateResources } from '../../atoms/resources';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { ConversationConfigPicker } from '../ConversationConfigPicker';
import { buddyApi } from './api';
import './HarnessRetry.css';

function firstOtherConfig(
  catalog: ProviderCatalog,
  excluded: string | null,
  requiresBuddyMcp: boolean
): ConversationConfig | null {
  const provider = catalog.providers.find(
    (candidate) =>
      candidate.id !== excluded && (!requiresBuddyMcp || candidate.supportsRequiredMcp)
  );
  if (!provider) return null;
  return {
    provider: provider.id,
    model: { mode: 'default' },
    reasoning: { mode: 'default' },
  };
}

export function HarnessRetry({
  excludedProvider,
  requiresBuddyMcp,
  busy,
  error,
  outOfTokens,
  onRetry,
}: {
  excludedProvider: string | null;
  requiresBuddyMcp: boolean;
  busy: boolean;
  error: string | null;
  outOfTokens: boolean;
  onRetry(config: ConversationConfig): void;
}) {
  const { catalog } = useProviderCatalog();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConversationConfig | null>(null);
  const seed = catalog ? firstOtherConfig(catalog, excludedProvider, requiresBuddyMcp) : null;
  const value = draft ?? seed;
  const different = value !== null && value.provider !== excludedProvider;

  return (
    <div className="harness-retry">
      <button
        type="button"
        className="harness-retry__open"
        disabled={busy}
        onClick={() => {
          setDraft(seed);
          setOpen(true);
        }}
      >
        {busy ? 'Retrying…' : 'Retry with a different harness'}
      </button>
      {error ? (
        <p className="harness-retry__error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <>
          <button
            type="button"
            className="harness-retry__backdrop"
            aria-label="Close harness picker"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <dialog
            open
            className="harness-retry__dialog"
            aria-label="Retry with a different harness"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setOpen(false);
            }}
          >
            <p className="harness-retry__note">
              {outOfTokens
                ? 'This harness is out of tokens. The retry runs on the one you pick.'
                : 'This harness couldn’t finish the turn. The retry runs on the one you pick.'}
            </p>
            {catalog && value ? (
              <ConversationConfigPicker
                value={value}
                catalog={catalog}
                providerFilter={(providerId) =>
                  providerId !== excludedProvider &&
                  (!requiresBuddyMcp ||
                    catalog.providers.some(
                      (provider) => provider.id === providerId && provider.supportsRequiredMcp
                    ))
                }
                onChange={setDraft}
              />
            ) : (
              <p className="harness-retry__note">
                {catalog
                  ? 'No other harness can run this.'
                  : 'Loading harness options…'}
              </p>
            )}
            <div className="harness-retry__actions">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="harness-retry__confirm"
                disabled={!different || busy}
                onClick={() => {
                  if (!value || !different) return;
                  setOpen(false);
                  onRetry(value);
                }}
              >
                Retry
              </button>
            </div>
          </dialog>
        </>
      ) : null}
    </div>
  );
}

/** The button under a channel failure notice. Other failures stay plain text. */
export function OutOfTokensChannelRetry({ post }: { post: BuddyMailingListPost }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (post.purpose !== 'reply_failed' || !isHarnessRetryFailure(post.body)) return null;
  const excluded = evidenceField(post.evidence, RETRY_PROVIDER_EVIDENCE_PREFIX);
  return (
    <HarnessRetry
      excludedProvider={excluded}
      requiresBuddyMcp
      busy={busy}
      error={error}
      outOfTokens={isOutOfTokensFailure(post.body)}
      onRetry={(config) => {
        setBusy(true);
        setError(null);
        buddyApi(
          `/api/buddies/lists/${encodeURIComponent(post.listId)}/posts/${encodeURIComponent(post.id)}/retry`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config }),
          }
        )
          .then(() => {
            setBusy(false);
            invalidateResources((key) => key.includes(`/api/buddies/lists/${post.listId}/`));
          })
          .catch((cause: unknown) => {
            setBusy(false);
            setError(cause instanceof Error ? cause.message : String(cause));
          });
      }}
    />
  );
}

function lastOwnerText(messages: readonly { role: string; content: string }[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content.trim()) return message.content;
  }
  return null;
}

/**
 * A chat whose latest attempt ran out of tokens. A Buddy DM opens the next
 * generation, so the old transcript stays above the divider. Any other chat
 * starts a new conversation and resends the last message there.
 */
export function OutOfTokensChatRetry({
  conversationId,
  terminalCause,
  turnActive,
  messages,
  workingDirectory,
  provider,
  requiresBuddyMcp,
  swarmDebugPrefix,
  buddyContext,
  onStarted,
}: {
  conversationId: string;
  terminalCause: string | null;
  turnActive: boolean;
  messages: readonly { role: string; content: string }[];
  workingDirectory: string;
  provider: string | null;
  requiresBuddyMcp: boolean;
  swarmDebugPrefix?: string;
  buddyContext?: BuddyContext;
  onStarted(conversationId: string): void;
}) {
  const chains = useAtomValue(directChainsAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = lastOwnerText(messages);
  if (terminalCause !== 'out_of_tokens' || turnActive || !text) return null;
  const chain = chainForConversation(chains, conversationId);
  return (
    <HarnessRetry
      excludedProvider={provider}
      requiresBuddyMcp={requiresBuddyMcp}
      busy={busy}
      error={error}
      outOfTokens
      onRetry={(config) => {
        setBusy(true);
        setError(null);
        const fail = (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        };
        if (chain) {
          buddyApi<{ conversationId: string }>(
            `/api/buddies/${encodeURIComponent(chain.buddyId)}/direct/new-chat`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspaceId: chain.workspaceId, config, message: text }),
            }
          )
            .then(({ conversationId: nextId }) => {
              invalidateResources((key) => key === DIRECT_CHAINS_URL);
              setBusy(false);
              onStarted(nextId);
            })
            .catch(fail);
          return;
        }
        try {
          const nextId = createConversation({
            workingDirectory,
            config,
            initialMessage: text,
            swarmDebugPrefix,
            buddyContext,
          });
          setBusy(false);
          onStarted(nextId);
        } catch (cause) {
          fail(cause);
        }
      }}
    />
  );
}
