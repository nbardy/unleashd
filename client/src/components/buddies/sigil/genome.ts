// Buddy sigil genome: name → latent vector → continuous render parameters.
//
// There are no style categories. A name hashes to a Gaussian latent z ∈ R^32;
// a FIXED decoder expands z into every parameter the renderer takes: palette,
// symmetry, warp, the weights of a small CPPN (compositional pattern-producing
// network), posterization, contours, figure mask and brush strokes. Nearby
// latents draw nearby pictures, so any latent source works — a text embedding
// of the Buddy's role could replace `nameLatent` without touching the decoder.
//
// A few latent dimensions are named style axes (hue angle, geometric↔organic,
// calm↔busy, luminous↔muted, stroke affinity) with hand-set loadings, so
// parameters co-vary into coherent looks instead of independent noise. Every
// other parameter also reads a seeded random projection of the whole latent.
//
// Pure and DOM-free (mobile and react-dom/server tests import it). Changing the
// decoder, its seed, or the ORDER of `take()` calls redraws every Buddy — bump
// SIGIL_VERSION when you do it on purpose.

export const SIGIL_VERSION = 2;
export const LATENT_DIM = 32;

export type Latent = readonly number[];

export type SigilGenome = {
  palette: {
    hue: number; // degrees
    spread: number; // signed hue travel across t ∈ [0, 1], degrees
    curve: number; // mid-range hue bend
    chroma: number;
    chromaMid: number; // chroma bump at mid t
    lightLow: number;
    lightHigh: number;
    polarity: number; // 0 = light inks on dark ground, 1 = dark inks on light ground
  };
  background: { lightness: number; chroma: number; hue: number };
  frame: { zoom: number; centerX: number; centerY: number; rotation: number };
  symmetry: { order: number; amount: number; mirror: number };
  warp: { amount: number; frequency: number; offsetX: number; offsetY: number };
  mix: { cppn: number; rings: number; noise: number; bands: number }; // sums to 1
  rings: { frequency: number; phase: number; centerX: number; centerY: number };
  bands: { frequency: number; angle: number };
  noiseFrequency: number;
  gain: number;
  posterize: { amount: number; levels: number; softness: number };
  contour: { width: number; count: number; ink: number };
  mask: { amount: number; radius: number; exponent: number; softness: number };
  finish: { grain: number; vignette: number };
  strokes: {
    seed: number;
    count: number;
    length: number;
    width: number;
    alpha: number;
    flow: number; // 0 = along the field gradient, 1 = along its contours
    bias: number;
    colorShift: number;
    tone: number; // −1 darken … +1 lighten
  };
  cppn: {
    // Laid out as the shader's vec4 uniforms: for input i, neurons 0-3 then
    // 4-7. layer1: 6 inputs (x, y, r, d, noise, bias); layer2: 9 inputs
    // (8 hidden + bias); out: 8 weights, then bias at [8].
    layer1: Float32Array; // 6 × 8
    layer2: Float32Array; // 9 × 8
    out: Float32Array; // 8, then bias at [8]
    activation: Float32Array; // 8 blends: 0 = sin, 1 = tanh
    frequency: number;
  };
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
function uniformStream(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller; 1 − u keeps log() off zero.
function gaussianStream(seed: number): () => number {
  const next = uniformStream(seed);
  return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

export function nameSeed(name: string): number {
  return hash32(`sigil:${name}`);
}

export function nameLatent(name: string): Latent {
  const next = gaussianStream(hash32(`sigil-latent:${name}`));
  return Array.from({ length: LATENT_DIM }, next);
}

export function lerpLatent(a: Latent, b: Latent, t: number): Latent {
  // Spherical-ish: renormalise so the midpoint keeps a typical latent norm
  // instead of shrinking toward the origin (which would look washed out).
  const mixed = a.map((x, i) => x * (1 - t) + b[i] * t);
  const norm = (v: Latent) => Math.hypot(...v);
  const target = norm(a) * (1 - t) + norm(b) * t;
  const scale = target / Math.max(norm(mixed), 1e-9);
  return mixed.map((x) => x * scale);
}

// The fixed decoder: DECODER_ROWS seeded random directions in latent space.
// Each parameter reads one row's projection, so all 32 dimensions shape it.
const CPPN_WEIGHT_COUNT = 6 * 8 + 9 * 8 + 9 + 8;
const DECODER_ROWS = 64 + CPPN_WEIGHT_COUNT;
const DECODER = (() => {
  const next = gaussianStream(hash32('buddy-sigil-decoder-v2'));
  const scale = 1 / Math.sqrt(LATENT_DIM);
  return Array.from({ length: DECODER_ROWS }, () =>
    Float64Array.from({ length: LATENT_DIM }, () => next() * scale)
  );
})();

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const lerp = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;

export function decodeGenome(z: Latent, seed: number): SigilGenome {
  const projected = DECODER.map((row) => row.reduce((sum, w, i) => sum + w * z[i], 0));
  let cursor = 0;
  // Each call consumes the next decoder row (≈ N(0, 1)). Order is part of the
  // genome definition — see the header.
  const take = () => projected[cursor++];

  // Named style axes.
  const geometric = Math.tanh(z[2]); // −1 organic … +1 geometric
  const busy = z[3];
  const luminous = z[4];
  const strokey = z[5];

  const hue = ((Math.atan2(z[1], z[0]) * 180) / Math.PI + 360) % 360;
  const chroma = lerp(0.08, 0.21, sig(0.9 * luminous + 0.6 * take()));
  const lightLow = lerp(0.28, 0.5, sig(take()));
  const palette = {
    hue,
    spread: 200 * Math.tanh(0.7 * take()),
    curve: 0.6 * Math.tanh(take()),
    chroma,
    chromaMid: lerp(-0.4, 0.8, sig(take())),
    lightLow,
    lightHigh: Math.min(0.96, lightLow + lerp(0.35, 0.6, sig(take() + 0.5 * luminous))),
    polarity: sig(1.3 * take() - 1.6),
  };
  const background = {
    lightness: lerp(lerp(0.13, 0.24, sig(take())), lerp(0.86, 0.95, sig(take())), palette.polarity),
    chroma: chroma * lerp(0.2, 0.8, sig(take())),
    hue: hue + 40 * Math.tanh(take()),
  };

  const frame = {
    zoom: lerp(0.6, 1.8, sig(0.9 * busy + 0.6 * take())),
    centerX: 0.25 * Math.tanh(take()),
    centerY: 0.25 * Math.tanh(take()),
    rotation: Math.PI * Math.tanh(take()),
  };
  const symmetry = {
    order: lerp(1, 8, sig(take())),
    amount: sig(1.6 * geometric + 0.8 * take() - 0.2),
    mirror: sig(1.2 * take()),
  };
  const warp = {
    amount: lerp(0, 0.6, sig(-1.8 * geometric + 0.8 * take() - 0.8)),
    frequency: lerp(0.4, 1.6, sig(take())),
    offsetX: 10 * take(),
    offsetY: 10 * take(),
  };
  const weights = {
    cppn: Math.exp(-1.2 * geometric + 0.8 * take()),
    rings: Math.exp(1.0 * geometric + 0.8 * take() - 0.3),
    noise: Math.exp(-0.6 * geometric + 0.8 * take() - 1.6),
    bands: Math.exp(0.8 * geometric + 0.8 * take() - 0.6),
  };
  const total = weights.cppn + weights.rings + weights.noise + weights.bands;
  const mix = {
    cppn: weights.cppn / total,
    rings: weights.rings / total,
    noise: weights.noise / total,
    bands: weights.bands / total,
  };
  const rings = {
    frequency: lerp(3, 16, sig(0.8 * busy + 0.6 * take())),
    phase: Math.PI * take(),
    centerX: 0.5 * Math.tanh(take()),
    centerY: 0.5 * Math.tanh(take()),
  };
  const bands = {
    frequency: lerp(2, 12, sig(0.8 * busy + 0.6 * take())),
    angle: Math.PI * take(),
  };
  const noiseFrequency = lerp(0.4, 1.8, sig(0.7 * busy + 0.6 * take()));
  const gain = lerp(1.2, 4, sig(take()));
  const posterize = {
    amount: sig(2 * geometric + 0.8 * take() + 0.3),
    levels: lerp(2, 7, sig(0.8 * busy + 0.6 * take())),
    softness: lerp(0, 0.25, sig(-1.5 * geometric + take() - 1)),
  };
  const contour = {
    width: Math.max(0, lerp(-1.5, 3, sig(take()))),
    count: lerp(2, 10, sig(0.7 * busy + 0.6 * take())),
    ink: sig(1.5 * take()),
  };
  const mask = {
    amount: sig(1.2 * geometric + 0.8 * take() + 0.8),
    radius: lerp(0.55, 0.85, sig(take())),
    exponent: Math.exp(lerp(Math.log(0.9), Math.log(5), sig(take()))),
    softness: lerp(0.005, 0.06, sig(-geometric + take() - 1)),
  };
  const finish = {
    grain: lerp(0, 0.05, sig(take() - 0.5)),
    vignette: lerp(0, 0.35, sig(take())),
  };
  const strokes = {
    seed,
    count: Math.floor(400 * sig(1.8 * strokey - 1.2 + 0.4 * take()) ** 1.5),
    length: lerp(12, 60, sig(take() - 0.5 * busy)),
    width: lerp(0.8, 3.2, sig(take() - 0.4 * busy)),
    alpha: lerp(0.35, 0.95, sig(take())),
    flow: sig(1.5 * take()),
    bias: 0.3 * Math.PI * take(),
    colorShift: 0.35 * Math.tanh(take()),
    tone: Math.tanh(take()),
  };

  cursor = 64;
  const layer1Scale = 1.6 * (1 + 0.3 * Math.tanh(busy));
  const layer1 = Float32Array.from({ length: 6 * 8 }, () => take() * layer1Scale);
  const layer2 = Float32Array.from({ length: 9 * 8 }, () => take() * 1.2);
  const out = Float32Array.from({ length: 9 }, () => take() * 1.5);
  const activation = Float32Array.from({ length: 8 }, () => sig(1.5 * take()));
  const cppn = { layer1, layer2, out, activation, frequency: lerp(1, 3, sig(z[6])) };

  return {
    palette,
    background,
    frame,
    symmetry,
    warp,
    mix,
    rings,
    bands,
    noiseFrequency,
    gain,
    posterize,
    contour,
    mask,
    finish,
    strokes,
    cppn,
  };
}

export function nameGenome(name: string): SigilGenome {
  return decodeGenome(nameLatent(name), nameSeed(name));
}

/** CSS colour of the ground — what a not-yet-rendered sigil shows. */
export function backgroundCss(genome: SigilGenome): string {
  const { lightness, chroma, hue } = genome.background;
  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}
