"""Up-tempo EDM cue under the product-features section of the launch video. Synthesized here, so we own it.

Run:  uv run --with numpy python product/releases/launch-2.0/sound/edm.py

128 BPM in B minor / D major, next to the D-major marimba intro. beat = 0.46875 s, bar = 1.875 s.

  bar 1   0.000  BUILD  Bm  half-time filtered kick, chords at 400 Hz lowpass, vocal chop "oh-ah"
  bar 2   1.875         G   four-on-the-floor, snare roll in 8ths
  bar 3   3.750         D   vocal chop "ay-oh", snare 16ths, noise/pitch riser starts
  bar 4   5.625         A   snare 32nds, filter fully open; GAP 7.266-7.500 (dry silence, tails only)
  bar 5   7.500  DROP   Bm  impact + crash + big kick, pumped supersaws, bass, clap, vocal chop
  bar 6   9.375         G
  bar 7  11.250         D   vocal chop
  bar 8  13.125         A   cue ends at 15.000

The drop lands at exactly 7.500 s (sample 360000). Writes stereo 48 kHz 16-bit WAVs next to this file:
edm-build.wav (the mix, peak -1 dBFS) and edm-stem-{drums,music,vox}.wav. The stems sum to the mix
(to 16-bit rounding): the master limiter is a gain envelope computed from the mix and applied
identically to every stem, so the edit can rebalance them. Drums stem also carries the riser, crash
and impact. Deterministic: every element draws noise from its own fixed seed.

Filters are applied in the frequency domain (whole-buffer FFT, or STFT frames for time-varying
cutoffs) instead of synth.py's per-sample loop, which would take minutes on 15 s of stereo.
"""

from pathlib import Path
import wave
import zlib

import numpy as np

SR = 48_000
OUT = Path(__file__).parent
BPM = 128
BEAT = 60 / BPM  # 0.46875 s
BAR = 4 * BEAT  # 1.875 s
DROP = 4 * BAR  # 7.5 s
GAP = DROP - BEAT / 2  # 7.265625 s: the last 1/8 of bar 4 is dry silence
LENGTH = 8 * BAR  # 15.0 s
N = round(LENGTH * SR)
TIME = np.arange(N) / SR
PEAK = 10 ** (-1 / 20)  # -1 dBFS


def rng_for(name: str) -> np.random.Generator:
    """Each element owns its seed, so retuning one element never reshuffles another's noise."""
    return np.random.default_rng(zlib.crc32(name.encode()))


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(round(seconds * SR)) / SR


def at(bar: int, beat: float = 0.0) -> float:
    """Time of a 1-based bar plus a 0-based (fractional) beat."""
    return (bar - 1) * BAR + beat * BEAT


NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi(note: str) -> int:
    return NAMES.index(note[:-1]) + 12 * (int(note[-1]) + 1)


def mhz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def hz(note: str) -> float:
    return mhz(midi(note))


# ---- Filters: analog prototype responses evaluated on FFT bins. fc may be an array (per frame).


def lp(fc, q=0.707):
    return lambda f: 1 / (1 - (f / fc) ** 2 + 1j * f / (fc * q))


def hp(fc, q=0.707):
    return lambda f: -((f / fc) ** 2) / (1 - (f / fc) ** 2 + 1j * f / (fc * q))


def bp(fc, q=1.0):
    return lambda f: (1j * f / (fc * q)) / (1 - (f / fc) ** 2 + 1j * f / (fc * q))


def fft_filter(x: np.ndarray, response) -> np.ndarray:
    """Constant filter over the whole buffer (last axis). Zero-padded so the tail does not wrap."""
    n = x.shape[-1]
    nfft = 1 << int(np.ceil(np.log2(n + SR // 4)))
    f = np.fft.rfftfreq(nfft, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x, nfft) * response(f), nfft)[..., :n]


def tv_filter(x: np.ndarray, response_at, frame: int = 1024, hop: int = 256) -> np.ndarray:
    """Time-varying filter: Hann STFT frames (75% overlap), each multiplied by response_at(f, t)
    at the frame's centre time. f broadcasts as (1, bins), t as (frames, 1)."""
    x2 = np.atleast_2d(x)
    ch, n = x2.shape
    padded = np.concatenate([np.zeros((ch, frame)), x2, np.zeros((ch, 2 * frame))], axis=1)
    count = (n + frame) // hop + 1
    frames = np.lib.stride_tricks.sliding_window_view(padded, frame, axis=1)[:, ::hop][:, :count]
    starts = np.arange(count) * hop
    centres = (starts + frame / 2 - frame) / SR
    f = np.fft.rfftfreq(2 * frame, 1 / SR)
    window = np.hanning(frame + 1)[:-1]  # periodic Hann: overlap-adds to exactly 2 at hop=frame/4
    spec = np.fft.rfft(frames * window, 2 * frame) * response_at(f[None, :], centres[:, None])
    y = np.fft.irfft(spec, 2 * frame)
    out = np.zeros((ch, padded.shape[1] + 2 * frame))
    for k, s in enumerate(starts):
        out[:, s : s + 2 * frame] += y[:, k]
    return (out[:, frame : frame + n] / 2.0).reshape(np.shape(x))


# ---- Placement and envelopes


def panned(x: np.ndarray, pan: float) -> np.ndarray:
    """Mono -> stereo, equal power. pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([np.cos(a) * x, np.sin(a) * x])


def place(bus: np.ndarray, x: np.ndarray, t0: float, gain: float = 1.0) -> None:
    """Add a stereo clip into a bus at t0, truncating at the bus end."""
    s = round(t0 * SR)
    e = min(s + x.shape[-1], bus.shape[-1])
    bus[:, s:e] += gain * x[:, : e - s]


def gate(seconds: float, attack: float, release: float) -> np.ndarray:
    t = t_axis(seconds)
    return np.minimum(1, t / attack) * np.clip((seconds - t) / release, 0, 1)


def smoothstep(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0, 1)
    return u * u * (3 - 2 * u)


def track() -> np.ndarray:
    return np.zeros((2, N))


# ---- Oscillators


def saw(freq: float, n: int, phase0: float) -> np.ndarray:
    """PolyBLEP band-limited sawtooth, vectorised."""
    dt = freq / SR
    ph = (phase0 + dt * np.arange(1, n + 1)) % 1.0
    y = 2 * ph - 1
    lo = ph < dt
    u = ph[lo] / dt
    y[lo] -= 2 * u - u * u - 1
    hi = ph > 1 - dt
    u = (ph[hi] - 1) / dt
    y[hi] -= u * u + 2 * u + 1
    return y


DETUNE_CENTS = [-26, -17, -8, 0, 8, 17, 26]
SPREAD = [-0.9, -0.6, -0.3, 0.0, 0.3, 0.6, 0.9]


def supersaw(f: float, seconds: float, r: np.random.Generator) -> np.ndarray:
    """Seven detuned saws, spread across the stereo field."""
    n = round(seconds * SR)
    return sum(
        panned(saw(f * 2 ** (c / 1200), n, r.uniform()), p) for c, p in zip(DETUNE_CENTS, SPREAD)
    ) / np.sqrt(7)


# ---- Harmony: vi-IV-I-V in D. Bm first answers the intro's D chord; A (V) leads into the drop.

PROGRESSION = [  # (voicing, bass)
    (["F#3", "B3", "D4", "F#4", "B4"], "B1"),
    (["G3", "B3", "D4", "G4", "B4"], "G1"),
    (["F#3", "A3", "D4", "F#4", "A4"], "D2"),
    (["E3", "A3", "C#4", "E4", "A4"], "A1"),
]


def harmony(bar: int):
    return PROGRESSION[(bar - 1) % 4]


def chord_bar(voicing: list[str], r: np.random.Generator, octave_layer: float) -> np.ndarray:
    """One bar of sustained supersaw chord, slightly overlapping the next bar's attack."""
    seconds = BAR + 0.015
    body = sum(supersaw(hz(n), seconds, r) for n in voicing)
    top = supersaw(hz(voicing[-1]) * 2, seconds, r) * octave_layer
    return (body + top) * gate(seconds, 0.006, 0.03)


def pump(depth: float, kicks: list[float], release: float = 0.75 * BEAT) -> np.ndarray:
    """Sidechain gain: duck by `depth` at each kick, curve back to unity over `release`."""
    g = np.ones(N)
    for k in kicks:
        s = round(k * SR)
        e = min(N, s + round(release * SR))
        tt = np.arange(e - s) / SR
        duck = depth * (1 - tt / release) ** 2 * np.minimum(1, tt / 0.003)
        g[s:e] = np.minimum(g[s:e], 1 - duck)
    return g


# ---- Drums and FX


def kick(r, seconds=0.42, f_top=170.0, f_bottom=47.0, decay=0.2, click=0.35) -> np.ndarray:
    t = t_axis(seconds)
    f = f_bottom + (f_top - f_bottom) * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    tick = fft_filter(r.standard_normal(len(t)), hp(2500)) * np.exp(-t / 0.002)
    return np.tanh(1.8 * (body + click * tick)) * np.clip((seconds - t) / 0.02, 0, 1)


def snare(r, tone: float, band: float, decay: float) -> np.ndarray:
    t = t_axis(0.3)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.035)
    body += 0.5 * np.sin(2 * np.pi * tone * 1.62 * t) * np.exp(-t / 0.025)
    noise = fft_filter(r.standard_normal(len(t)), bp(band, 0.7)) * np.exp(-t / decay)
    x = 0.5 * body + 1.4 * noise / np.max(np.abs(noise))
    return x * np.minimum(1, t / 0.0008)


HAT_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]  # 808-style square cluster


def hat(r, decay: float) -> np.ndarray:
    t = t_axis(decay * 6)
    metal = sum(np.sign(np.sin(2 * np.pi * f * 1.5 * t + r.uniform(0, 6.3))) for f in HAT_PARTIALS)
    x = fft_filter(0.6 * metal + r.standard_normal(len(t)), hp(7500, 0.9))
    x = fft_filter(x, lp(14000))
    return x / np.max(np.abs(x)) * np.exp(-t / decay) * np.minimum(1, t / 0.0005)


def clap(r) -> np.ndarray:
    t = t_axis(0.45)
    bursts = sum((t >= o) * np.exp(-np.clip(t - o, 0, None) / 0.006) for o in (0, 0.011, 0.023))
    tail = (t >= 0.034) * np.exp(-np.clip(t - 0.034, 0, None) / 0.13)
    noise = fft_filter(r.standard_normal((2, len(t))), bp(1400, 0.8))
    x = noise * (bursts + tail)
    return x / np.max(np.abs(x))


def crash(r, seconds=3.0) -> np.ndarray:
    t = t_axis(seconds)
    noise = fft_filter(r.standard_normal((2, len(t))), hp(4500))
    metal = sum(
        np.sin(2 * np.pi * r.uniform(3000, 9000) * t + r.uniform(0, 6.3)) for _ in range(40)
    ) / 6
    x = (noise / np.max(np.abs(noise)) + 0.35 * metal) * np.exp(-t / 0.8)
    x = fft_filter(x, lp(13000))
    return x / np.max(np.abs(x)) * np.minimum(1, t / 0.001)


def impact(r) -> np.ndarray:
    t = t_axis(2.4)
    f = 30 + 45 * np.exp(-t / 0.25)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75)
    boom = fft_filter(r.standard_normal(len(t)), lp(900)) * np.exp(-t / 0.06)
    x = np.tanh(2.0 * (sub + 0.8 * boom / np.max(np.abs(boom))))
    return x * np.minimum(1, t / 0.001)


def riser(r, seconds: float) -> np.ndarray:
    """Noise through a rising bandpass plus a two-octave pitch sweep, loudness growing to the end."""
    t = t_axis(seconds)
    u = t / t[-1]
    centre = lambda f, tt: bp(400 * (9000 / 400) ** np.clip(tt / seconds, 0, 1), 1.6)(f)  # noqa: E731
    noise = tv_filter(r.standard_normal((2, len(t))), centre)
    noise /= np.max(np.abs(noise))
    tone = np.sin(2 * np.pi * np.cumsum(220 * 8 ** (u**1.5)) / SR)
    return (noise + 0.25 * np.stack([tone, tone])) * u**2.2


# ---- Pluck arpeggio: additive "harmonics", upper partials decay faster (bright tick -> soft tone)


def pluck(f: float, seconds: float = 0.34) -> np.ndarray:
    t = t_axis(seconds)
    ks = np.arange(1, int(12000 // f) + 1)
    x = sum(k**-0.9 * np.sin(2 * np.pi * k * f * t) * np.exp(-t * (6 + 4.5 * k)) for k in ks)
    return x * np.minimum(1, t / 0.001) * np.clip((seconds - t) / 0.02, 0, 1)


ARP_STEPS = [0, 1, 2, 1, 1, 2, 3, 2, 2, 3, 4, 3, 3, 4, 5, 4]  # rolling climb within a bar


def arp_notes(voicing: list[str], start: str) -> list[float]:
    """16 sixteenths climbing through chord tones from `start` upward."""
    classes = {midi(n) % 12 for n in voicing}
    ladder = [m for m in range(midi(start), 110) if m % 12 in classes]
    return [mhz(ladder[s]) for s in ARP_STEPS]


# ---- Voice: additive formant synthesis. The glottal source is a harmonic series with spectral
# tilt; each harmonic is weighted by the vocal-tract envelope (5 formant resonators) evaluated at
# that harmonic's instantaneous frequency, so vowel glides and pitch glides stay coherent.
# Soprano formant table (Hz, dB, bandwidth Hz), the classic Csound/Peterson values.

SOPRANO = {
    "a": [(800, 0, 80), (1150, -6, 90), (2900, -32, 120), (3900, -20, 130), (4950, -50, 140)],
    "e": [(350, 0, 60), (2000, -20, 100), (2800, -15, 120), (3600, -40, 150), (4950, -56, 200)],
    "i": [(270, 0, 60), (2140, -12, 90), (2950, -26, 100), (3900, -26, 120), (4950, -44, 120)],
    "o": [(450, 0, 70), (800, -11, 80), (2830, -22, 100), (3800, -22, 130), (4950, -50, 135)],
    "u": [(325, 0, 50), (700, -16, 60), (2700, -35, 170), (3800, -40, 180), (4950, -60, 200)],
}
CR = 1000  # control rate for pitch/formant trajectories


def unit_noise(r: np.random.Generator, n: int, cutoff: float) -> np.ndarray:
    """Slow random wobble: lowpassed noise scaled to unit standard deviation."""
    x = fft_filter(r.standard_normal(n), lp(cutoff))
    return x / np.std(x)


def trajectory(keys: list[tuple[float, np.ndarray]], seconds: float, glide: float) -> np.ndarray:
    """Hold each key value until `glide` before the next key, ramp, then smooth. Returns control
    samples at CR with the value arrays stacked on axis 0."""
    pts_t = [keys[0][0]]
    pts_v = [keys[0][1]]
    for (_, v0), (t1, v1) in zip(keys, keys[1:]):
        pts_t += [t1 - glide, t1]
        pts_v += [v0, v1]
    tc = np.arange(0, seconds, 1 / CR)
    vals = np.array(pts_v).reshape(len(pts_v), -1)
    ctrl = np.stack([np.interp(tc, pts_t, vals[:, j]) for j in range(vals.shape[1])])
    kernel = np.hanning(31)
    kernel /= kernel.sum()
    padded = np.pad(ctrl, ((0, 0), (15, 15)), mode="edge")
    return np.stack([np.convolve(row, kernel, mode="valid") for row in padded])


def to_audio(ctrl: np.ndarray, seconds: float) -> np.ndarray:
    tc = np.arange(ctrl.shape[-1]) / CR
    t = t_axis(seconds)
    return np.stack([np.interp(t, tc, row) for row in ctrl])


def tract(f: np.ndarray, fmt: np.ndarray) -> np.ndarray:
    """Vocal-tract gain at frequencies f given formants fmt (15, ...) = 5 x (freq, dB, bw)."""
    F, L, B = fmt[0::3], 10 ** (fmt[1::3] / 20), fmt[2::3]
    return np.sum(L * F * B / np.sqrt((F**2 - f**2) ** 2 + (f * B) ** 2), axis=0)


def voice(phrase: list[tuple[float, str, str]], seconds: float, seed: str, cents: float) -> np.ndarray:
    """phrase = [(time, note, vowel)]: sung vowel glides with scoop, vibrato, jitter and breath."""
    r = rng_for(seed)
    t = t_axis(seconds)
    pitch_keys = [(tk, np.array([np.log2(hz(n))])) for tk, n, _ in phrase]
    vowel_keys = [(tk, np.array(SOPRANO[v], float).ravel()) for tk, _, v in phrase]
    logf = to_audio(trajectory(pitch_keys, seconds, 0.07), seconds)[0]
    fmt_ctrl = trajectory(vowel_keys, seconds, 0.09)
    fmt = to_audio(fmt_ctrl, seconds)

    scoop = -0.05 * np.exp(-t / 0.05)  # start ~60 cents flat and slide up, like a singer does
    vib_depth = 0.026 * smoothstep((t - 0.16) / 0.3)  # ~30 cents, entering after the onset
    vib_rate = 5.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t + r.uniform(0, 6.3))
    vib = vib_depth * np.sin(2 * np.pi * np.cumsum(vib_rate) / SR)
    jitter = unit_noise(r, len(t), 12) * 0.004  # ~5 cents of slow pitch drift
    f0 = 2 ** (logf + scoop + vib + jitter + cents / 1200)
    phase = 2 * np.pi * np.cumsum(f0) / SR

    voiced = np.zeros(len(t))
    for k in range(1, int(15000 / f0.min()) + 2):
        fk = k * f0
        # Taper, not a hard cut: a harmonic toggling at 15 kHz under vibrato clicks.
        voiced += k**-1.1 * tract(fk, fmt) * np.clip((15000 - fk) / 3000, 0, 1) * np.sin(k * phase)
    shimmer = 1 + 0.04 * unit_noise(r, len(t), 30)  # ~4% amplitude wobble
    voiced *= shimmer

    frame_fmt = lambda tt: np.stack(  # noqa: E731
        [np.interp(tt[:, 0], np.arange(fmt_ctrl.shape[1]) / CR, row) for row in fmt_ctrl]
    )[:, :, None]
    air = lambda f, tt: tract(f, frame_fmt(tt)) * hp(1200)(f)  # noqa: E731
    breath = tv_filter(r.standard_normal(len(t)), air)
    breath /= np.max(np.abs(breath))
    voiced /= np.max(np.abs(voiced))

    onset = np.clip((t - 0.035) / 0.03, 0, 1)  # an aspirated "h" leads the voice by 35 ms
    breath_env = 0.45 * np.exp(-t / 0.05) + 0.08
    release = np.clip((seconds - t) / 0.18, 0, 1) ** 1.5
    return (voiced * onset + breath * breath_env) * release * np.minimum(1, t / 0.004)


VOCAL_CHOPS = [  # (start, phrase, seconds, gain, octave-down weight)
    (at(1), [(0.0, "B4", "o"), (0.38, "D5", "a")], 1.0, 0.5, 0.0),
    (at(3), [(0.0, "A4", "e"), (0.16, "A4", "i"), (0.42, "F#4", "o"), (0.8, "F#4", "u")], 1.05, 0.6, 0.0),
    (at(5), [(0.0, "D5", "o"), (0.22, "F#5", "a"), (0.62, "D5", "e"), (0.76, "D5", "i")], 1.0, 1.0, 0.15),
    (at(7), [(0.0, "F#5", "e"), (0.14, "F#5", "i"), (0.4, "D5", "o"), (0.8, "D5", "u")], 1.1, 0.75, 0.15),
]


def lower_octave(phrase):
    return [(tk, n[:-1] + str(int(n[-1]) - 1), v) for tk, n, v in phrase]


# ---- Effects


def ping_pong(x: np.ndarray, delay: float, feedback: float, taps: int = 10) -> np.ndarray:
    """Mono in, stereo out: echoes alternate L, R, L... each one darker and thinner than the last."""
    nfft = 1 << int(np.ceil(np.log2(N + taps * delay * SR + SR)))
    f = np.fft.rfftfreq(nfft, 1 / SR)
    X = np.fft.rfft(x, nfft)
    colour = lp(5000)(f) * hp(300)(f)
    echo = [feedback**n * colour**n * np.exp(-2j * np.pi * f * n * delay) for n in range(1, taps + 1)]
    left = sum(echo[0::2])
    right = sum(echo[1::2])
    return np.stack([np.fft.irfft(X * left, nfft)[:N], np.fft.irfft(X * right, nfft)[:N]])


def reverb(x: np.ndarray, rt60: float, seed: str, predelay: float = 0.02) -> np.ndarray:
    """Convolution with decorrelated stereo decaying noise; highs die ~2.5x faster than lows."""
    r = rng_for(seed)
    t = t_axis(rt60 * 1.2)
    noise = r.standard_normal((2, len(t)))
    low = fft_filter(noise, lp(2500))
    ir = low * 10 ** (-3 * t / rt60) + (noise - low) * 10 ** (-3 * t / (0.4 * rt60))
    ir *= np.minimum(1, t / 0.008)
    ir /= np.sqrt(np.sum(ir**2, axis=1, keepdims=True))
    ir = np.pad(ir, ((0, 0), (round(predelay * SR), 0)))
    nfft = 1 << int(np.ceil(np.log2(N + ir.shape[1])))
    mono = np.fft.rfft(x.sum(axis=0) / 2, nfft)
    return np.fft.irfft(mono[None, :] * np.fft.rfft(ir, nfft), nfft)[:, :N]


def soft_clip(x: np.ndarray, drive: float) -> np.ndarray:
    return np.tanh(drive * x) / drive


# ---- Arrangement

# Dry mask: everything dry stops at GAP (5 ms fade) and resumes on the drop; reverb/echo tails ring.
DRY = np.where(TIME < GAP, 1.0, 0.0) + np.where(TIME >= DROP, 1.0, 0.0)
DRY[(TIME >= GAP) & (TIME < GAP + 0.005)] = 1 - (TIME[(TIME >= GAP) & (TIME < GAP + 0.005)] - GAP) / 0.005

# Tails inside the gap decay over 80 ms: a 32nd-note roll's room at full size smears the silence.
IN_GAP = (TIME >= GAP) & (TIME < DROP)
TAIL = np.where(IN_GAP, np.exp(-(TIME - GAP) / 0.08), 1.0)

BUILD_KICKS = [at(1, 0), at(1, 2)] + [at(b, k) for b in (2, 3, 4) for k in range(4)]
# Build swell: the build rises from -10 dB to -3 dB at the gap, so the drop is the peak.
SWELL = 10 ** ((-10 + 7 * np.clip(TIME / GAP, 0, 1) ** 1.2) / 20)
DROP_KICKS = [at(b, k) for b in (5, 6, 7, 8) for k in range(4)]

# ---------------- DRUMS (+ FX) ----------------
r = rng_for("kick")
drums = track()
k_build = kick(r)
k_bar1 = fft_filter(k_build, lp(260, 0.9))  # bar 1: half-time and muffled, as if behind a wall
k_drop = kick(r, seconds=0.36, decay=0.15)  # shorter tail: the off-beat bass needs the room
k_first = kick(r, seconds=0.9, f_top=190, f_bottom=42, decay=0.38, click=0.5)
place(drums, panned(k_bar1, 0), at(1, 0), 0.5)
place(drums, panned(k_bar1, 0), at(1, 2), 0.5)
for tk in BUILD_KICKS[2:]:
    place(drums, panned(k_build, 0), tk, 0.55 + 0.15 * tk / GAP)
place(drums, panned(k_first, 0), DROP, 1.0)
for tk in DROP_KICKS[1:]:
    place(drums, panned(k_drop, 0), tk, 1.0)

# Snare roll: quarters (bar 1) -> 8ths -> 16ths -> 32nds (bar 4), rising in pitch, band and level.
r = rng_for("snare")
roll = track()
for bar, per_beat in ((1, 1), (2, 2), (3, 4), (4, 8)):
    for i in range(4 * per_beat):
        tk = at(bar, i / per_beat)
        u = tk / GAP
        hit = snare(r, tone=180 + 170 * u**1.5, band=1800 + 2800 * u, decay=0.09 - 0.05 * u)
        place(roll, panned(hit, 0.15 * (-1) ** i * u), tk, 0.18 + 0.55 * u**1.6)
roll = fft_filter(roll, lp(10000))  # bright but not fizzy
drums += roll * DRY

r = rng_for("hats")
open_hat, closed_hat = hat(r, 0.07), hat(r, 0.018)
for bar in range(1, 9):
    hat_level = 0.1 + 0.12 * (bar - 1) / 3 if bar <= 4 else 0.26
    for k in range(4):
        place(drums, panned(open_hat, 0.2), at(bar, k + 0.5), hat_level)
for bar in range(5, 9):
    for s in range(16):
        accent = 1.0 if s % 2 else 0.6
        place(drums, panned(closed_hat, -0.3), at(bar, s / 4), 0.09 * accent * (s % 4 != 2))

r = rng_for("clap")
the_clap = clap(r)
for bar in range(5, 9):
    for k in (1, 3):
        place(drums, the_clap, at(bar, k), 0.5)

r = rng_for("riser")
rise = riser(r, GAP - at(3))
place(drums, fft_filter(rise, lp(9000)), at(3), 0.3)

r = rng_for("crash")
place(drums, crash(r), DROP, 0.42)
place(drums, crash(r), at(7), 0.22)
place(drums, panned(impact(rng_for("impact")), 0), DROP, 0.85)

drums *= DRY
drums += reverb(roll * DRY, 1.4, "drum-room", 0.01) * 0.28 * TAIL
drums = soft_clip(drums, 1.3)

# ---------------- MUSIC: chords, arp, bass ----------------
r = rng_for("chords")
build_chords, drop_chords = track(), track()
for bar in range(1, 5):
    place(build_chords, chord_bar(harmony(bar)[0], r, 0.0), at(bar))
for bar in range(5, 9):
    place(drop_chords, chord_bar(harmony(bar)[0], r, 0.45), at(bar))

# Build filter: 24 dB/oct resonant lowpass opening from 400 Hz to 18 kHz across bars 1-4.
cutoff = lambda tt: 400 * (18000 / 400) ** (np.clip(tt / GAP, 0, 1) ** 1.4)  # noqa: E731
build_chords = tv_filter(build_chords, lambda f, tt: lp(cutoff(tt), 1.3)(f) ** 2)
drop_chords = fft_filter(drop_chords, lambda f: lp(11000)(f) * hp(170)(f))
build_chords = fft_filter(build_chords, hp(170))
level = 1 / np.sqrt(np.mean(drop_chords[:, round(DROP * SR) :] ** 2))
chords = (build_chords * pump(0.3, BUILD_KICKS) + drop_chords * pump(0.72, DROP_KICKS)) * level

arp = track()
starts = {1: "B3", 2: "D4", 3: "A4", 4: "E5", 5: "D5", 6: "D5", 7: "D5", 8: "D5"}
for bar in range(1, 9):
    for s, f in enumerate(arp_notes(harmony(bar)[0], starts[bar])):
        gain = 0.3 + 0.35 * (bar - 1) / 3 if bar <= 4 else 0.3
        place(arp, panned(pluck(f), 0.35 * (-1) ** s), at(bar, s / 4), gain)
arp *= DRY

bass = track()
for bar in range(5, 9):
    root = hz(harmony(bar)[1])
    for k in range(4):
        t = t_axis(BEAT / 2)
        body = np.sin(2 * np.pi * root * t) + 0.35 * fft_filter(saw(root * 2, len(t), 0.0), lp(900))
        note = np.tanh(1.6 * body) * gate(BEAT / 2, 0.004, 0.03)
        place(bass, panned(note, 0), at(bar, k + 0.5), 0.55)

music_dry = (chords * 0.16 + arp * 0.32) * SWELL * DRY + bass
music = music_dry + reverb(music_dry, 1.8, "music-hall") * 0.18 * TAIL
music += ping_pong(arp.sum(axis=0) / 2 * 0.32, 0.75 * BEAT, 0.35) * 0.35 * TAIL
music = soft_clip(music, 1.1)

# ---------------- VOX: formant chops, ping-pong dotted-1/8 delay, reverb ----------------
vox_dry = track()
for i, (start, phrase, seconds, gain, low) in enumerate(VOCAL_CHOPS):
    lead = voice(phrase, seconds, f"vox-{i}", 0.0)
    double = voice(phrase, seconds, f"vox-{i}-double", 9.0)
    octave = voice(lower_octave(phrase), seconds, f"vox-{i}-low", -4.0)
    stereo = panned(lead, 0) + 0.45 * panned(double, 0.35) + low * panned(octave, -0.25)
    place(vox_dry, stereo, start, gain)
vox_dry = fft_filter(vox_dry, lambda f: hp(220)(f) * lp(12000)(f))
vox = vox_dry * 0.68
vox += ping_pong(vox_dry.sum(axis=0) / 2, 0.75 * BEAT, 0.45) * 0.62
vox += reverb(vox_dry, 2.4, "vox-plate", 0.03) * 0.34

# ---------------- MASTER ----------------
stems = {"drums": drums, "music": music, "vox": vox}


def limiter_gain(mix: np.ndarray, drive: float, block: int = 32, release: float = 0.09) -> np.ndarray:
    """Look-ahead peak limiter as a gain envelope (instant attack one block early, smooth
    release). Returned as a gain curve so the same curve can be applied to every stem."""
    peak = np.abs(mix * drive).max(axis=0)
    nb = -(-N // block)
    blocks = np.pad(peak, (0, nb * block - N)).reshape(nb, block).max(axis=1)
    ahead = np.maximum.reduce([np.roll(blocks, -s) for s in (-1, 0, 1, 2)])
    target = np.minimum(1.0, 1.0 / ahead)
    a = np.exp(-block / (release * SR))
    g = np.empty(nb)
    acc = 1.0
    for i, v in enumerate(target):
        acc = min(v, v + a * (acc - v))
        g[i] = acc
    centres = (np.arange(nb) + 0.5) * block
    return drive * np.interp(np.arange(N), centres, g)


mix = sum(stems.values())
mix /= np.max(np.abs(mix))
gain = limiter_gain(mix, drive=10 ** (7 / 20)) / np.max(np.abs(sum(stems.values())))
tail = np.clip((LENGTH - TIME) / 0.015, 0, 1)
for name in stems:
    stems[name] = stems[name] * gain * tail
mix = sum(stems.values())
scale = PEAK / np.max(np.abs(mix))


def write(name: str, x: np.ndarray) -> None:
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.T.reshape(-1).tobytes())
    peak_db = 20 * np.log10(np.max(np.abs(x)))
    print(f"{name}.wav  {x.shape[1] / SR:.3f}s  peak {peak_db:+.2f} dBFS")


write("edm-build", mix * scale)
for name, x in stems.items():
    write(f"edm-stem-{name}", x * scale)
