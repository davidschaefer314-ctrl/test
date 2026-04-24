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

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

function xToMidi(x: number): number {
  return LO + (HI - LO) * Math.max(0, Math.min(1, x));
}
function midiToX(midi: number): number {
  return (midi - LO) / (HI - LO);
}
function midiToName(midi: number): string {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export default function Instrument() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const [scaleIdx, setScaleIdx] = useState(0);
  const [started, setStarted] = useState(false);

  const mouse = useRef({ x: 0.5, y: 0.5, down: false, inside: false });
  const pressedKeys = useRef<Set<string>>(new Set());
  const droneStateRef = useRef<Map<string, number>>(new Map());
  const scaleRef = useRef<Scale>(SCALES[0]);
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    scaleRef.current = SCALES[scaleIdx];
  }, [scaleIdx]);

  async function startAudio() {
    if (!engineRef.current) engineRef.current = createEngine();
    if (!startedRef.current) {
      await engineRef.current.start();
      startedRef.current = true;
      setStarted(true);
    }
  }

  // ---- Main render loop (audio params driven from refs, no state churn) -
  useEffect(() => {
    let raf = 0;
    let lastMidi = xToMidi(mouse.current.x);

    const loop = () => {
      const engine = engineRef.current;
      const scale = scaleRef.current;

      if (engine) {
        let targetMidi = xToMidi(mouse.current.x);

        if (pressedKeys.current.has(" ")) {
          const snap = nearestScaleMidi(scale, targetMidi, LO, HI);
          targetMidi = targetMidi * 0.15 + snap * 0.85;
        }

        const glide = pressedKeys.current.has("shift") ? 0.005 : 0.05;
        engine.setLeadPitch(targetMidi, glide);
        engine.setBrightness(1 - mouse.current.y);
        engine.setVibrato(mouse.current.y);

        lastMidi = targetMidi;
      }

      const now = performance.now();
      if (mouse.current.down && mouse.current.inside) {
        trailRef.current.push({ x: mouse.current.x, y: mouse.current.y, t: now });
      }
      const cutoff = now - 700;
      while (trailRef.current.length && trailRef.current[0].t < cutoff) trailRef.current.shift();

      draw(lastMidi);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Drawing -----------------------------------------------------------
  function draw(leadMidi: number) {
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
        ctx.fillText(`C${octave}`, x, H * 0.92);
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
        const age = (now - b.t) / 700;
        ctx.strokeStyle = `rgba(180,220,255,${(1 - age) * 0.7})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
    }

    // Vertical pitch cursor — always visible when mouse is over the canvas.
    const leadX = midiToX(leadMidi) * W;
    const leadY = mouse.current.y * H;
    const active = mouse.current.down;
    if (mouse.current.inside || active) {
      ctx.strokeStyle = active ? "rgba(180,220,255,0.5)" : "rgba(180,220,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leadX, 0);
      ctx.lineTo(leadX, H);
      ctx.stroke();
    }

    // Playhead orb.
    const wobble = active
      ? Math.sin(performance.now() / (80 + (1 - mouse.current.y) * 120)) * mouse.current.y * 4
      : 0;
    const haloR = active ? 44 : 16;
    const halo = ctx.createRadialGradient(leadX, leadY + wobble, 0, leadX, leadY + wobble, haloR);
    halo.addColorStop(0, active ? "rgba(180,220,255,0.95)" : "rgba(180,220,255,0.35)");
    halo.addColorStop(1, "rgba(180,220,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(leadX, leadY + wobble, haloR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = active ? "#ffffff" : "rgba(234,243,255,0.55)";
    ctx.beginPath();
    ctx.arc(leadX, leadY + wobble, active ? 10 : 5, 0, Math.PI * 2);
    ctx.fill();

    // Note-name label near the orb (visible whenever the mouse is over the canvas).
    if (mouse.current.inside || active) {
      ctx.fillStyle = active ? "#ffffff" : "rgba(234,243,255,0.65)";
      ctx.font = `${active ? 18 : 13}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "left";
      const name = midiToName(leadMidi);
      ctx.fillText(name, leadX + 14, leadY - 14 + wobble);
    }

    // Harmony orbs for held pedals.
    if (active) {
      for (const p of PEDALS) {
        if (!pressedKeys.current.has(p.key)) continue;
        const harmMidi = stepScaleDegrees(scale, leadMidi, p.steps, LO, HI);
        const hx = midiToX(harmMidi) * W;
        ctx.fillStyle = "rgba(255,210,150,0.9)";
        ctx.beginPath();
        ctx.arc(hx, leadY - 28 + wobble * 0.5, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,210,150,0.4)";
        ctx.beginPath();
        ctx.moveTo(leadX, leadY + wobble);
        ctx.lineTo(hx, leadY - 28 + wobble * 0.5);
        ctx.stroke();
      }
    }

    // Quantize indicator when space is held.
    if (pressedKeys.current.has(" ")) {
      const snap = nearestScaleMidi(scale, leadMidi, LO, HI);
      const sx = midiToX(snap) * W;
      ctx.strokeStyle = "rgba(180,255,200,0.85)";
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

  // ---- Pointer handlers --------------------------------------------------
  function updatePointer(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mouse.current.x = (e.clientX - rect.left) / rect.width;
    mouse.current.y = (e.clientY - rect.top) / rect.height;
    mouse.current.inside = true;
  }
  function onPointerMove(e: React.PointerEvent) {
    updatePointer(e);
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!startedRef.current) return; // start overlay handles the first click
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updatePointer(e);
    mouse.current.down = true;
    engineRef.current?.leadNoteOn(xToMidi(mouse.current.x));
  }
  function onPointerUp() {
    if (!mouse.current.down) return;
    mouse.current.down = false;
    engineRef.current?.leadNoteOff();
    trailRef.current = [];
  }
  function onPointerLeave() {
    mouse.current.inside = false;
  }

  // ---- Keyboard handlers -------------------------------------------------
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (!startedRef.current) await startAudio();

      if (key >= "1" && key <= "5") {
        const idx = Number(key) - 1;
        if (idx < SCALES.length) setScaleIdx(idx);
        return;
      }

      pressedKeys.current.add(key);

      const pedal = PEDALS.find((p) => p.key === key);
      if (pedal && engineRef.current) {
        const leadPitch = xToMidi(mouse.current.x);
        const target = stepScaleDegrees(scaleRef.current, leadPitch, pedal.steps, LO, HI);
        engineRef.current.pluck(target, mouse.current.down ? 0.7 : 0.4);
      }

      const drone = DRONES.find((d) => d.key === key);
      if (drone && engineRef.current && !droneStateRef.current.has(drone.key)) {
        const scale = scaleRef.current;
        const notes = scaleMidiNotes(scale, scale.tonic - 12, scale.tonic + 1);
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
      </header>

      <div className="stage-wrap">
        <canvas
          ref={canvasRef}
          className="stage"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
        {!started && (
          <button
            className="start-overlay"
            onClick={async () => {
              await startAudio();
            }}
          >
            <div className="start-big">click to start</div>
            <div className="start-sub">
              then press & <em>hold</em> the mouse button on the canvas and drag
            </div>
          </button>
        )}
      </div>

      <footer className="legend">
        <div>
          <kbd>mouse</kbd> press + hold + drag → glissando · <kbd>y-axis</kbd> brightness / vibrato
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
