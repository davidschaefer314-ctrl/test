// Input layer: turns raw DOM events into semantic instrument events.
// Keeps all state in a single `InputState` object so main.ts can read it
// from its render/audio loop without attaching listeners everywhere.

import { HOMEROW_KEYS, PEDAL_KEYS, NUM_STRINGS } from "./tuning";

export type InputState = {
  // Normalized pad coordinates (0..1). y=0 top, x=0 left.
  x: number;
  y: number;
  padActive: boolean;   // pointer currently over the pad
  heldStrings: Set<number>;  // string indices currently held on home row
  heldPedals: Set<number>;   // pedal indices currently held on number row
  quantize: boolean;
  snapStrength: number; // 0..1
};

export type InputCallbacks = {
  // Called once on the first user gesture so audio can be unlocked.
  onStart: () => void;
  // Pluck one string at the current bar position.
  onStringPluck: (stringIdx: number, velocity: number) => void;
  // Strum: pluck all held strings (or all 10 if none held).
  onStrum: (stringIdxs: number[], velocity: number) => void;
  // Damp a string (key-up).
  onStringMute: (stringIdx: number) => void;
};

export function attachInput(
  pad: HTMLElement,
  cb: InputCallbacks,
): InputState {
  const state: InputState = {
    x: 0.5,
    y: 0.0,
    padActive: false,
    heldStrings: new Set(),
    heldPedals: new Set(),
    quantize: false,
    snapStrength: 0.7,
  };

  let started = false;
  const ensureStarted = () => {
    if (!started) { started = true; cb.onStart(); }
  };

  // ---- Trackpad / pointer --------------------------------------------------

  function updateFromPointer(e: PointerEvent) {
    const r = pad.getBoundingClientRect();
    state.x = clamp01((e.clientX - r.left) / r.width);
    state.y = clamp01((e.clientY - r.top) / r.height);
  }

  pad.addEventListener("pointermove", (e) => {
    state.padActive = true;
    updateFromPointer(e);
  });

  pad.addEventListener("pointerenter", () => { state.padActive = true; });
  pad.addEventListener("pointerleave", () => { state.padActive = false; });

  pad.addEventListener("pointerdown", (e) => {
    ensureStarted();
    updateFromPointer(e);
    pad.setPointerCapture(e.pointerId);
    // Pluck all held strings; if none held, strum the whole instrument.
    const idxs = state.heldStrings.size
      ? [...state.heldStrings]
      : Array.from({ length: NUM_STRINGS }, (_, i) => i);
    cb.onStrum(idxs, 0.85);
  });

  pad.addEventListener("pointerup", (e) => {
    try { pad.releasePointerCapture(e.pointerId); } catch {}
  });

  // ---- Keyboard ------------------------------------------------------------

  function stringIdxFromKey(k: string): number {
    return HOMEROW_KEYS.indexOf(k);
  }
  function pedalIdxFromKey(k: string): number {
    return PEDAL_KEYS.indexOf(k);
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    ensureStarted();

    const si = stringIdxFromKey(k);
    if (si >= 0) {
      state.heldStrings.add(si);
      cb.onStringPluck(si, 0.8);
      return;
    }
    const pi = pedalIdxFromKey(k);
    if (pi >= 0) {
      state.heldPedals.add(pi);
      return;
    }
    if (k === "q") { state.quantize = !state.quantize; return; }
    if (k === "[") { state.snapStrength = clamp01(state.snapStrength - 0.1); return; }
    if (k === "]") { state.snapStrength = clamp01(state.snapStrength + 0.1); return; }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    const si = stringIdxFromKey(k);
    if (si >= 0) {
      state.heldStrings.delete(si);
      cb.onStringMute(si);
      return;
    }
    const pi = pedalIdxFromKey(k);
    if (pi >= 0) {
      state.heldPedals.delete(pi);
      return;
    }
  });

  return state;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
