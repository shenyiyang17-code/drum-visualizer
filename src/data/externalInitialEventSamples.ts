export type ExternalInitialDrumInstrument =
  | "BD"
  | "SD"
  | "HH"
  | "CR"
  | "RD"
  | "TM_HIGH"
  | "TM_MID"
  | "TM_FLOOR"
  | "UNMAPPED";

export type ExternalInitialDrumArticulation =
  | "normal"
  | "closed"
  | "open"
  | "pedal"
  | "ghost"
  | "unknown";

export type ExternalInitialDrumEvent = {
  time: number;
  instrument: ExternalInitialDrumInstrument;
  articulation: ExternalInitialDrumArticulation;
  velocity: number;
};

export const EXTERNAL_INITIAL_EVENT_SAMPLES = {
  basic_groove: [
    { time: 0.0, instrument: "BD", articulation: "normal", velocity: 0.9 },
    { time: 0.0, instrument: "HH", articulation: "closed", velocity: 0.7 },
    { time: 0.5, instrument: "HH", articulation: "closed", velocity: 0.7 },
    { time: 1.0, instrument: "SD", articulation: "normal", velocity: 0.85 },
    { time: 1.0, instrument: "HH", articulation: "closed", velocity: 0.7 },
    { time: 1.5, instrument: "HH", articulation: "open", velocity: 0.72 },
    { time: 2.0, instrument: "BD", articulation: "normal", velocity: 0.88 },
    { time: 2.0, instrument: "HH", articulation: "closed", velocity: 0.68 },
    { time: 3.0, instrument: "SD", articulation: "normal", velocity: 0.84 },
    { time: 3.0, instrument: "CR", articulation: "normal", velocity: 0.8 },
  ],
  ride_groove: [
    { time: 0.0, instrument: "BD", articulation: "normal", velocity: 0.9 },
    { time: 0.0, instrument: "RD", articulation: "normal", velocity: 0.72 },
    { time: 0.5, instrument: "RD", articulation: "normal", velocity: 0.72 },
    { time: 1.0, instrument: "SD", articulation: "normal", velocity: 0.86 },
    { time: 1.0, instrument: "RD", articulation: "normal", velocity: 0.72 },
    { time: 1.5, instrument: "RD", articulation: "normal", velocity: 0.72 },
    { time: 2.0, instrument: "BD", articulation: "normal", velocity: 0.88 },
    { time: 2.0, instrument: "RD", articulation: "normal", velocity: 0.72 },
    { time: 3.0, instrument: "SD", articulation: "normal", velocity: 0.84 },
    { time: 3.0, instrument: "CR", articulation: "normal", velocity: 0.8 },
  ],
} as const;

export type ExternalInitialSampleName = keyof typeof EXTERNAL_INITIAL_EVENT_SAMPLES;