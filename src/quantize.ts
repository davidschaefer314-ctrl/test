// Snap-to-scale quantization with adjustable strength.
//
// Strength 0 → passthrough. Strength 1 → hard-snap to the nearest scale note.
// In between we linearly interpolate, which gives a "magnetic" feel.

export type Scale = {
  name: string;
  tonic: number;         // MIDI pitch class of the tonic (0..11)
  intervals: number[];   // semitones from tonic within one octave
};

export const SCALES: Scale[] = [
  { name: "chromatic",  tonic: 4, intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
  { name: "E major",    tonic: 4, intervals: [0,2,4,5,7,9,11] },
  { name: "E mixolyd.", tonic: 4, intervals: [0,2,4,5,7,9,10] },
  { name: "E min pent", tonic: 4, intervals: [0,3,5,7,10] },
  { name: "E maj pent", tonic: 4, intervals: [0,2,4,7,9] },
];

// Return the nearest MIDI value belonging to `scale` to the given fractional midi.
export function nearestInScale(scale: Scale, midi: number): number {
  // Candidates: for each interval, pick the closest octave.
  let best = midi;
  let bestD = Infinity;
  // Round to nearest octave that could host the note, check a neighborhood.
  const baseOct = Math.floor((midi - scale.tonic) / 12);
  for (let o = baseOct - 1; o <= baseOct + 1; o++) {
    for (const iv of scale.intervals) {
      const n = scale.tonic + o * 12 + iv;
      const d = Math.abs(n - midi);
      if (d < bestD) { bestD = d; best = n; }
    }
  }
  return best;
}

// Blend toward the nearest scale note by `strength` (0..1).
export function snap(scale: Scale, midi: number, strength: number): number {
  if (strength <= 0) return midi;
  const s = Math.min(1, strength);
  const target = nearestInScale(scale, midi);
  return midi + (target - midi) * s;
}
