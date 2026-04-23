// Scale degrees expressed as semitone offsets from the tonic (repeating per octave).
export type Scale = {
  name: string;
  tonic: number; // midi note of the tonic
  intervals: number[]; // ascending, ending before the octave
};

export const SCALES: Scale[] = [
  { name: "C major pentatonic", tonic: 60, intervals: [0, 2, 4, 7, 9] },
  { name: "C major", tonic: 60, intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: "D dorian", tonic: 62, intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: "G mixolydian", tonic: 55, intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: "A minor pentatonic", tonic: 57, intervals: [0, 3, 5, 7, 10] },
];

// Build a sorted list of midi notes belonging to the scale across [lo, hi].
export function scaleMidiNotes(scale: Scale, lo: number, hi: number): number[] {
  const out: number[] = [];
  const startOct = Math.floor((lo - scale.tonic) / 12) - 1;
  const endOct = Math.floor((hi - scale.tonic) / 12) + 1;
  for (let o = startOct; o <= endOct; o++) {
    for (const iv of scale.intervals) {
      const n = scale.tonic + o * 12 + iv;
      if (n >= lo && n <= hi) out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

// Nearest scale midi note to a (possibly fractional) midi pitch.
export function nearestScaleMidi(scale: Scale, midi: number, lo: number, hi: number): number {
  const notes = scaleMidiNotes(scale, lo, hi);
  let best = notes[0];
  let bestD = Math.abs(midi - best);
  for (const n of notes) {
    const d = Math.abs(midi - n);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// Step `steps` scale degrees up from a given scale midi note (steps may be negative).
export function stepScaleDegrees(
  scale: Scale,
  fromMidi: number,
  steps: number,
  lo: number,
  hi: number
): number {
  const notes = scaleMidiNotes(scale, lo, hi);
  // Find nearest index.
  let idx = 0;
  let bestD = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const d = Math.abs(notes[i] - fromMidi);
    if (d < bestD) {
      bestD = d;
      idx = i;
    }
  }
  const target = Math.max(0, Math.min(notes.length - 1, idx + steps));
  return notes[target];
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
