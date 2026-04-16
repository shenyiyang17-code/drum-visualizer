export const V3_ALLOWED_INSTRUMENTS = [
  "BD",
  "SD",
  "HH",
  "CR",
  "RD",
  "TM_HIGH",
  "TM_MID",
  "TM_FLOOR",
] as const;

export type BasicDrumInstrument = (typeof V3_ALLOWED_INSTRUMENTS)[number];

export type V3DrumArticulation = "normal" | "closed" | "open" | "pedal" | "ghost";

export type V3TempDrumEvent = {
  time: number;
  instrument: BasicDrumInstrument;
  articulation: V3DrumArticulation;
  velocity: number;
  stepIndex: number;
  beatIndex: number;
  barIndex: number;
};

export type V3StepNoteGroup = {
  stepIndex: number;
  notes: V3TempDrumEvent[];
};