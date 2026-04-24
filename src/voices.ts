// Polyphonic voice pool. Each voice is a plucked, decaying tone whose pitch
// can be re-targeted continuously (portamento). Voices are allocated per
// string slot so restriking a string steals its previous voice; a global
// capacity beyond NUM_STRINGS allows overlapping plucks with natural decay.

import { midiToFreq } from "./tuning";
import type { Engine } from "./engine";

const VOICE_LIMIT = 16;
const DEFAULT_PORTAMENTO = 0.08; // seconds
const RELEASE = 0.25;            // soft cutoff when stolen

type Voice = {
  id: number;
  stringIdx: number;     // which string slot this voice was born on
  osc: OscillatorNode;
  partial: OscillatorNode;
  filter: BiquadFilterNode;
  amp: GainNode;
  startedAt: number;
  active: boolean;       // still in its main sustain/decay phase
};

export type VoicePool = {
  pluck(stringIdx: number, midi: number, velocity?: number): void;
  // Retune a specific string slot's live voice (for slant / pedal changes).
  retune(stringIdx: number, midi: number, portamento?: number): void;
  // Retune ALL active voices at once (for bar position changes).
  retuneAll(pitchForString: (stringIdx: number) => number, portamento?: number): void;
  mute(stringIdx: number): void;          // palm-mute / damp a string
  activeStrings(): Set<number>;           // which string slots are currently ringing
};

export function createVoicePool(engine: Engine): VoicePool {
  const { ctx, out } = engine;
  const voices: Voice[] = [];
  let nextId = 1;

  // Most recent voice per string slot, for retuning.
  const slot: Map<number, Voice> = new Map();

  function spawn(stringIdx: number, midi: number, velocity: number): Voice {
    const t = ctx.currentTime;
    const freq = midiToFreq(midi);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    // A lightly detuned partial gives body + that slightly chorused pedal-steel shimmer.
    const partial = ctx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = freq * 2.005;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    // Brighter at higher velocity; also track pitch a bit.
    const cutoff = 800 + velocity * 3500 + freq * 1.5;
    filter.frequency.value = Math.min(12000, cutoff);
    filter.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    osc.connect(filter);
    partial.connect(filter);
    filter.connect(amp);
    amp.connect(out);

    // Pluck envelope: snappy attack, long exponential decay.
    const attackT = 0.004;
    const peak = 0.22 * velocity;
    const decayTime = 2.2 + velocity * 1.5;

    amp.gain.cancelScheduledValues(t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + attackT);
    amp.gain.exponentialRampToValueAtTime(0.0005, t + attackT + decayTime);

    // Filter sweep darkens as the note decays (realistic pluck character).
    filter.frequency.setValueAtTime(filter.frequency.value, t);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(300, filter.frequency.value * 0.35),
      t + decayTime,
    );

    osc.start(t);
    partial.start(t);
    osc.stop(t + attackT + decayTime + 0.1);
    partial.stop(t + attackT + decayTime + 0.1);

    const voice: Voice = {
      id: nextId++,
      stringIdx,
      osc,
      partial,
      filter,
      amp,
      startedAt: t,
      active: true,
    };
    voices.push(voice);
    slot.set(stringIdx, voice);

    // Auto-cleanup when done.
    osc.onended = () => {
      voice.active = false;
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      if (slot.get(stringIdx) === voice) slot.delete(stringIdx);
      try { amp.disconnect(); partial.disconnect(); filter.disconnect(); } catch {}
    };
    return voice;
  }

  function steal(): void {
    // Prefer the oldest voice that's not the most recent on any slot.
    let victim: Voice | null = null;
    let oldest = Infinity;
    for (const v of voices) {
      if (v.startedAt < oldest) { oldest = v.startedAt; victim = v; }
    }
    if (victim) releaseNow(victim);
  }

  function releaseNow(v: Voice) {
    const t = ctx.currentTime;
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setValueAtTime(v.amp.gain.value, t);
    v.amp.gain.linearRampToValueAtTime(0, t + RELEASE);
    try {
      v.osc.stop(t + RELEASE + 0.02);
      v.partial.stop(t + RELEASE + 0.02);
    } catch {}
  }

  return {
    pluck(stringIdx, midi, velocity = 0.8) {
      // Re-strike: gently release any previous voice on this slot, then spawn.
      const prev = slot.get(stringIdx);
      if (prev) releaseNow(prev);
      if (voices.length >= VOICE_LIMIT) steal();
      spawn(stringIdx, Math.max(0, Math.min(127, midi)), velocity);
    },
    retune(stringIdx, midi, portamento = DEFAULT_PORTAMENTO) {
      const v = slot.get(stringIdx);
      if (!v) return;
      const t = ctx.currentTime;
      const f = midiToFreq(midi);
      v.osc.frequency.cancelScheduledValues(t);
      v.partial.frequency.cancelScheduledValues(t);
      v.osc.frequency.linearRampToValueAtTime(f, t + portamento);
      v.partial.frequency.linearRampToValueAtTime(f * 2.005, t + portamento);
    },
    retuneAll(pitchForString, portamento = DEFAULT_PORTAMENTO) {
      const t = ctx.currentTime;
      for (const [idx, v] of slot) {
        const f = midiToFreq(pitchForString(idx));
        v.osc.frequency.cancelScheduledValues(t);
        v.partial.frequency.cancelScheduledValues(t);
        v.osc.frequency.linearRampToValueAtTime(f, t + portamento);
        v.partial.frequency.linearRampToValueAtTime(f * 2.005, t + portamento);
      }
    },
    mute(stringIdx) {
      const v = slot.get(stringIdx);
      if (v) releaseNow(v);
    },
    activeStrings() {
      return new Set(slot.keys());
    },
  };
}
