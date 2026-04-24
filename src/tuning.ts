// E9 pedal steel tuning + standard Emmons-ish copedent.
//
// Array order is top-of-keyboard convention: index 0 is string 10 (lowest),
// index 9 is string 1 (highest). Home-row keys A..; map left-to-right onto
// these 10 entries.

export type StringDef = {
  name: string;   // pedal-steel string number ("1".."10")
  midi: number;   // open-string MIDI note
  label: string;  // pitch name (for HUD)
};

export const STRINGS: StringDef[] = [
  { name: "10", midi: 47, label: "B2"  },
  { name: "9",  midi: 50, label: "D3"  },
  { name: "8",  midi: 52, label: "E3"  },
  { name: "7",  midi: 54, label: "F#3" },
  { name: "6",  midi: 56, label: "G#3" },
  { name: "5",  midi: 59, label: "B3"  },
  { name: "4",  midi: 64, label: "E4"  },
  { name: "3",  midi: 68, label: "G#4" },
  { name: "2",  midi: 75, label: "D#5" },
  { name: "1",  midi: 78, label: "F#5" },
];

export const NUM_STRINGS = STRINGS.length;

// Home-row → string index. Left to right = low to high.
export const HOMEROW_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];

// A pedal/lever changes a subset of strings by some semitones.
// `offsets[i]` is the signed semitone change applied to STRINGS[i] when held.
export type Pedal = {
  id: string;
  label: string;
  offsets: number[]; // length = NUM_STRINGS
};

// Pedals / knee levers (classic E9 Emmons setup, with small liberties).
// Offsets are indexed the same as STRINGS (index 0 = string 10).
//
//  str:      10  9  8  7  6  5  4  3  2  1
//  idx:       0  1  2  3  4  5  6  7  8  9
export const PEDALS: Pedal[] = [
  { id: "A",   label: "A (5,10 +2)",   offsets: [ 2, 0, 0, 0, 0, 2, 0, 0, 0, 0] },
  { id: "B",   label: "B (3,6 +1)",    offsets: [ 0, 0, 0, 0, 1, 0, 0, 1, 0, 0] },
  { id: "C",   label: "C (4,5 +2)",    offsets: [ 0, 0, 0, 0, 0, 2, 2, 0, 0, 0] },
  { id: "LKL", label: "LKL (4,8 +1)",  offsets: [ 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { id: "LKR", label: "LKR (4,8 -1)",  offsets: [ 0, 0,-1, 0, 0, 0,-1, 0, 0, 0] },
  { id: "RKL", label: "RKL (2,9 -1)",  offsets: [ 0,-1, 0, 0, 0, 0, 0, 0,-1, 0] },
  { id: "RKR", label: "RKR (2 +1,9 +1)", offsets: [ 0, 1, 0, 0, 0, 0, 0, 0, 1, 0] },
];

// Number-row keys map to pedals in order.
export const PEDAL_KEYS = ["1", "2", "3", "4", "5", "6", "7"];

// Bar range in semitones (equivalent to ~24 frets). 0 = open string (nut).
export const BAR_RANGE_SEMIS = 24;

// Maximum bar-slant applied to edge strings, in semitones.
// A slant of ±slantRange bends edge strings; interior strings bend less.
export const MAX_SLANT_SEMIS = 3;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Compute the per-string semitone offset contributed by bar slant.
// x: 0..1 across the pad. Center (0.5) = no slant.
// Higher-index strings (index closer to NUM_STRINGS-1) bend one direction;
// lower-index strings bend the opposite direction. Linear across strings.
export function slantOffset(stringIdx: number, x: number): number {
  const centered = (x - 0.5) * 2;                       // -1..1
  const stringPos = (stringIdx - (NUM_STRINGS - 1) / 2) // -4.5..4.5
    / ((NUM_STRINGS - 1) / 2);                          // normalize to -1..1
  return centered * stringPos * MAX_SLANT_SEMIS;
}

// Compute the bar pitch offset from Y. y=0 (top) = nut (0 semis).
// y=1 (bottom) = BAR_RANGE_SEMIS.
export function barOffset(y: number): number {
  return Math.max(0, Math.min(1, y)) * BAR_RANGE_SEMIS;
}
