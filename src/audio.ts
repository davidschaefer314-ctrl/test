import * as Tone from "tone";
import { midiToFreq } from "./scales";

// A single shared audio engine. One "lead" voice (continuous pitch /
// glissando), a polyphonic pluck for harmony pedals, and drone voices.
// Everything shares a master bus so voices blend rather than fight.

export type Engine = {
  started: boolean;
  start: () => Promise<void>;
  leadNoteOn: (midi: number) => void;
  leadNoteOff: () => void;
  setLeadPitch: (midi: number, glideSec: number) => void;
  setBrightness: (v: number) => void; // 0..1
  setVibrato: (v: number) => void; // 0..1
  pluck: (midi: number, velocity?: number) => void;
  droneOn: (id: string, midi: number) => void;
  droneOff: (id: string) => void;
  getLevel: () => number;
};

export function createEngine(): Engine {
  let started = false;

  // Master chain — kept minimally filtered so pitch stays legible.
  const master = new Tone.Gain(0.9);
  const limiter = new Tone.Limiter(-2);
  const meter = new Tone.Meter({ smoothing: 0.8 });
  const reverb = new Tone.Reverb({ decay: 2.6, wet: 0.18, preDelay: 0.02 });
  master.chain(reverb, limiter, meter, Tone.getDestination());

  // Lead voice: sawtooth through a resonant lowpass (singing, slide-guitar-ish).
  const leadVibrato = new Tone.Vibrato({ frequency: 5.5, depth: 0 });
  const leadFilter = new Tone.Filter({ frequency: 2200, type: "lowpass", Q: 2.2 });
  const leadAmp = new Tone.Gain(0);
  const lead = new Tone.Oscillator({ type: "sawtooth", frequency: 440 }).start();
  lead.chain(leadVibrato, leadFilter, leadAmp, master);

  // Harmony pluck synth (keys A/S/D). Short envelope, snaps + decays.
  const pluck = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.15, release: 1.4 },
    volume: -8,
  });
  const pluckFilter = new Tone.Filter({ frequency: 3000, type: "lowpass", Q: 0.7 });
  pluck.chain(pluckFilter, master);
  pluck.maxPolyphony = 8;

  // Drone voices (keys Z/X/C). Slow attack, soft, lowpassed.
  const drones: Record<string, { osc: Tone.Oscillator; amp: Tone.Gain }> = {};
  const droneBus = new Tone.Gain(0.45);
  const droneFilter = new Tone.Filter({ frequency: 900, type: "lowpass", Q: 0.3 });
  droneBus.chain(droneFilter, master);

  let leadActive = false;

  const engine: Engine = {
    get started() {
      return started;
    },
    start: async () => {
      if (started) return;
      await Tone.start();
      await reverb.generate();
      started = true;
    },
    leadNoteOn: (midi: number) => {
      const f = midiToFreq(midi);
      // Jump pitch immediately so the note starts on-pitch.
      lead.frequency.setValueAtTime(f, Tone.now());
      leadAmp.gain.cancelScheduledValues(Tone.now());
      leadAmp.gain.setValueAtTime(leadAmp.gain.value, Tone.now());
      leadAmp.gain.linearRampTo(0.55, 0.015);
      leadActive = true;
    },
    leadNoteOff: () => {
      leadAmp.gain.cancelScheduledValues(Tone.now());
      leadAmp.gain.setValueAtTime(leadAmp.gain.value, Tone.now());
      leadAmp.gain.linearRampTo(0, 0.18);
      leadActive = false;
    },
    setLeadPitch: (midi: number, glideSec: number) => {
      if (!leadActive) return;
      const f = midiToFreq(midi);
      lead.frequency.rampTo(f, Math.max(0.005, glideSec));
    },
    setBrightness: (v: number) => {
      // Y=top (v=1) → bright, Y=bottom (v=0) → warm.
      const f = 700 + Math.pow(v, 1.4) * 8000;
      leadFilter.frequency.rampTo(f, 0.05);
    },
    setVibrato: (v: number) => {
      // Vibrato only engages in the lower ~40% of the canvas so mid-Y is stable.
      const amount = Math.max(0, v - 0.6) / 0.4; // 0..1 over the bottom band
      leadVibrato.depth.rampTo(amount * 0.08, 0.1);
    },
    pluck: (midi: number, velocity = 0.7) => {
      pluck.triggerAttackRelease(midiToFreq(midi), "2n", undefined, velocity);
    },
    droneOn: (id: string, midi: number) => {
      if (drones[id]) return;
      const osc = new Tone.Oscillator({ type: "sawtooth", frequency: midiToFreq(midi) }).start();
      const amp = new Tone.Gain(0);
      osc.chain(amp, droneBus);
      amp.gain.rampTo(0.12, 0.9);
      drones[id] = { osc, amp };
    },
    droneOff: (id: string) => {
      const d = drones[id];
      if (!d) return;
      d.amp.gain.rampTo(0, 0.7);
      setTimeout(() => {
        d.osc.stop();
        d.osc.dispose();
        d.amp.dispose();
      }, 900);
      delete drones[id];
    },
    getLevel: () => {
      const v = meter.getValue();
      const db = typeof v === "number" ? v : v[0];
      return Math.max(0, Math.min(1, (db + 60) / 60));
    },
  };

  return engine;
}
