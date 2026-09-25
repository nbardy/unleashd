import { useMemo, useState } from 'react';
import { MobileBadge, MobileSection, MobileSurface } from '../../mobile/components/MobileUI';
import { parseStatsFromPrefix } from '../swarmConvoParsers';

// The swarm debug/setup card on a mobile conversation. Moved out of
// mobile/conversations/ConversationView.tsx (T10) so the core mobile pane
// carries no swarm code; it reaches this only through client/src/swarm/index.ts.
export function MobileSwarmPrefix({ prefix, swarmId }: { prefix: string; swarmId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const stats = useMemo(() => parseStatsFromPrefix(prefix), [prefix]);
  const isSetup = prefix.includes('You are helping create and run a NEW oompa swarm configuration');
  const label = isSetup ? 'Setup' : (swarmId ?? 'debug');
  const title = isSetup ? 'SWARM SETUP' : 'SWARM DEBUG';

  const chips: Array<{ label: string; value: string }> = [];
  if (stats.completed) chips.push({ label: 'Done', value: stats.completed });
  if (stats.merges) chips.push({ label: 'Merges', value: stats.merges });
  if (stats.rejections && stats.rejections !== '0')
    chips.push({ label: 'Rej', value: stats.rejections });
  if (stats.errors && stats.errors !== '0') chips.push({ label: 'Err', value: stats.errors });

  return (
    <MobileSection title={title} meta={label}>
      <MobileSurface style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            {expanded ? '▼' : '▶'}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
          {chips.length > 0 ? (
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {chips.map((c) => (
                <MobileBadge key={c.label} tone="neutral" style={{ fontSize: 10 }}>
                  {c.value} {c.label}
                </MobileBadge>
              ))}
            </span>
          ) : null}
        </button>
        {expanded ? (
          <div
            style={{
              padding: '0 12px 12px',
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 0,
            }}
          >
            <div style={{ display: 'grid', gap: 6, paddingTop: 10 }}>
              {stats.project ? <SwarmRow k="Project" v={stats.project} mono /> : null}
              {stats.primaryConfig ? (
                <SwarmRow k="Primary Config" v={stats.primaryConfig} mono />
              ) : null}
              {stats.generatedAt ? <SwarmRow k="Generated" v={stats.generatedAt} /> : null}
              {stats.started ? <SwarmRow k="Started" v={stats.started} /> : null}
              {stats.runsDir ? <SwarmRow k="Runs" v={stats.runsDir} mono /> : null}
              {stats.iterations ? (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                  <SwarmStat label="Completed" value={stats.completed ?? '—'} />
                  <SwarmStat label="Cycles" value={stats.iterations} />
                  <SwarmStat label="Merges" value={stats.merges ?? '0'} />
                  <SwarmStat label="Rejections" value={stats.rejections ?? '0'} />
                  <SwarmStat label="Errors" value={stats.errors ?? '0'} />
                </div>
              ) : null}
            </div>
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                Raw CLI context
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 8,
                  borderRadius: 'var(--ui-radius)',
                  background: 'var(--bg-page)',
                  fontSize: 10,
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {prefix}
              </pre>
            </details>
          </div>
        ) : null}
      </MobileSurface>
    </MobileSection>
  );
}

function SwarmRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          flex: 'none',
          minWidth: 90,
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontSize: 11,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        }}
      >
        {v}
      </span>
    </div>
  );
}

function SwarmStat({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        minWidth: 52,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
    </span>
  );
}
