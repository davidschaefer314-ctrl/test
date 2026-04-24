// Raw Web Audio engine. Owns the AudioContext and the shared master bus.
// Voice creation lives in voices.ts but uses nodes produced here.

export type Engine = {
  ctx: AudioContext;
  out: GainNode;       // pre-destination bus (plug voices into this)
  master: GainNode;    // final gain
  start(): Promise<void>;
  now(): number;
  level(): number;     // 0..1 from analyser (for the visualizer)
};

export function createEngine(): Engine {
  const ctx = new AudioContext({ latencyHint: "interactive" });

  // voice bus → tone filter → soft-clip-ish waveshaper → master → destination
  const out = ctx.createGain();
  out.gain.value = 0.9;

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 6000;
  tone.Q.value = 0.3;

  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve(1.4, 1024) as Float32Array<ArrayBuffer>;
  shaper.oversample = "2x";

  const master = ctx.createGain();
  master.gain.value = 0.8;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const buf = new Uint8Array(analyser.fftSize);

  out.connect(tone).connect(shaper).connect(master).connect(analyser);
  analyser.connect(ctx.destination);

  let started = false;
  return {
    ctx,
    out,
    master,
    async start() {
      if (started) return;
      await ctx.resume();
      started = true;
    },
    now: () => ctx.currentTime,
    level() {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      return peak;
    },
  };
}

function softClipCurve(amount: number, n: number): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount);
  }
  return curve;
}
