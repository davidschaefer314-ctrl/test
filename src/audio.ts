import * as Tone from "tone";
import { midiToFreq } from "./scales";

// A single shared audio engine. Kept deliberately small: one "lead" voice
// (continuous pitch / glissando) plus a short polyphonic synth for harmony
// pedals and drones. Everything flows through a shared filter + reverb so
// voices blend rather than fight each other.

export type Engine = {
  started: boolean;
  start: () => Promise<void>;
  // Lead voice (mouse).
  leadNoteOn: (midi: number) => void;
  leadNoteOff: () => void;
  setLeadPitch: (midi: number, glideSec: number) => void;
  setBrightness: (v: number) => void; // 0..1
  setVibrato: (v: number) => void; // 0..1
  // Harmony pedals (transient, plucky).
  pluck: (midi: number, velocity?: number) => void;
  // Drones (sustained, latched).
  droneOn: (id: string, midi: number) => void;
  droneOff: (id: string) => void;
  // Master level meter (0..1) for the visualizer.
  getLevel: () => number;
};

export function createEngine(): Engine {
  let started = false;

  // Master chain
  const master = new Tone.Gain(0.8);
  const limiter = new Tone.Limiter(-3);
  const meter = new Tone.Meter({ smoothing: 0.8 });
  const reverb = new Tone.Reverb({ decay: 3.5, wet: 0.35, preDelay: 0.02 });
  const masterFilter = new Tone.Filter({ frequency: 4000, type: "lowpass", Q: 0.4 });
  master.chain(masterFilter, reverb, limiter, meter, Tone.getDestination());

  // Lead voice: a smooth triangle oscillator with vibrato and its own filter.
  const leadVibrato = new Tone.Vibrato({ frequency: 5.5, depth: 0 });
  const leadFilter = new Tone.Filter({ frequency: 2000, type: "lowpass", Q: 1.2 });
  const leadAmp = new Tone.Gain(0);
  const lead = new Tone.Oscillator({ type: "triangle", frequency: 220 }).start();
  // Subtle detuned partial for warmth
  const leadSub = new Tone.Oscillator({ type: "sine", frequency: 110, volume: -10 }).start();
  const leadMix = new Tone.Gain(0.9);
  lead.connect(leadMix);
  leadSub.connect(leadMix);
  leadMix.chain(leadVibrato, leadFilter, leadAmp, master);

  // Harmony pluck synth (keys A/S/D). Short envelope, snaps + decays.
  const pluck = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 1.4 },
    volume: -10,
  });
  const pluckFilter = new Tone.Filter({ frequency: 2500, type: "lowpass", Q: 0.7 });
  pluck.chain(pluckFilter, master);
  pluck.maxPolyphony = 8;

  // Drone voices (keys Z/X/C). Slow attack, soft.
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
      lead.frequency.rampTo(f, 0.001);
      leadSub.frequency.rampTo(f / 2, 0.001);
      // Quick but soft attack.
      leadAmp.gain.cancelScheduledValues(Tone.now());
      leadAmp.gain.rampTo(0.35, 0.04);
      leadActive = true;
    },
    leadNoteOff: () => {
      leadAmp.gain.cancelScheduledValues(Tone.now());
      leadAmp.gain.rampTo(0.0, 0.25);
      leadActive = false;
    },
    setLeadPitch: (midi: number, glideSec: number) => {
      if (!leadActive) return;
      const f = midiToFreq(midi);
      lead.frequency.rampTo(f, Math.max(0.005, glideSec));
      leadSub.frequency.rampTo(f / 2, Math.max(0.005, glideSec));
    },
    setBrightness: (v: number) => {
      const f = 400 + Math.pow(v, 1.6) * 6000;
      leadFilter.frequency.rampTo(f, 0.05);
    },
    setVibrato: (v: number) => {
      leadVibrato.depth.rampTo(Math.min(0.12, v * 0.12), 0.1);
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
      // Convert dB (~-60..0) to 0..1
      return Math.max(0, Math.min(1, (db + 60) / 60));
    },
  };

  return engine;
}
