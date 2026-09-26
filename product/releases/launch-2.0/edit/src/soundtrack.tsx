// Sound design as data: a composition lists Cues (when, which sample, how loud) and <Soundtrack>
// plays them. Samples are synthesized by ../../sound/synth.py, so we own every sound.
import type React from 'react';
import { Audio, Sequence } from 'remotion';
import impact from '../../sound/impact.wav';
import epG2 from '../../sound/ep-G2.wav';
import epD3 from '../../sound/ep-D3.wav';
import epFs3 from '../../sound/ep-Fs3.wav';
import epA3 from '../../sound/ep-A3.wav';
import epB3 from '../../sound/ep-B3.wav';
import epCs4 from '../../sound/ep-Cs4.wav';
import epD4 from '../../sound/ep-D4.wav';
import epE4 from '../../sound/ep-E4.wav';
import epFs4 from '../../sound/ep-Fs4.wav';
import epA4 from '../../sound/ep-A4.wav';
import marG3 from '../../sound/mar-G3.wav';
import marD4 from '../../sound/mar-D4.wav';
import marFs4 from '../../sound/mar-Fs4.wav';
import marA4 from '../../sound/mar-A4.wav';
import marB4 from '../../sound/mar-B4.wav';
import marD5 from '../../sound/mar-D5.wav';
import marFs5 from '../../sound/mar-Fs5.wav';
import strDmaj9 from '../../sound/str-Dmaj9.wav';
import strGmaj7 from '../../sound/str-Gmaj7.wav';
import strD69 from '../../sound/str-D69.wav';
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
// The calm after the boom, three candidate instruments (synth.py): per-note electric piano and
// marimba, per-chord strings.
export const EPIANO = { G2: epG2, D3: epD3, Fs3: epFs3, A3: epA3, B3: epB3, Cs4: epCs4, D4: epD4, E4: epE4, Fs4: epFs4, A4: epA4 };
export const MARIMBA = { G3: marG3, D4: marD4, Fs4: marFs4, A4: marA4, B4: marB4, D5: marD5, Fs5: marFs5 };
export const STRINGS = { Dmaj9: strDmaj9, Gmaj7: strGmaj7, D69: strD69 };

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
