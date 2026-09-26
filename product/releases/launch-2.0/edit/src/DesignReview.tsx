// "Design review" clip: owner asks the Product Development Lead to post screenshots of every
// product view, and the Lead posts Mobile / iPad / Desktop threads of live captures.
// Timeline and camera are data (CUTS, CAMERA); the component just renders them.
// Footage D and timecodes: ../footage/FOOTAGE.md. The real wait is ~6 min; the cut says so.
import type React from 'react';
import {
  AbsoluteFill,
  Easing,
  Freeze,
  OffthreadVideo,
  Series,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { FONT, INK } from './blocks';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Source: 2974×1882 @ 60 fps. Main column x 524–2154, thread pane x 2156–2974 once it is open.
const SRC = { w: 2974, h: 1882 };
const D = staticFile('2026-09-26_design-review_D_post-screenshots-request.mov');

// A cut either plays a source span at a rate, or holds one source frame for a while.
type Play = { kind: 'play'; from: number; to: number; rate: number; note: string };
type Hold = { kind: 'hold'; at: number; seconds: number; note: string };
type Cut = Play | Hold;

const play = (from: number, to: number, rate: number, note: string): Play => ({ kind: 'play', from, to, rate, note });
const hold = (at: number, seconds: number, note: string): Hold => ({ kind: 'hold', at, seconds, note });

// Source seconds. The ending holds on a few screenshots with one quick scroll between them
// (owner, 2026-09-26: rough cut 2 "was too much scrolling at the end").
const REQUEST = play(0.8, 5.3, 1.5, 'request appears in the composer, sent, thread opens');
const CUTS: Cut[] = [
  REQUEST,
  play(392.7, 395.2, 1, '~6 min later: "On it. I\'ve captured all 21 views…" lands'),
  play(395.6, 398.1, 1, 'Mobile / iPad / Desktop posts land in the channel (396.1)'),
  play(425.8, 426.8, 1, 'owner clicks the iPad thread (loading 426.8–430 cut)'),
  hold(431.75, 1.0, 'iPad landscape: the Buddies grid'),
  play(431.75, 435.0, 4, 'quick scroll down the iPad thread'),
  hold(435.0, 0.9, 'iPad landscape: a channel'),
  hold(438.75, 1.3, 'Desktop thread: the Buddies grid'),
];

const cutFrames = (c: Cut) => Math.round((c.kind === 'play' ? (c.to - c.from) / c.rate : c.seconds) * FPS);
const cutStarts = CUTS.reduce<number[]>((acc, c, i) => [...acc, acc[i] + cutFrames(c)], [0]);
export const DURATION = cutStarts[CUTS.length];

// Camera state. A shot lifts the source region [x, x+w] × [top, …] out as a card at `scale`,
// centred over a blurred, dimmed backdrop. focus 0 = that region pixel-aligned in the plain frame.
// zoom is the soft push inside the card, anchored at (ox, oy) as fractions of the card: every
// hold drifts in toward where the action is, so no shot sits dead still.
type Shot = { focus: number; x: number; w: number; top: number; scale: number; zoom: number; ox: number; oy: number };
type Key = { t: number; shot: Shot };

const STILL = { zoom: 1, ox: 0.5, oy: 0.5 };
const COMPOSER: Shot = { focus: 1, x: 540, w: 2080, top: 706, scale: 0.85, ...STILL, ox: 0.35, oy: 0.85 };
const FULL: Shot = { ...COMPOSER, focus: 0 };
const PANE_WAIT: Shot = { focus: 1, x: 2156, w: 818, top: 632, scale: 0.8, ...STILL, oy: 0.3 }; // request + typing
const PANE_REPLY: Shot = { ...PANE_WAIT, top: 480, oy: 0.7 }; // request + "On it"
const POSTS: Shot = { focus: 1, x: 540, w: 1620, top: 800, scale: 1, ...STILL, ox: 0.3, oy: 0.6 }; // iPad link
// Screenshot holds in the pane, framed on each picture (label above it, source rows).
const IPAD_BUDDIES: Shot = { focus: 1, x: 2156, w: 818, top: 740, scale: 1.2, ...STILL, oy: 0.45 };
const IPAD_CHANNEL: Shot = { ...IPAD_BUDDIES, top: 330 };
const DESKTOP_BUDDIES: Shot = { ...IPAD_BUDDIES, top: 150, oy: 0.35 };
const push = (s: Shot, zoom: number): Shot => ({ ...s, zoom });

// Output seconds. Two keys at the same instant are a hard cut.
const at = (cut: number) => cutStarts[cut] / FPS;
const SENT = (3.6 - REQUEST.from) / REQUEST.rate; // the post leaves the composer
const CAMERA: Key[] = [
  { t: 0, shot: FULL },
  { t: 0.15, shot: FULL },
  { t: 0.9, shot: COMPOSER },
  { t: SENT, shot: push(COMPOSER, 1.05) },
  { t: SENT + 0.8, shot: PANE_WAIT },
  { t: at(1), shot: push(PANE_WAIT, 1.04) },
  { t: at(1), shot: PANE_REPLY },
  { t: at(2), shot: push(PANE_REPLY, 1.08) },
  { t: at(2), shot: POSTS },
  { t: at(4), shot: push(POSTS, 1.1) },
  { t: at(4), shot: IPAD_BUDDIES },
  { t: at(5), shot: push(IPAD_BUDDIES, 1.05) },
  { t: at(6), shot: IPAD_CHANNEL },
  { t: at(7), shot: push(IPAD_CHANNEL, 1.05) },
  { t: at(7), shot: DESKTOP_BUDDIES },
  { t: DURATION / FPS, shot: push(DESKTOP_BUDDIES, 1.06) },
];

const ease = Easing.inOut(Easing.cubic);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

const shotAt = (t: number): Shot => {
  const i = CAMERA.slice(0, -1).findLastIndex((k) => k.t <= t);
  const a = CAMERA[i].shot;
  const b = CAMERA[i + 1].shot;
  const u = ease(Math.min(1, (t - CAMERA[i].t) / (CAMERA[i + 1].t - CAMERA[i].t)));
  return {
    focus: lerp(a.focus, b.focus, u),
    x: lerp(a.x, b.x, u),
    w: lerp(a.w, b.w, u),
    top: lerp(a.top, b.top, u),
    scale: lerp(a.scale, b.scale, u),
    zoom: lerp(a.zoom, b.zoom, u),
    ox: lerp(a.ox, b.ox, u),
    oy: lerp(a.oy, b.oy, u),
  };
};

// Full frame: the source covers the 16:9 output (crops ~67 px top and bottom).
const COVER = WIDTH / SRC.w;
const COVER_Y = (HEIGHT - SRC.h * COVER) / 2;
const CARD_H = HEIGHT - 80;

type FootageProps<C> = { cut: C; style: React.CSSProperties };

const PlayFootage: React.FC<FootageProps<Play>> = ({ cut, style }) => (
  <OffthreadVideo
    src={D}
    trimBefore={Math.round(cut.from * FPS)}
    playbackRate={cut.rate}
    muted
    style={{ position: 'absolute', maxWidth: 'none', ...style }}
  />
);

const HoldFootage: React.FC<FootageProps<Hold>> = ({ cut, style }) => (
  <Freeze frame={0}>
    <OffthreadVideo
      src={D}
      trimBefore={Math.round(cut.at * FPS)}
      muted
      style={{ position: 'absolute', maxWidth: 'none', ...style }}
    />
  </Freeze>
);

const Footage: React.FC<FootageProps<Cut>> = ({ cut, style }) =>
  cut.kind === 'play' ? <PlayFootage cut={cut} style={style} /> : <HoldFootage cut={cut} style={style} />;

// The honest time-skip: the Lead took about six minutes to capture 21 views at four sizes.
const LaterChip: React.FC<{ u: number }> = ({ u }) => {
  const o = interpolate(u, [0, 0.2, 1.3, 1.6], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(u, [0, 0.3], [16, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 70,
        display: 'flex',
        justifyContent: 'center',
        opacity: o,
        transform: `translateY(${y}px)`,
      }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontSize: 44,
          fontWeight: 700,
          fontStretch: '90%',
          color: INK.cream,
          background: INK.surface,
          padding: '10px 28px 14px',
          borderRadius: 999,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        }}
      >
        6 minutes later
      </span>
    </div>
  );
};

const Frame: React.FC<{ cut: Cut; startFrame: number; chip: boolean }> = ({ cut, startFrame, chip }) => {
  const frame = useCurrentFrame();
  const { focus, x, w, top, scale: s, zoom, ox, oy } = shotAt((startFrame + frame) / FPS);

  // Card rect interpolated from where the region sits in the full frame (focus 0) to the
  // centred card (focus 1). At focus 0 the card is pixel-aligned with the backdrop.
  const scale = lerp(COVER, s, focus);
  const cardH = lerp(SRC.h * COVER, Math.min(CARD_H, (SRC.h - top) * s), focus);
  const cardX = lerp(x * COVER, (WIDTH - w * s) / 2, focus);
  const cardY = lerp(COVER_Y, (HEIGHT - cardH) / 2, focus);
  const srcTop = lerp(0, top, focus);

  return (
    <AbsoluteFill style={{ backgroundColor: INK.night, overflow: 'hidden' }}>
      <Footage
        cut={cut}
        style={{
          left: 0,
          top: COVER_Y,
          width: SRC.w * COVER,
          height: SRC.h * COVER,
          filter: `blur(${28 * focus}px) brightness(${1 - 0.45 * focus})`,
          transform: `scale(${1 + 0.06 * focus})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: cardX,
          top: cardY,
          width: w * scale,
          height: cardH,
          overflow: 'hidden',
          borderRadius: 14 * focus,
          boxShadow: `0 ${30 * focus}px ${90 * focus}px rgba(0,0,0,${0.6 * focus})`,
          outline: `1px solid rgba(255,255,255,${0.08 * focus})`,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: `${ox * 100}% ${oy * 100}%` }}>
          <Footage
            cut={cut}
            style={{ left: -x * scale, top: -srcTop * scale, width: SRC.w * scale, height: SRC.h * scale }}
          />
        </div>
      </div>
      {chip && <LaterChip u={frame / FPS} />}
    </AbsoluteFill>
  );
};

export const DesignReview: React.FC = () => (
  <Series>
    {CUTS.map((cut, i) => (
      <Series.Sequence key={cut.note} durationInFrames={cutFrames(cut)}>
        <Frame cut={cut} startFrame={cutStarts[i]} chip={i === 1} />
      </Series.Sequence>
    ))}
  </Series>
);
