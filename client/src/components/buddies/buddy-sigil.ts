// Generative Buddy avatars ("sigils"): name → seed → palette + style → SVG.
//
// Deterministic and storage-free: the same name always draws the same piece.
// The seed is the Buddy NAME (owner decision, 2026-09-23), so renaming a Buddy
// redraws its avatar. Pure module with no DOM access, so mobile and
// react-dom/server tests can import it.
//
// Output is an SVG data URL rendered through <img>. An <img> isolates the
// document, so gradient/clip ids in one sigil can never collide with another's
// on the same page.
//
// Tuned for 36px: bold shapes, few elements. Changing any handler, the palette
// maths, or the order of random draws redraws EVERY Buddy — bump
// SIGIL_VERSION so the change is deliberate.

export const SIGIL_VERSION = 1;

type Rng = {
  next: () => number;
  range: (lo: number, hi: number) => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
};

function hash32(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

// mulberry32
function createRng(seed: number): Rng {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  };
}

// =============================================================================
// Palette: OKLCH harmony on a dark tint of the base hue. OKLCH keeps inks at
// matched perceived lightness, which is what stops random hues turning muddy.
// =============================================================================
type Palette = { bg: string; inks: readonly [string, string, string, string] };

const HARMONIES = {
  analogous: [0, 30, -30, 60],
  complementary: [0, 180, 20, 200],
  triadic: [0, 120, 240, 60],
  split: [0, 150, 210, 30],
  mono: [0, 8, -8, 15],
} as const;
const HARMONY_NAMES = Object.keys(HARMONIES) as (keyof typeof HARMONIES)[];

function oklch(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${(((h % 360) + 360) % 360).toFixed(1)})`;
}

function createPalette(r: Rng): Palette {
  const hue = r.range(0, 360);
  const offsets = HARMONIES[r.pick(HARMONY_NAMES)];
  const chroma = r.range(0.09, 0.19);
  const ink = (i: 0 | 1 | 2 | 3) =>
    oklch(r.range(0.58, 0.88) - i * 0.03, chroma * r.range(0.8, 1.15), hue + offsets[i]);
  const bg = oklch(r.range(0.22, 0.32), chroma * 0.45, hue + r.range(-20, 20));
  return { bg, inks: [ink(0), ink(1), ink(2), ink(3)] };
}

// =============================================================================
// Styles: one handler per kind, each drawing into a 100×100 viewBox.
// =============================================================================
type Draw = (r: Rng, p: Palette) => string;
const f = (n: number) => n.toFixed(1);

// Quarter circles, half discs, dots and triangles on a 2×2 or 3×3 grid.
const bauhaus: Draw = (r, p) => {
  const n = r.pick([2, 3]);
  const s = 100 / n;
  const h = s / 2;
  const shapes = [
    `<path d="M0 0L${s} 0A${s} ${s} 0 0 1 0 ${s}Z"/>`,
    `<path d="M0 ${h}A${h} ${h} 0 0 1 ${s} ${h}Z"/>`,
    `<circle cx="${h}" cy="${h}" r="${f(s * 0.34)}"/>`,
    `<path d="M0 0L${s} 0L0 ${s}Z"/>`,
  ];
  let out = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ink = r.pick(p.inks);
      const shape = r.pick(shapes);
      const turn = r.int(0, 3) * 90;
      out += `<g transform="translate(${f(x * s)} ${f(y * s)}) rotate(${turn} ${f(h)} ${f(h)})" fill="${ink}">${shape}</g>`;
    }
  }
  return out;
};

// Truchet arcs: each tile picks one of two diagonals; together they read as
// one continuous maze of curves.
const truchet: Draw = (r, p) => {
  const n = r.pick([3, 4]);
  const s = 100 / n;
  const h = s / 2;
  const width = s * r.range(0.16, 0.26);
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const X = x * s;
      const Y = y * s;
      d +=
        r.next() < 0.5
          ? `M${f(X + h)} ${f(Y)}A${f(h)} ${f(h)} 0 0 1 ${f(X)} ${f(Y + h)}M${f(X + s)} ${f(Y + h)}A${f(h)} ${f(h)} 0 0 0 ${f(X + h)} ${f(Y + s)}`
          : `M${f(X + h)} ${f(Y)}A${f(h)} ${f(h)} 0 0 0 ${f(X + s)} ${f(Y + h)}M${f(X)} ${f(Y + h)}A${f(h)} ${f(h)} 0 0 1 ${f(X + h)} ${f(Y + s)}`;
    }
  }
  return `<path d="${d}" stroke="${p.inks[0]}" stroke-width="${f(width)}" fill="none" stroke-linecap="round"/>`;
};

// Off-centre concentric discs, like a planet or a tree cut.
const orbit: Draw = (r, p) => {
  const cx = r.range(30, 70);
  const cy = r.range(30, 70);
  const rings = r.int(4, 7);
  const outer = r.range(60, 80);
  let out = '';
  for (let i = rings; i >= 1; i--) {
    out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f((i / rings) * outer)}" fill="${p.inks[i % 4]}"/>`;
  }
  return out;
};

// Soft glows with a firm core, plus one crisp disc so it stays legible at
// 36px (pure blur made neighbouring Buddies indistinguishable).
const aura: Draw = (r, p) => {
  let defs = '';
  let out = '';
  for (let i = 0; i < 3; i++) {
    const ink = p.inks[i];
    defs += `<radialGradient id="g${i}"><stop offset="0.3" stop-color="${ink}"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></radialGradient>`;
    out += `<circle cx="${f(r.range(15, 85))}" cy="${f(r.range(15, 85))}" r="${f(r.range(40, 60))}" fill="url(#g${i})"/>`;
  }
  out += `<circle cx="${f(r.range(35, 65))}" cy="${f(r.range(35, 65))}" r="${f(r.range(10, 15))}" fill="${p.inks[3]}"/>`;
  return `<defs>${defs}</defs>${out}`;
};

// N-fold petals with an offset inner ring and a centre dot.
const bloom: Draw = (r, p) => {
  const n = r.pick([3, 5, 6, 8]);
  const length = r.range(34, 46);
  const width = r.range(8, 16);
  let out = '';
  for (const [layer, scale] of [
    [0, 1],
    [1, 0.6],
  ] as const) {
    const L = length * scale;
    const W = width * scale;
    const petal = `M50 50C${f(50 - W)} ${f(50 - L * 0.5)} ${f(50 - W * 0.4)} ${f(50 - L)} 50 ${f(50 - L)}C${f(50 + W * 0.4)} ${f(50 - L)} ${f(50 + W)} ${f(50 - L * 0.5)} 50 50Z`;
    for (let i = 0; i < n; i++) {
      const angle = layer * (180 / n) + (360 / n) * i;
      out += `<path transform="rotate(${f(angle)} 50 50)" fill="${p.inks[layer]}" d="${petal}"/>`;
    }
  }
  return `${out}<circle cx="50" cy="50" r="${f(r.range(5, 9))}" fill="${p.inks[2]}"/>`;
};

// Two-ink stripes filling a large clip shape. Every band is inked (no
// background gaps) and the clip is large, so it never reads as a sliver.
const stripes: Draw = (r, p) => {
  const angle = r.pick([0, 30, 45, 60, 90, 135]);
  const bands = r.int(4, 7);
  const w = 160 / bands;
  let bars = '';
  for (let i = 0; i < bands; i++) {
    bars += `<rect x="${f(-30 + i * w)}" y="-30" width="${f(w + 0.5)}" height="160" fill="${p.inks[i % 2]}"/>`;
  }
  const clip = r.pick([
    `<circle cx="50" cy="50" r="${f(r.range(34, 40))}"/>`,
    '<rect x="16" y="16" width="68" height="68" rx="8"/>',
    '<path d="M50 10L90 84L10 84Z"/>',
  ]);
  return `<defs><clipPath id="c">${clip}</clipPath></defs><g clip-path="url(#c)"><g transform="rotate(${angle} 50 50)">${bars}</g></g>`;
};

// Three screen-blended discs spaced around the centre — risograph Venn.
const riso: Draw = (r, p) => {
  const spin = r.range(0, 360);
  const spread = r.range(12, 20);
  let out = '';
  for (let i = 0; i < 3; i++) {
    const a = ((spin + i * 120) * Math.PI) / 180;
    const d = spread * r.range(0.8, 1.2);
    out += `<circle cx="${f(50 + d * Math.cos(a))}" cy="${f(50 + d * Math.sin(a))}" r="${f(r.range(24, 30))}" fill="${p.inks[i]}" style="mix-blend-mode:screen"/>`;
  }
  return out;
};

// Layered horizon waves.
const waves: Draw = (r, p) => {
  const layers = r.int(3, 5);
  let out = '';
  for (let i = 0; i < layers; i++) {
    const y = 30 + (i * 60) / layers;
    const amp = r.range(4, 12);
    const c1 = r.range(20, 45);
    const c2 = r.range(45, 70);
    out += `<path fill="${p.inks[i % 4]}" d="M0 ${f(y)}C${f(c1)} ${f(y - amp)} ${f(c2)} ${f(y + amp)} 100 ${f(y)}L100 100L0 100Z"/>`;
  }
  return out;
};

const STYLES = { bauhaus, truchet, orbit, aura, bloom, stripes, riso, waves } as const;
export type SigilStyle = keyof typeof STYLES;
export const SIGIL_STYLES = Object.keys(STYLES) as SigilStyle[];

export type Sigil = { style: SigilStyle; svg: string };

// `style` pins the style (gallery previews); omitted, the seed chooses it.
export function drawSigil(name: string, style?: SigilStyle): Sigil {
  const r = createRng(hash32(`v${SIGIL_VERSION}:${name}`));
  const palette = createPalette(r);
  const chosen = r.pick(SIGIL_STYLES);
  const drawn = style ?? chosen;
  const body = STYLES[drawn](r, palette);
  return {
    style: drawn,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${palette.bg}"/>${body}</svg>`,
  };
}

const urlCache = new Map<string, string>();

export function buddySigilUrl(name: string): string {
  const cached = urlCache.get(name);
  if (cached !== undefined) return cached;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawSigil(name).svg)}`;
  urlCache.set(name, url);
  return url;
}
