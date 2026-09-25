// Beats 1–5, the open. One agent chat: type, send, it pops, it minimizes. A second one. Then the
// pace ramps (1, 2, 4, 8, 16, 30 a second) until chat windows bury the frame. Hard cut to black:
// "AI Overload! We're all feeling it." Then the title, "Introducing Unleashd 2.0".
// The windows are deliberately generic chat apps (no real product UI or marks): the first thing
// that looks like Unleashd is the title. Timeline is data (FOCUS, GAPS, T); components pose it.
import type React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, random, useCurrentFrame } from 'remotion';
import wordmark from '../../brand/unleashd-wordmark-3d_trimmed.png';
import { Block, INK, clamp01, easeOutBack, lerp } from './blocks';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Output seconds. Music should put a hit on every pile arrival up to the 1/16 s run.
const T = {
  rampStart: 6.2, // first pile window; the ramp runs 5 s (sum of GAPS)
  cut: 11.7, // hard cut to black and near silence
  title: 15.0, // voice line "Don't worry, we've got you covered." sits ~13.4–15.0 over the card
  end: 18.0,
};
export const DURATION = Math.round(T.end * FPS);
const frames = (s: number) => Math.round(s * FPS);

// ---- Chat window skins -------------------------------------------------------------------------

type Layout = 'chat' | 'terminal';
type Skin = {
  layout: Layout;
  font: string;
  bg: string;
  bar: string;
  text: string;
  line: string; // history skeleton bars
  bubble: string;
  bubbleText: string;
  composer: string;
};
const SANS = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", Menlo, Consolas, monospace';

type Look = 'paper' | 'night' | 'cream' | 'ide' | 'mint' | 'terminal';
const SKINS: Record<Look, Skin> = {
  paper: { layout: 'chat', font: SANS, bg: '#ffffff', bar: '#eceef1', text: '#1f2328', line: '#e1e4e8', bubble: '#2f6feb', bubbleText: '#fff', composer: '#f3f4f6' },
  night: { layout: 'chat', font: SANS, bg: '#1e1f22', bar: '#2b2d31', text: '#e6e6e6', line: '#34363c', bubble: '#7c5cff', bubbleText: '#fff', composer: '#2b2d31' },
  cream: { layout: 'chat', font: SANS, bg: '#faf7f2', bar: '#efe9df', text: '#2b2622', line: '#e8e0d3', bubble: '#d9772b', bubbleText: '#fff', composer: '#f1ebe1' },
  ide: { layout: 'chat', font: SANS, bg: '#1e1e1e', bar: '#252526', text: '#d4d4d4', line: '#303030', bubble: '#0e639c', bubbleText: '#fff', composer: '#2d2d2d' },
  mint: { layout: 'chat', font: SANS, bg: '#f3fbf7', bar: '#dcf1e7', text: '#183b2c', line: '#d3ebdf', bubble: '#1f9d6b', bubbleText: '#fff', composer: '#e6f5ee' },
  terminal: { layout: 'terminal', font: MONO, bg: '#0c0c0c', bar: '#1c1c1c', text: '#d0d7de', line: '#1f2a22', bubble: '#56d364', bubbleText: '#0c0c0c', composer: '#0c0c0c' },
};
const LOOKS = Object.keys(SKINS) as Look[];

// ---- Window content ------------------------------------------------------------------------------

type Tone = 'quiet' | 'warn' | 'error';
type Status = { kind: 'thinking' } | { kind: 'label'; text: string; tone: Tone };

// Placement is the one thing that differs in kind: the first two windows own the frame and then
// minimize into a tray; everything after lands where it lands and stays.
type Place =
  | { kind: 'focus'; scale: number; trayX: number; trayY: number; minimizeAt: number }
  | { kind: 'pile'; x: number; y: number; rot: number; scale: number };

type WindowSpec = {
  at: number; // output seconds the window pops in
  look: Look;
  title: string;
  prompt: string;
  history: number[]; // widths (0–1) of earlier-message skeleton bars
  status: Status;
  typeAt: number; // seconds after `at`
  typeFor: number;
  place: Place;
};
const sendAt = (w: WindowSpec) => w.typeAt + w.typeFor + 0.12;
const statusAt = (w: WindowSpec) => sendAt(w) + 0.3;

const FOCUS: WindowSpec[] = [
  {
    at: 0.25,
    look: 'paper',
    title: 'New chat',
    prompt: 'Refactor the auth module and add tests',
    history: [],
    status: { kind: 'thinking' },
    typeAt: 0.45,
    typeFor: 2.1,
    place: { kind: 'focus', scale: 1.45, trayX: 190, trayY: 84, minimizeAt: 3.45 },
  },
  {
    at: 4.1,
    look: 'night',
    title: 'agent — api-server',
    prompt: 'Why is CI failing on main?',
    history: [0.7, 0.45],
    status: { kind: 'label', text: 'Running tool 3 of 14', tone: 'quiet' },
    typeAt: 0.3,
    typeFor: 0.95,
    place: { kind: 'focus', scale: 1.3, trayX: 410, trayY: 84, minimizeAt: 1.8 },
  },
];

const PROMPTS = [
  'fix the flaky login test',
  'write the migration for orders',
  'summarize this PR for me',
  'add dark mode to settings',
  'find the memory leak',
  'rename userId everywhere',
  'is this safe to deploy?',
  'draft the release notes',
  'review my SQL',
  'undo what you just did',
  'keep going',
  'which branch are you on??',
  'make the tests pass',
  'port this to Rust',
  'update the docs too',
  'why is prod slow',
  'try again',
  'no, the OTHER config file',
  'bump every dependency',
  'answer the support ticket',
  'did you push that?',
  'plan the Q4 roadmap',
  'add retries to the webhook',
  'what were we doing?',
  'write the investor update',
  'ship it',
  'stop. wait. go back',
  "check the other agent's work",
];
const TITLES = ['New chat', 'Assistant', 'zsh — agent', 'web — agent', 'Untitled', 'research', 'infra', 'support-bot', 'Chat', 'mobile — agent', 'billing', 'docs'];
const STATUSES: Status[] = [
  { kind: 'thinking' },
  { kind: 'label', text: 'Needs your approval', tone: 'warn' },
  { kind: 'label', text: 'Editing 41 files', tone: 'quiet' },
  { kind: 'thinking' },
  { kind: 'label', text: 'Waiting for input', tone: 'warn' },
  { kind: 'label', text: 'Rate limited, retrying', tone: 'error' },
  { kind: 'label', text: 'Running tool 9 of 30', tone: 'quiet' },
  { kind: 'label', text: 'Context limit reached', tone: 'error' },
];

// Arrival gaps: 2 a second, then 4, 8, 16, 30 — one second each, "too many to count" by the end.
const GAPS = (
  [
    [0.5, 2],
    [0.25, 4],
    [0.125, 8],
    [1 / 16, 16],
    [1 / 30, 30],
  ] as const
).flatMap(([gap, n]) => Array<number>(n).fill(gap));
const ARRIVALS = GAPS.reduce<number[]>((acc, gap, i) => [...acc, acc[i] + gap], [T.rampStart]).slice(0, -1);

const W = 640;
const H = 420;

const PILE: WindowSpec[] = ARRIVALS.map((at, i) => {
  const r = (k: string) => random(`${k}-${i}`);
  const pick = <V,>(xs: readonly V[], k: string) => xs[Math.floor(r(k) * xs.length)];
  // Early arrivals land near the middle where they can be read; the spread grows to the edges.
  const spread = lerp(0.45, 1, clamp01(i / 12));
  return {
    at,
    look: pick(LOOKS, 'look'),
    title: pick(TITLES, 'title'),
    prompt: PROMPTS[i % PROMPTS.length],
    history: Array.from({ length: Math.floor(r('hist') * 3) }, (_, j) => lerp(0.35, 0.8, r(`bar${j}`))),
    status: STATUSES[i % STATUSES.length],
    typeAt: 0.08,
    typeFor: Math.min(0.9, Math.max(0.2, GAPS[i] * 2.5)),
    place: {
      kind: 'pile',
      x: WIDTH / 2 + (r('x') - 0.5) * WIDTH * 1.05 * spread,
      y: HEIGHT / 2 + (r('y') - 0.5) * HEIGHT * 1.05 * spread,
      rot: lerp(-7, 7, r('rot')),
      scale: lerp(0.72, 1, r('scale')),
    },
  };
});

const WINDOWS = [...FOCUS, ...PILE];

// ---- Window rendering ----------------------------------------------------------------------------

const TONE: Record<Tone, (skin: Skin) => React.CSSProperties> = {
  quiet: (skin) => ({ color: skin.text, opacity: 0.6 }),
  warn: () => ({ background: '#f5b300', color: '#1a1400', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }),
  error: () => ({ background: '#e5484d', color: '#fff', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }),
};

// Thin dispatcher: the status kind picks the rendering.
const StatusLine: React.FC<{ status: Status; skin: Skin; u: number }> = ({ status, skin, u }) => {
  switch (status.kind) {
    case 'thinking':
      return <span style={{ color: skin.text, opacity: 0.6 }}>Thinking{'.'.repeat(1 + (Math.floor(u * 4) % 3))}</span>;
    case 'label':
      return <span style={TONE[status.tone](skin)}>{status.text}</span>;
  }
};

type BodyProps = { spec: WindowSpec; skin: Skin; u: number };

const typedText = ({ spec, u }: BodyProps) =>
  spec.prompt.slice(0, Math.round(clamp01((u - spec.typeAt) / spec.typeFor) * spec.prompt.length));
const caretOn = (u: number) => Math.floor(u * 2.2) % 2 === 0;

const ChatBody: React.FC<BodyProps> = (p) => {
  const { spec, skin, u } = p;
  const sent = u >= sendAt(spec);
  const pop = easeOutBack(clamp01((u - sendAt(spec)) / 0.25), 2.4);
  const press = 1 - 0.18 * Math.max(0, 1 - Math.abs(u - sendAt(spec)) / 0.08);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px 22px', gap: 12 }}>
      {spec.history.map((w, j) => (
        <div
          key={j}
          style={{ height: 16, width: `${w * 100}%`, borderRadius: 8, background: skin.line, alignSelf: j % 2 ? 'flex-end' : 'flex-start' }}
        />
      ))}
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '82%',
          background: skin.bubble,
          color: skin.bubbleText,
          padding: '10px 16px',
          borderRadius: 18,
          fontSize: 19,
          lineHeight: 1.3,
          transformOrigin: 'bottom right',
          transform: `scale(${sent ? pop : 0})`,
        }}
      >
        {spec.prompt}
      </div>
      <div style={{ fontSize: 16, visibility: u >= statusAt(spec) ? 'visible' : 'hidden' }}>
        <StatusLine status={spec.status} skin={skin} u={u} />
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: skin.composer,
          borderRadius: 14,
          padding: '12px 12px 12px 18px',
          border: `1px solid ${skin.line}`,
        }}
      >
        <span style={{ flex: 1, fontSize: 19, color: skin.text, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {sent ? '' : typedText(p)}
          <span style={{ opacity: caretOn(u) ? 1 : 0 }}>|</span>
        </span>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: skin.bubble,
            color: skin.bubbleText,
            display: 'grid',
            placeItems: 'center',
            fontSize: 20,
            fontWeight: 700,
            transform: `scale(${press})`,
          }}
        >
          ↑
        </span>
      </div>
    </div>
  );
};

const TerminalBody: React.FC<BodyProps> = (p) => {
  const { spec, skin, u } = p;
  const sent = u >= sendAt(spec);
  const prompt = <span style={{ color: skin.bubble }}>{'> '}</span>;
  const caret = <span style={{ background: skin.text, opacity: caretOn(u) ? 1 : 0 }}>&nbsp;</span>;
  return (
    <div style={{ flex: 1, padding: '16px 20px', fontSize: 18, lineHeight: 1.6, color: skin.text, display: 'flex', flexDirection: 'column' }}>
      {spec.history.map((w, j) => (
        <div key={j} style={{ height: 12, margin: '8px 0', width: `${w * 100}%`, background: skin.line }} />
      ))}
      <div>
        {prompt}
        {sent ? spec.prompt : typedText(p)}
        {sent ? null : caret}
      </div>
      <div style={{ visibility: u >= statusAt(spec) ? 'visible' : 'hidden' }}>
        <StatusLine status={spec.status} skin={skin} u={u} />
      </div>
      <div style={{ visibility: sent ? 'visible' : 'hidden' }}>
        {prompt}
        {caret}
      </div>
    </div>
  );
};

const BODY: Record<Layout, React.FC<BodyProps>> = { chat: ChatBody, terminal: TerminalBody };

const ChatWindow: React.FC<{ spec: WindowSpec; u: number }> = ({ spec, u }) => {
  const skin = SKINS[spec.look];
  const Body = BODY[skin.layout];
  return (
    <div
      style={{
        width: W,
        height: H,
        borderRadius: 14,
        overflow: 'hidden',
        background: skin.bg,
        fontFamily: skin.font,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)',
      }}
    >
      <div style={{ height: 38, background: skin.bar, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
        ))}
        <span style={{ flex: 1, textAlign: 'center', fontSize: 14, color: skin.text, opacity: 0.7, marginRight: 52 }}>
          {spec.title}
        </span>
      </div>
      <Body spec={spec} skin={skin} u={u} />
    </div>
  );
};

// ---- Placement: where a window is and how big, at its local time u -------------------------------

type Pose = { x: number; y: number; rot: number; scale: number; opacity: number };
const minimize = Easing.inOut(Easing.cubic);

const focusPose = (place: Extract<Place, { kind: 'focus' }>, u: number): Pose => {
  const pop = easeOutBack(clamp01(u / 0.3));
  const m = minimize(clamp01((u - place.minimizeAt) / 0.5));
  return {
    x: lerp(WIDTH / 2, place.trayX, m),
    y: lerp(HEIGHT / 2, place.trayY, m),
    rot: 0,
    scale: lerp(place.scale, 0.3, m) * lerp(0.7, 1, pop),
    opacity: Math.min(clamp01(u / 0.08), lerp(1, 0.55, m)),
  };
};

const pilePose = (place: Extract<Place, { kind: 'pile' }>, u: number): Pose => ({
  x: place.x,
  y: place.y,
  rot: place.rot,
  scale: place.scale * lerp(0.6, 1, easeOutBack(clamp01(u / 0.2), 2.2)),
  opacity: clamp01(u / 0.05),
});

const poseOf = (place: Place, u: number): Pose => {
  switch (place.kind) {
    case 'focus':
      return focusPose(place, u);
    case 'pile':
      return pilePose(place, u);
  }
};

// ---- Scenes ------------------------------------------------------------------------------------------

const Pileup: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const zoom = interpolate(t, [T.rampStart, T.cut], [1, 1.12], {
    easing: Easing.in(Easing.quad),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shake = interpolate(t, [9.2, T.cut], [0, 16], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tick = Math.floor(frame / 2);
  const dx = shake * (random(`shake-x-${tick}`) - 0.5) * 2;
  const dy = shake * (random(`shake-y-${tick}`) - 0.5) * 2;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, #1b212b, #0b0e13 70%)', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${zoom})` }}>
        {WINDOWS.filter((w) => t >= w.at).map((w) => {
          const u = t - w.at;
          const p = poseOf(w.place, u);
          return (
            <div
              key={w.at}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                opacity: p.opacity,
                transform: `translate(${p.x - W / 2}px, ${p.y - H / 2}px) rotate(${p.rot}deg) scale(${p.scale})`,
              }}
            >
              <ChatWindow spec={w} u={u} />
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,.75))',
          opacity: interpolate(t, [T.rampStart, T.cut], [0.3, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      />
    </AbsoluteFill>
  );
};

const OverloadCard: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ background: INK.night, alignItems: 'center', justifyContent: 'center', gap: 44 }}>
      <Block text="AI Overload!" u={t - 0.35} size="xxl" fill={INK.red} ink={INK.cream} rot={-3} />
      <Block text="We're all feeling it." u={t - 0.95} size="md" fill={INK.surface} ink={INK.cream} rot={0} />
    </AbsoluteFill>
  );
};

const Title: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const reveal = Easing.out(Easing.cubic)(clamp01((t - 0.55) / 0.7));
  return (
    <AbsoluteFill style={{ background: INK.night, alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ background: INK.plate, opacity: clamp01(t / 0.5) }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <Block text="Introducing" u={t - 0.3} size="md" fill={INK.surface} ink={INK.cream} rot={0} />
        <Img src={wordmark} style={{ width: 1150, opacity: reveal, transform: `scale(${lerp(0.92, 1, reveal)})` }} />
        <div style={{ position: 'absolute', right: -40, bottom: 40 }}>
          <Block text="2.0" u={t - 1.3} size="xl" fill={INK.wordmarkOrange} ink={INK.plate} rot={-6} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Overload: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={frames(T.cut)}>
      <Pileup />
    </Sequence>
    <Sequence from={frames(T.cut)} durationInFrames={frames(T.title - T.cut)}>
      <OverloadCard />
    </Sequence>
    <Sequence from={frames(T.title)} durationInFrames={frames(T.end - T.title)}>
      <Title />
    </Sequence>
  </AbsoluteFill>
);
