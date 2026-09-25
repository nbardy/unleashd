import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import {
  type BuddyAccessGrant,
  type TeamSetupResult,
  formatBuddyTeamConfigurationToolResult,
} from '@unleashd/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { splitStructuredMessageContent } from '../src/utils/structured-message-segments';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { BuddyTeamConfigurationResult, BuddyTeamSetup, InlineBuddyTeamConfiguration } = await import(
  '../src/components/buddies/BuddyTeamConfiguration'
);
const { MessageRow } = await import('../src/mobile/components/MessageRow');

const membership = {
  present: true,
  incoming: false,
  dispatch: true,
  readAllWork: false,
  pausedReason: null,
  maxActiveRuns: 1,
};
const result: TeamSetupResult = {
  workspaceId: 'font-maker',
  contractVersion: '2026-09-10.4',
  key: 'font-team-setup',
  planHash: 'a'.repeat(64),
  canApply: true,
  blockers: [],
  effects: [
    {
      resource: 'membership',
      id: 'pixel',
      before: membership,
      after: { ...membership, incoming: true },
    },
  ],
  resolvedBuddies: [
    { ref: { id: 'chief' }, id: 'chief', name: 'Chief Scientist' },
    { ref: { id: 'pixel' }, id: 'pixel', name: 'Pixel' },
  ],
  affectedWork: [
    {
      messageId: 'original-audit',
      runId: 'original-run',
      recipientId: 'pixel',
      state: 'held',
      code: 'background_disabled',
    },
  ],
  receipt: { auditId: 'owner-setup-audit', appliedAt: '2026-09-10T13:00:00Z', replayed: false },
  drift: false,
  queuedRuns: [],
  readiness: {
    ready: false,
    blockers: [
      {
        code: 'background_disabled',
        path: 'chief',
        reason: 'Chief cannot receive the return.',
        remedy: 'Enable incoming work for Chief.',
        resolvableBy: 'owner',
      },
    ],
    participants: [
      {
        buddyId: 'chief',
        name: 'Chief Scientist',
        incoming: false,
        dispatch: true,
        readAllWork: false,
        active: true,
      },
      {
        buddyId: 'pixel',
        name: 'Pixel',
        incoming: true,
        dispatch: true,
        readAllWork: false,
        active: true,
      },
    ],
    messages: [
      {
        messageId: 'original-audit',
        runId: 'original-run',
        recipientId: 'pixel',
        state: 'held',
        code: 'background_disabled',
        returnBuddyId: 'chief',
        returnIncoming: false,
      },
    ],
  },
};

test('canonical owner tool result renders setup and unfinished original work in the same chat flow', () => {
  const marker = formatBuddyTeamConfigurationToolResult({
    structuredContent: { teamSetup: result },
  });
  assert.ok(marker);
  const segments = splitStructuredMessageContent(`Before\n🔧 mcp_tool\n${marker}\nAfter`);
  const segment = segments.find((item) => item.type === 'buddy_team_configuration');
  assert.ok(segment && segment.type === 'buddy_team_configuration');
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <InlineBuddyTeamConfiguration payload={segment.json} />
    </MemoryRouter>
  );
  assert.match(html, /Team configuration saved/);
  assert.match(html, /Pixel · held/);
  assert.match(html, /Request original-audit · Run original-run/);
  assert.match(html, /Replies return to Chief Scientist: incoming work disabled/);
  assert.match(html, /Chief cannot receive the return/);
  assert.match(html, /Before/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /All work complete|Apply this team setup/);
  assert.equal(segments.filter((item) => item.type === 'buddy_team_configuration').length, 1);
  assert.deepEqual(
    segments.filter((item) => item.type === 'text').map((item) => item.content),
    ['Before\n', '\nAfter']
  );

  const mobile = renderToStaticMarkup(
    <MemoryRouter>
      <MessageRow
        message={{
          role: 'assistant',
          content: marker,
          timestamp: new Date('2026-09-10T13:00:00Z'),
        }}
        isLast={false}
      />
    </MemoryRouter>
  );
  assert.match(mobile, /Team configuration saved/);
  assert.match(mobile, /original-audit/);
  assert.doesNotMatch(mobile, /buddy_team_configuration:/);
});

test('saved receipt reports subsequent drift and readiness without implying reapplication', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyTeamConfigurationResult
        result={{
          ...result,
          drift: true,
          receipt: { ...result.receipt!, replayed: true },
          affectedWork: [
            {
              ...result.affectedWork[0],
              state: 'completed',
              code: null,
              projectId: 'audit-project',
              acknowledgedAt: '2026-09-10T13:01:00Z',
              acceptedAt: '2026-09-10T13:01:01Z',
              completionEvidence: ['audit/report.md'],
            },
          ],
        }}
      />
    </MemoryRouter>
  );
  assert.match(html, /Existing receipt/);
  assert.match(html, /will not restore old access/);
  assert.match(html, /Enable incoming work for Chief/);
  assert.match(html, /owner-setup-audit/);
  assert.match(html, /Acknowledged 2026-09-10T13:01:00Z/);
  assert.match(html, /Project accepted 2026-09-10T13:01:01Z/);
  assert.match(html, /Completion evidence: audit\/report.md/);
  assert.match(html, /href="\/buddies\/pixel\/work"/);
});

test('primary roster setup keeps private access and admission explicit while preserving existing identities', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyTeamSetup
        buddyId="chief"
        workspaceId="font-maker"
        initialTargetId="pixel"
        targets={[
          {
            id: 'chief',
            name: 'Chief Scientist',
            managerId: null,
            backgroundEnabled: false,
            permissionsEditable: true,
          },
          {
            id: 'pixel',
            name: 'Pixel',
            managerId: null,
            backgroundEnabled: false,
            permissionsEditable: true,
          },
          {
            id: 'path',
            name: 'Path',
            managerId: 'former-manager',
            backgroundEnabled: false,
            permissionsEditable: true,
          },
          {
            id: 'former',
            name: 'Former member',
            managerId: null,
            backgroundEnabled: false,
            permissionsEditable: false,
          },
        ]}
        onApplied={() => {}}
      />
    </MemoryRouter>
  );
  assert.match(html, /name="report"[^>]*checked=""[^>]*value="pixel"/);
  assert.match(html, /Path · will change manager/);
  assert.match(html, /Finish required handoff imports before enabling incoming work/);
  for (const name of ['profiles', 'privateDocuments', 'incoming']) {
    const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(input);
    assert.doesNotMatch(input, /checked/);
  }
  assert.doesNotMatch(html, /name="report"[^>]*value="chief"/);
  assert.doesNotMatch(html, /name="report"[^>]*value="former"/);
});

test('team settings preserves independent permissions and exposes revocation for former members', () => {
  const grant: BuddyAccessGrant = {
    grantee_id: 'chief',
    workspace_id: 'font-maker',
    target_id: 'pixel',
    capabilities: ['profile.write', 'memory.read', 'execution.manage'],
    revision: 4,
    expires_at: '2099-01-02T03:04:05.120Z',
    created_buddy_incoming: false,
    reason: 'Existing responsibilities',
    updated_at: '2026-09-12T00:00:00Z',
  };
  const render = (editable: boolean, staffing = false) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BuddyTeamSetup
          buddyId="chief"
          workspaceId="font-maker"
          initialMode="permissions"
          initialTargetId={staffing ? 'font-maker' : 'pixel'}
          targets={[
            {
              id: 'pixel',
              name: 'Pixel',
              managerId: null,
              backgroundEnabled: false,
              permissionsEditable: editable,
            },
          ]}
          grants={[
            staffing
              ? {
                  ...grant,
                  target_id: 'font-maker',
                  capabilities: ['staff.create'],
                  created_buddy_incoming: true,
                }
              : grant,
          ]}
          onApplied={() => {}}
        />
      </MemoryRouter>
    );
  const html = render(true);
  const input = (name: string) =>
    html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
  assert.match(input('profile.write'), /checked=""/);
  assert.doesNotMatch(input('profile.read'), /checked/);
  assert.match(input('memory.read'), /checked=""/);
  assert.doesNotMatch(input('memory.write'), /checked/);
  assert.match(input('execution.manage'), /checked=""/);
  assert.match(input('expiresAt'), /\.12"/);
  assert.match(html, /Review permissions/);
  assert.match(html, /Review revocation/);
  assert.doesNotMatch(html, /Save access|Individual permissions/);
  const unavailable = render(false);
  assert.match(unavailable, /fieldset disabled=""><legend>Permissions/);
  assert.match(unavailable, /button type="submit" disabled="">Review permissions/);
  const revoke = unavailable.match(/<button[^>]*>Review revocation<\/button>/)?.[0] ?? '';
  assert.match(revoke, /value="revoke"/);
  assert.doesNotMatch(revoke, /disabled/);
  const staffing = render(true, true);
  assert.match(staffing, /name="staff.create"[^>]*checked=""/);
  assert.match(staffing, /name="createdBuddyIncoming"[^>]*checked=""/);
});
