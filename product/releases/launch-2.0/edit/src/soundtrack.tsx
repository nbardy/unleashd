// Sound design as data: a composition lists Cues (when, which sample, how loud) and <Soundtrack>
// plays them. Samples are synthesized by ../../sound/synth.py, so we own every sound.
import type React from 'react';
import { Audio, Sequence } from 'remotion';
import gtrA3 from '../../sound/gtr-A3.wav';
import gtrA4 from '../../sound/gtr-A4.wav';
import gtrB3 from '../../sound/gtr-B3.wav';
import gtrD3 from '../../sound/gtr-D3.wav';
import gtrD4 from '../../sound/gtr-D4.wav';
import gtrE4 from '../../sound/gtr-E4.wav';
import gtrFs3 from '../../sound/gtr-Fs3.wav';
import gtrFs4 from '../../sound/gtr-Fs4.wav';
import gtrG2 from '../../sound/gtr-G2.wav';
import impact from '../../sound/impact.wav';
import key0 from '../../sound/key-0.wav';
import key1 from '../../sound/key-1.wav';
import key2 from '../../sound/key-2.wav';
import pad from '../../sound/pad.wav';
import pop0 from '../../sound/pop-0.wav';
import pop1 from '../../sound/pop-1.wav';
import pop2 from '../../sound/pop-2.wav';
import pop3 from '../../sound/pop-3.wav';
import pop4 from '../../sound/pop-4.wav';
import pop5 from '../../sound/pop-5.wav';
import pop6 from '../../sound/pop-6.wav';
import pop7 from '../../sound/pop-7.wav';
import riser from '../../sound/riser.wav';
import send from '../../sound/send.wav';
import sparkle from '../../sound/sparkle.wav';
import thud from '../../sound/thud.wav';
import whoosh from '../../sound/whoosh.wav';

export const KEYS = [key0, key1, key2];
export const POPS = [pop0, pop1, pop2, pop3, pop4, pop5, pop6, pop7]; // rising pitch
export const SFX = { impact, pad, riser, send, sparkle, thud, whoosh };
// Soft guitar, one plucked-string sample per note (Karplus-Strong in synth.py).
export const GUITAR = {
  G2: gtrG2, D3: gtrD3, Fs3: gtrFs3, A3: gtrA3, B3: gtrB3, D4: gtrD4, E4: gtrE4, Fs4: gtrFs4, A4: gtrA4,
};
export type GuitarNote = keyof typeof GUITAR;

export type Cue = { at: number; src: string; volume: number }; // at = output seconds

export const Soundtrack: React.FC<{ cues: Cue[]; fps: number }> = ({ cues, fps }) => (
  <>
    {cues.map((c, i) => (
      <Sequence key={i} from={Math.round(c.at * fps)} layout="none">
        <Audio src={c.src} volume={c.volume} />
      </Sequence>
    ))}
  </>
);
