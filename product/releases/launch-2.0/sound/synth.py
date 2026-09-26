"""Synthesize the launch video's sound-design samples. Everything is generated here, so we own it.

Run:  uv run --with numpy python product/releases/launch-2.0/sound/synth.py
Writes 16-bit mono 48 kHz WAVs next to this file. Deterministic (fixed seeds): re-running
reproduces the same bytes. Where each sample plays is decided by the Remotion timeline
(edit/src/Overload.tsx, OVERLOAD_CUES), not here. Only the riser's length is tied to the
picture: it must span the pile-up, from T.rampStart to T.cut.
"""

from pathlib import Path
import wave

import numpy as np

SR = 48_000
OUT = Path(__file__).parent
RISER_SECONDS = 11.7 - 6.2  # T.cut - T.rampStart in Overload.tsx


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def sweep(f0: np.ndarray | float, f1: float, t: np.ndarray, exponential: bool = True) -> np.ndarray:
    """Phase of a tone gliding from f0 to f1 over t."""
    u = t / t[-1]
    freq = f0 * (f1 / f0) ** u if exponential else f0 + (f1 - f0) * u
    return 2 * np.pi * np.cumsum(freq) / SR


def lowpass(x: np.ndarray, cutoff: np.ndarray | float) -> np.ndarray:
    """One-pole lowpass; cutoff may vary per sample."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, (xi, ai) in enumerate(zip(x, a)):
        acc += ai * (xi - acc)
        y[i] = acc
    return y


def fade_edges(x: np.ndarray, ms: float = 2.0) -> np.ndarray:
    n = int(SR * ms / 1000)
    ramp = np.linspace(0, 1, n)
    x = x.copy()
    x[:n] *= ramp
    x[-n:] *= ramp[::-1]
    return x


def write(name: str, x: np.ndarray, peak: float = 0.9) -> None:
    x = fade_edges(x)
    x = x / np.max(np.abs(x)) * peak
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print(f"{name}.wav  {len(x) / SR:.2f}s")


rng = np.random.default_rng(2026_09_26)

# Keyboard tick: a short bright noise click. Three variants so typing doesn't machine-gun.
for k in range(3):
    t = t_axis(0.03)
    noise = np.diff(rng.standard_normal(len(t) + 1))  # differencing = crude highpass
    click = np.sin(2 * np.pi * (1800 + 400 * k) * t)
    write(f"key-{k}", (noise * 0.6 + click * 0.4) * np.exp(-t / 0.004))

# Send: a quick upward blip.
t = t_axis(0.09)
write("send", np.sin(sweep(520.0, 1150.0, t)) * np.exp(-t / 0.03) * np.minimum(1, t / 0.003))

# Window pop: a bubble "bloop" whose pitch rises through the pile-up (variant k = 3 semitones up).
for k in range(8):
    t = t_axis(0.14)
    f0 = 330 * 2 ** (3 * k / 12)
    body = np.sin(sweep(f0, f0 * 2.2, t)) * np.exp(-t / 0.035)
    write(f"pop-{k}", body * np.minimum(1, t / 0.002))

# Minimize: band-limited noise that swells and sweeps up then down.
t = t_axis(0.5)
u = t / t[-1]
cut = 400 + 3200 * np.sin(np.pi * u) ** 2
write("whoosh", lowpass(rng.standard_normal(len(t)), cut) * np.sin(np.pi * u) ** 2)

# Riser: saw + noise climbing three octaves, a tremolo that speeds up, loudness growing to the
# end. It stops dead on the last sample: the hard cut to black is the drop.
t = t_axis(RISER_SECONDS)
u = t / t[-1]
phase = sweep(70.0, 560.0, t)
saw = sum(np.sin(n * phase) / n for n in range(1, 12))
noise = lowpass(rng.standard_normal(len(t)), 200 + 7800 * u**2)
trem = 0.65 + 0.35 * np.sin(2 * np.pi * np.cumsum(3 + 21 * u**2) / SR)
write("riser", (0.55 * lowpass(saw, 600 + 5000 * u**2) + 0.45 * noise) * trem * u**2.2, peak=0.95)

# Impact for "AI Overload!": pitch-dropping sub, a noise transient, soft saturation.
t = t_axis(2.6)
sub = np.sin(sweep(62.0, 32.0, t)) * np.exp(-t / 0.7)
hit = lowpass(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.05)
write("impact", np.tanh(2.2 * (sub + 0.5 * hit)))

# Thud for "We're all feeling it.": a smaller, rounder low hit.
t = t_axis(0.7)
write("thud", np.sin(sweep(110.0, 70.0, t)) * np.exp(-t / 0.18))

# Title pad: D major add9 on detuned saws, low-passed, slow swell. Warm after the chaos.
t = t_axis(3.0)
notes = [146.83, 220.0, 293.66, 369.99, 440.0, 659.26]  # D3 A3 D4 F#4 A4 E5
pad = np.zeros_like(t)
for f in notes:
    for cents in (-7, 0, 7):
        ph = 2 * np.pi * f * 2 ** (cents / 1200) * t + rng.uniform(0, 2 * np.pi)
        pad += sum(np.sin(n * ph) / n for n in range(1, 8))
env = np.minimum(1, t / 0.9) * np.minimum(1, (t[-1] - t) / 0.8)
write("pad", lowpass(pad, 1600) * env, peak=0.8)

# Sparkle for the "2.0" sticker: a scatter of short high bells.
t = t_axis(0.8)
sparkle = np.zeros_like(t)
for _ in range(9):
    start = rng.uniform(0, 0.25)
    f = rng.uniform(2200, 5200)
    tt = np.clip(t - start, 0, None)
    sparkle += np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.12) * (t >= start)
write("sparkle", sparkle, peak=0.7)

# ---- The calm after the boom: three instruments to choose from (owner, 2026-09-26: the guitar
# was "trash", try others). Per-note samples so the timeline (CALM in Overload.tsx) places every
# note; the strings are per-chord because a pad has no attacks to place.

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def hz(note: str) -> float:
    """'F#4' -> 369.99 (A4 = 440)."""
    midi = NAMES.index(note[:-1]) + 12 * (int(note[-1]) + 1)
    return 440.0 * 2 ** ((midi - 69) / 12)


def file_name(prefix: str, note: str) -> str:
    return f"{prefix}-{note.replace('#', 's')}"


# A: electric piano, DX-style FM. A 1:1 modulator whose index falls away gives the warm bark;
# a quiet 14:1 modulator with a very fast decay gives the tine "ding" at the attack.
def epiano(f: float, seconds: float = 4.0) -> np.ndarray:
    t = t_axis(seconds)
    decay = 1.6 * (220 / f) ** 0.3  # low notes ring longer
    body_index = 0.3 + 1.6 * np.exp(-t / 0.4)
    tine_index = 1.2 * np.exp(-t / 0.02)
    body = np.sin(2 * np.pi * f * t + body_index * np.sin(2 * np.pi * f * t))
    tine = np.sin(2 * np.pi * f * t + tine_index * np.sin(2 * np.pi * 14 * f * t))
    env = np.minimum(1, t / 0.004) * np.exp(-t / decay)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return (0.8 * body + 0.35 * tine) * env * trem


for note in ["G2", "D3", "F#3", "A3", "B3", "C#4", "D4", "E4", "F#4", "A4"]:
    write(file_name("ep", note), epiano(hz(note)), peak=0.8)


# C: marimba, modal synthesis. A tuned bar rings at about 1x, 4x and 10x its fundamental; the
# upper modes die fast, which is the wooden "tock" turning into a soft tone. Plus a felt click.
def marimba(f: float, seconds: float = 2.5) -> np.ndarray:
    t = t_axis(seconds)
    scale = (262 / f) ** 0.5
    modes = [(1.0, 1.0, 0.9), (3.93, 0.3, 0.22), (9.8, 0.08, 0.06)]
    tone = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d * scale)) for r, a, d in modes)
    felt = lowpass(rng.standard_normal(len(t)), 1200.0) * np.exp(-t / 0.004) * 0.6
    return (tone + felt) * np.minimum(1, t / 0.002)


for note in ["G3", "D4", "F#4", "A4", "B4", "D5", "F#5"]:
    write(file_name("mar", note), marimba(hz(note)), peak=0.8)


# B: strings pad. Each note is five detuned saw voices built additively with a soft spectral
# tilt (no buzz), a vibrato that fades in, a slow swell and a release tail. Chord lengths are
# tied to the picture like the riser: D until the title (4 eighths = 1.75 s), G until "2.0"
# (1.3 s), then the last D rings on into beat 6. The release tails overlap into a crossfade.
def strings(notes: list[str], hold: float, attack: float, release: float) -> np.ndarray:
    t = t_axis(hold + release)
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 1.2)
    out = np.zeros_like(t)
    for note in notes:
        f = hz(note)
        for cents in (-14, -6, 0, 6, 14):
            fv = f * 2 ** (cents / 1200)
            phase = 2 * np.pi * np.cumsum(fv * vib) / SR + rng.uniform(0, 2 * np.pi)
            n_max = int(4000 / f)
            out += sum(np.sin(n * phase) / n * np.exp(-n * f / 1400) for n in range(1, n_max + 1))
    swell = np.minimum(1, t / attack) ** 2
    tail = np.clip((hold + release - t) / release, 0, 1)
    return out * swell * tail


write("str-Dmaj9", strings(["D3", "A3", "C#4", "E4", "F#4"], hold=1.75, attack=1.2, release=0.9), peak=0.8)
write("str-Gmaj7", strings(["G2", "D3", "F#3", "B3", "D4"], hold=1.3, attack=0.5, release=0.9), peak=0.8)
write("str-D69", strings(["D3", "A3", "B3", "E4", "F#4"], hold=3.0, attack=0.5, release=1.5), peak=0.8)
