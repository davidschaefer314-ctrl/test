// Entry: wires engine + voices + input + tuning together, runs the render
// loop, and drives the canvas visualizer.

import "./styles.css";
import { createEngine } from "./engine";
import { createVoicePool } from "./voices";
import { attachInput } from "./input";
import {
  STRINGS, NUM_STRINGS, PEDALS, HOMEROW_KEYS,
  barOffset, slantOffset,
} from "./tuning";
import { SCALES, snap } from "./quantize";

const pad = document.getElementById("pad") as HTMLDivElement;
const canvas = document.getElementById("viz") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;

const engine = createEngine();
const voices = createVoicePool(engine);

// Default scale = E major, a natural fit for E9 tuning.
let scaleIdx = 1;

// Compute the ringing pitch for a given string slot, given current input state.
function pitchFor(stringIdx: number, x: number, y: number, pedals: Set<number>): number {
  let midi = STRINGS[stringIdx].midi;

  // Bar position (Y) adds semitones.
  let bar = barOffset(y);
  if (input.quantize) bar = snap(SCALES[scaleIdx], bar, input.snapStrength);
  midi += bar;

  // Bar slant (X) adds per-string offset.
  midi += slantOffset(stringIdx, x);

  // Pedals / levers add per-string offsets.
  for (const pi of pedals) {
    const pedal = PEDALS[pi];
    if (pedal) midi += pedal.offsets[stringIdx];
  }
  return midi;
}

const input = attachInput(pad, {
  onStart: () => { engine.start(); hintEl.style.display = "none"; },
  onStringPluck: (stringIdx, velocity) => {
    const midi = pitchFor(stringIdx, input.x, input.y, input.heldPedals);
    voices.pluck(stringIdx, midi, velocity);
  },
  onStrum: (idxs, velocity) => {
    idxs.forEach((idx, k) => {
      const midi = pitchFor(idx, input.x, input.y, input.heldPedals);
      // Tiny stagger mimics a real strum across the strings.
      setTimeout(() => voices.pluck(idx, midi, velocity * (0.75 + 0.25 * Math.random())),
        k * 6);
    });
  },
  onStringMute: (stringIdx) => {
    // Home-row key-up DOES NOT damp — pedal-steel strings ring after plucking.
    // (Kept as a hook in case you want to add explicit palm-muting later.)
    void stringIdx;
  },
});

// Continuously re-tune every ringing voice based on bar/slant/pedals.
function renderAudio() {
  voices.retuneAll(
    (idx) => pitchFor(idx, input.x, input.y, input.heldPedals),
    0.04, // short portamento = snappy bar slides
  );
}

// ---- Visualizer ----------------------------------------------------------

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr; canvas.height = H * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0a0d18");
  g.addColorStop(1, "#050713");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Vertical string lanes. Each string is a column; string 10 on left.
  const padL = 24, padR = 24, padT = 18, padB = 18;
  const laneW = (W - padL - padR) / NUM_STRINGS;
  const active = voices.activeStrings();

  for (let i = 0; i < NUM_STRINGS; i++) {
    const cx = padL + laneW * (i + 0.5);
    const held = input.heldStrings.has(i);
    const ringing = active.has(i);
    const alpha = ringing ? 0.95 : held ? 0.55 : 0.18;

    // String line.
    ctx.strokeStyle = `rgba(180,220,255,${alpha})`;
    ctx.lineWidth = 1 + (ringing ? 1 : 0);
    ctx.beginPath();
    ctx.moveTo(cx, padT);
    ctx.lineTo(cx, H - padB);
    ctx.stroke();

    // Label.
    ctx.fillStyle = `rgba(180,220,255,${held || ringing ? 1 : 0.5})`;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(STRINGS[i].name, cx, padT - 4);
    ctx.fillStyle = `rgba(180,220,255,${held || ringing ? 0.7 : 0.3})`;
    ctx.fillText(HOMEROW_KEYS[i].toUpperCase(), cx, H - padB + 12);
  }

  // The "bar": horizontal line at Y, slanted by X.
  const barY = padT + (H - padT - padB) * input.y;
  const leftSlant = slantOffset(0, input.x);
  const rightSlant = slantOffset(NUM_STRINGS - 1, input.x);
  // Map slant semitones into visual pixels (gentle amplification).
  const pxPerSemi = 3;
  ctx.strokeStyle = "rgba(255,210,150,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, barY + leftSlant * pxPerSemi);
  ctx.lineTo(W - padR, barY + rightSlant * pxPerSemi);
  ctx.stroke();

  // Bar glow.
  const glow = ctx.createLinearGradient(0, barY - 14, 0, barY + 14);
  glow.addColorStop(0, "rgba(255,210,150,0)");
  glow.addColorStop(0.5, "rgba(255,210,150,0.18)");
  glow.addColorStop(1, "rgba(255,210,150,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(padL, barY - 14, W - padL - padR, 28);

  // Level meter.
  const level = engine.level();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(W - 110, 10, 96, 3);
  ctx.fillStyle = level > 0.95 ? "#ff7373" : "rgba(180,220,255,0.9)";
  ctx.fillRect(W - 110, 10, 96 * Math.min(1, level), 3);
}

function updateStatus() {
  const pedalNames = [...input.heldPedals].map((i) => PEDALS[i]?.id).filter(Boolean).join("+") || "–";
  statusEl.textContent =
    `scale: ${SCALES[scaleIdx].name}  ·  ` +
    `quantize: ${input.quantize ? "on" : "off"}  ·  ` +
    `snap: ${input.snapStrength.toFixed(1)}  ·  ` +
    `pedals: ${pedalNames}`;
}

function loop() {
  renderAudio();
  draw();
  updateStatus();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Scale switching with number-row? We already use 1..7 for pedals.
// Use Shift+1..5 for scale select.
window.addEventListener("keydown", (e) => {
  if (!e.shiftKey) return;
  const n = Number(e.key);
  if (Number.isFinite(n) && n >= 1 && n <= SCALES.length) {
    scaleIdx = n - 1;
  }
});
