import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, type Engine } from "./audio";
import {
  SCALES,
  nearestScaleMidi,
  scaleMidiNotes,
  stepScaleDegrees,
  type Scale,
} from "./scales";

// Playable pitch range (midi).
const LO = 55; // G3
const HI = 84; // C6

// Harmonizer pedals add N scale degrees above the lead (keys A/S/D).
const PEDALS: { key: string; steps: number; label: string }[] = [
  { key: "a", steps: 2, label: "3rd" },
  { key: "s", steps: 4, label: "5th" },
  { key: "d", steps: 7, label: "oct" },
];

// Drone roots as scale degrees from the tonic (I, IV, V) (keys Z/X/C).
const DRONES: { key: string; degree: number; label: string }[] = [
  { key: "z", degree: 0, label: "I" },
  { key: "x", degree: 3, label: "IV" },
  { key: "c", degree: 4, label: "V" },
];

// Map mouse x-ratio (0..1) to a continuous midi pitch in [LO, HI].
function xToMidi(x: number): number {
  return LO + (HI - LO) * Math.max(0, Math.min(1, x));
}
function midiToX(midi: number): number {
  return (midi - LO) / (HI - LO);
}

export default function Instrument() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const [scaleIdx, setScaleIdx] = useState(0);
  const [started, setStarted] = useState(false);

  // Live mouse state (refs so we don't re-render on every move).
  const mouse = useRef({ x: 0.5, y: 0.5, down: false, inside: false });
  const pressedKeys = useRef<Set<string>>(new Set());
  const droneStateRef = useRef<Map<string, number>>(new Map()); // keyId -> midi
  const scaleRef = useRef<Scale>(SCALES[0]);
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);

  // Keep refs in sync.
  useEffect(() => {
    scaleRef.current = SCALES[scaleIdx];
  }, [scaleIdx]);

  // Engine lazy-init on first interaction (required by browsers).
  async function ensureStarted() {
    if (!engineRef.current) engineRef.current = createEngine();
    if (!started) {
      await engineRef.current.start();
      setStarted(true);
    }
  }

  // ---- Main audio/render loop -------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastFrame = performance.now();
    let lastMidi = xToMidi(mouse.current.x);

    const loop = () => {
      const now = performance.now();
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;

      const engine = engineRef.current;
      const scale = scaleRef.current;

      if (engine) {
        // Base pitch from mouse X.
        let targetMidi = xToMidi(mouse.current.x);

        // Quantize if space is held (strong pull toward nearest scale note).
        if (pressedKeys.current.has(" ")) {
          const snap = nearestScaleMidi(scale, targetMidi, LO, HI);
          // Magnetic pull: 85% toward nearest scale note.
          targetMidi = targetMidi * 0.15 + snap * 0.85;
        }

        // Glide faster when shift held.
        const glide = pressedKeys.current.has("shift") ? 0.005 : 0.06;
        engine.setLeadPitch(targetMidi, glide);

        // Brightness: inverted Y (top = bright).
        engine.setBrightness(1 - mouse.current.y);
        // Vibrato: more vibrato toward bottom of frame.
        engine.setVibrato(mouse.current.y);

        lastMidi = targetMidi;
      }

      // Trail: record recent playhead positions.
      if (mouse.current.down && mouse.current.inside) {
        trailRef.current.push({ x: mouse.current.x, y: mouse.current.y, t: now });
      }
      // Prune old trail points.
      const cutoff = now - 700;
      while (trailRef.current.length && trailRef.current[0].t < cutoff) trailRef.current.shift();

      draw(dt, lastMidi);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Drawing -----------------------------------------------------------
  function draw(_dt: number, leadMidi: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background gradient.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0b0f1d");
    grad.addColorStop(1, "#050814");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const scale = scaleRef.current;
    const notes = scaleMidiNotes(scale, LO, HI);

    // Scale degree ticks.
    for (const n of notes) {
      const x = midiToX(n) * W;
      const isTonic = (n - scale.tonic) % 12 === 0;
      ctx.strokeStyle = isTonic ? "rgba(130,200,255,0.55)" : "rgba(130,200,255,0.14)";
      ctx.lineWidth = isTonic ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.15);
      ctx.lineTo(x, H * 0.85);
      ctx.stroke();
      if (isTonic) {
        ctx.fillStyle = "rgba(130,200,255,0.7)";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        const octave = Math.floor(n / 12) - 1;
        ctx.fillText(`C${octave}`, x, H * 0.9);
      }
    }

    // Drone ribbons along the bottom.
    let i = 0;
    for (const [id, midi] of droneStateRef.current.entries()) {
      const x = midiToX(midi) * W;
      ctx.fillStyle = `rgba(255,180,120,${0.25 + 0.15 * Math.sin(performance.now() / 600 + i)})`;
      ctx.fillRect(x - 18, H - 26 - i * 6, 36, 4);
      ctx.fillStyle = "rgba(255,200,150,0.9)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(id.toUpperCase(), x, H - 30 - i * 6);
      i++;
    }

    // Trail.
    const now = performance.now();
    if (trailRef.current.length > 1) {
      for (let k = 1; k < trailRef.current.length; k++) {
        const a = trailRef.current[k - 1];
        const b = trailRef.current[k];
        const age = (now - b.t) / 700; // 0..1
        ctx.strokeStyle = `rgba(180,220,255,${(1 - age) * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
    }

    // Playhead.
    const leadX = midiToX(leadMidi) * W;
    const leadY = mouse.current.y * H;
    const active = mouse.current.down;
    const wobble = active
      ? Math.sin(performance.now() / (80 + (1 - mouse.current.y) * 120)) * mouse.current.y * 4
      : 0;

    // Glow halo.
    const haloR = active ? 28 : 14;
    const halo = ctx.createRadialGradient(leadX, leadY + wobble, 0, leadX, leadY + wobble, haloR);
    halo.addColorStop(0, active ? "rgba(180,220,255,0.9)" : "rgba(180,220,255,0.4)");
    halo.addColorStop(1, "rgba(180,220,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(leadX, leadY + wobble, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Orb.
    ctx.fillStyle = active ? "#eaf3ff" : "rgba(234,243,255,0.5)";
    ctx.beginPath();
    ctx.arc(leadX, leadY + wobble, active ? 7 : 4, 0, Math.PI * 2);
    ctx.fill();

    // Harmony orbs for held pedals.
    if (active) {
      for (const p of PEDALS) {
        if (!pressedKeys.current.has(p.key)) continue;
        const harmMidi = stepScaleDegrees(scale, leadMidi, p.steps, LO, HI);
        const hx = midiToX(harmMidi) * W;
        ctx.fillStyle = "rgba(255,210,150,0.85)";
        ctx.beginPath();
        ctx.arc(hx, leadY - 22 + wobble * 0.5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,210,150,0.3)";
        ctx.beginPath();
        ctx.moveTo(leadX, leadY + wobble);
        ctx.lineTo(hx, leadY - 22 + wobble * 0.5);
        ctx.stroke();
      }
    }

    // Quantize indicator when space is held.
    if (pressedKeys.current.has(" ")) {
      const snap = nearestScaleMidi(scale, leadMidi, LO, HI);
      const sx = midiToX(snap) * W;
      ctx.strokeStyle = "rgba(180,255,200,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, H * 0.1);
      ctx.lineTo(sx, H * 0.9);
      ctx.stroke();
    }

    // Level meter (top-right).
    const level = engineRef.current?.getLevel() ?? 0;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(W - 110, 14, 96, 4);
    ctx.fillStyle = level > 0.9 ? "#ff7373" : "rgba(180,220,255,0.9)";
    ctx.fillRect(W - 110, 14, 96 * level, 4);
  }

  // ---- Mouse handlers ----------------------------------------------------
  function onMouseMove(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mouse.current.x = (e.clientX - rect.left) / rect.width;
    mouse.current.y = (e.clientY - rect.top) / rect.height;
    mouse.current.inside = true;
  }
  async function onMouseDown(e: React.MouseEvent) {
    await ensureStarted();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mouse.current.x = (e.clientX - rect.left) / rect.width;
    mouse.current.y = (e.clientY - rect.top) / rect.height;
    mouse.current.down = true;
    const midi = xToMidi(mouse.current.x);
    engineRef.current?.leadNoteOn(midi);
  }
  function onMouseUp() {
    mouse.current.down = false;
    engineRef.current?.leadNoteOff();
    trailRef.current = [];
  }
  function onMouseLeave() {
    mouse.current.inside = false;
    if (mouse.current.down) onMouseUp();
  }

  // ---- Keyboard handlers -------------------------------------------------
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      await ensureStarted();

      // Scale switching 1..5.
      if (key >= "1" && key <= "5") {
        const idx = Number(key) - 1;
        if (idx < SCALES.length) setScaleIdx(idx);
        return;
      }

      pressedKeys.current.add(key);

      // Harmonizer pluck on keydown (follows current lead pitch).
      const pedal = PEDALS.find((p) => p.key === key);
      if (pedal && engineRef.current) {
        const lead = xToMidi(mouse.current.x);
        const target = stepScaleDegrees(scaleRef.current, lead, pedal.steps, LO, HI);
        engineRef.current.pluck(target, mouse.current.down ? 0.7 : 0.35);
      }

      // Drone latch on keydown.
      const drone = DRONES.find((d) => d.key === key);
      if (drone && engineRef.current && !droneStateRef.current.has(drone.key)) {
        const scale = scaleRef.current;
        const notes = scaleMidiNotes(scale, scale.tonic - 12, scale.tonic + 1);
        // Pick the scale degree as an offset in the scale itself, at the lower octave.
        const target =
          notes[Math.min(drone.degree, notes.length - 1)] ??
          scale.tonic + scale.intervals[drone.degree % scale.intervals.length];
        engineRef.current.droneOn(drone.key, target);
        droneStateRef.current.set(drone.key, target);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      pressedKeys.current.delete(key);
      const drone = DRONES.find((d) => d.key === key);
      if (drone && engineRef.current && droneStateRef.current.has(drone.key)) {
        engineRef.current.droneOff(drone.key);
        droneStateRef.current.delete(drone.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = useMemo(() => SCALES[scaleIdx], [scaleIdx]);

  return (
    <div className="app">
      <header className="hud">
        <div className="title">abstract pedal steel</div>
        <div className="scale">
          scale: <strong>{scale.name}</strong>{" "}
          <span className="dim">(press 1–5 to change)</span>
        </div>
        {!started && <div className="hint">click the canvas to start audio</div>}
      </header>

      <canvas
        ref={canvasRef}
        className="stage"
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />

      <footer className="legend">
        <div>
          <kbd>mouse</kbd> hold + drag → glissando · <kbd>y-axis</kbd> brightness / vibrato
        </div>
        <div>
          <kbd>space</kbd> quantize magnet · <kbd>shift</kbd> fast glide
        </div>
        <div>
          pedals (harmony):{" "}
          {PEDALS.map((p) => (
            <span key={p.key}>
              <kbd>{p.key.toUpperCase()}</kbd> {p.label}{" "}
            </span>
          ))}
          · drones: {DRONES.map((d) => (
            <span key={d.key}>
              <kbd>{d.key.toUpperCase()}</kbd> {d.label}{" "}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
