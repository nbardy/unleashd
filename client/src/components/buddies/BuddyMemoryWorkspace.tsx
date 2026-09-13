import { type BuddyKnowledgeScope, BuddyMemoryAudienceSchema } from '@unleashd/shared';
import { useCallback, useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyMemoryPanel } from './BuddyMemoryPanel';
import { buddyApi } from './api';
import { normalizeBuddyMemory } from './memory';
import { type Buddy, type BuddyMemoryRecallResult, EMPTY_MEMORY } from './types';

export function BuddyMemoryWorkspace({
  buddy,
  workspaceId,
  variant,
}: {
  buddy: Buddy;
  workspaceId: string;
  variant: 'desktop' | 'mobile';
}) {
  const [selection, setSelection] = useState('');
  const base = `/api/buddies/${encodeURIComponent(buddy.id)}/memory`;
  const query = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const audiences = usePolledFetch<unknown>(`${base}/scopes?${query}`, 0, !!workspaceId);
  const options = BuddyMemoryAudienceSchema.array().safeParse(audiences.data);
  const scope: BuddyKnowledgeScope | undefined = selection ? JSON.parse(selection) : undefined;
  return (
    <>
      <label>
        Memory audience
        <select
          aria-label="Memory audience"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="">Owner memory</option>
          {options.success &&
            options.data.map(
              (option) =>
                option.scope && (
                  <option key={JSON.stringify(option.scope)} value={JSON.stringify(option.scope)}>
                    {option.label}
                  </option>
                )
            )}
        </select>
      </label>
      {audiences.error && <p role="alert">{audiences.error.message}</p>}
      <p>
        {scope
          ? 'These documents belong to the selected conversation or work audience.'
          : 'New owner conversations inherit this memory. Team work keeps separate memory.'}
      </p>
      <ScopedMemory
        key={selection}
        buddy={buddy}
        workspaceId={workspaceId}
        variant={variant}
        scope={scope}
      />
    </>
  );
}

function ScopedMemory({
  buddy,
  workspaceId,
  variant,
  scope,
}: {
  buddy: Buddy;
  workspaceId: string;
  variant: 'desktop' | 'mobile';
  scope?: BuddyKnowledgeScope;
}) {
  const base = `/api/buddies/${encodeURIComponent(buddy.id)}/memory`;
  const audience = JSON.stringify(scope);
  const query = `workspaceId=${encodeURIComponent(workspaceId)}${scope ? `&knowledgeScope=${encodeURIComponent(audience)}` : ''}`;
  const load = useCallback(
    async (signal: AbortSignal) =>
      normalizeBuddyMemory(await buddyApi(`${base}?${query}`, { signal })),
    [base, query]
  );
  const { data, loading, error, refetch } = usePolledFetch(load, 0, !!workspaceId);
  const request = async <T,>(suffix: string, input: unknown, method = 'POST') =>
    buddyApi<T>(`${base}${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(input as object), workspaceId, knowledgeScope: scope }),
    });
  const save = async (suffix: string, input: unknown, method?: string) => {
    await request(suffix, input, method);
    refetch();
  };
  return (
    <BuddyMemoryPanel
      buddy={buddy}
      memory={data ?? EMPTY_MEMORY}
      variant={variant}
      scoped={!!scope}
      error={error?.message ?? null}
      onRetry={refetch}
      onUpdate={
        !data || loading
          ? undefined
          : (kind, content, reasoning, baseVersion) =>
              save(
                `/${kind === 'longTerm' ? 'long_term' : kind}`,
                { content, reasoning, baseVersion },
                'PUT'
              )
      }
      onRememberNote={!data || loading ? undefined : (input) => save('/notes', input)}
      onRecall={
        !data || loading
          ? undefined
          : async (input) =>
              (await request<{ data: BuddyMemoryRecallResult }>('/recall', input)).data
      }
    />
  );
}
