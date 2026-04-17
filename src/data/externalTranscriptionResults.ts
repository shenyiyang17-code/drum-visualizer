export type ExternalTranscriptionInstrument =
  | "kick"
  | "snare"
  | "hihat_closed"
  | "hihat_open"
  | "hihat_pedal"
  | "crash"
  | "ride"
  | "tom_high"
  | "tom_mid"
  | "tom_floor"
  | "unknown";

export type ExternalTranscriptionHit = {
  time: number;
  instrument: ExternalTranscriptionInstrument;
  velocity: number;
};

export const EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES = {
  basic_transcription: [
    { time: 0.0, instrument: "kick", velocity: 0.9 },
    { time: 0.0, instrument: "hihat_closed", velocity: 0.7 },
    { time: 0.5, instrument: "hihat_closed", velocity: 0.7 },
    { time: 1.0, instrument: "snare", velocity: 0.85 },
    { time: 1.0, instrument: "hihat_closed", velocity: 0.7 },
    { time: 1.5, instrument: "hihat_open", velocity: 0.72 },
    { time: 2.0, instrument: "kick", velocity: 0.88 },
    { time: 2.0, instrument: "hihat_closed", velocity: 0.68 },
    { time: 3.0, instrument: "snare", velocity: 0.84 },
    { time: 3.0, instrument: "crash", velocity: 0.8 },
  ],
  ride_transcription: [
    { time: 0.0, instrument: "kick", velocity: 0.9 },
    { time: 0.0, instrument: "ride", velocity: 0.72 },
    { time: 0.5, instrument: "ride", velocity: 0.72 },
    { time: 1.0, instrument: "snare", velocity: 0.86 },
    { time: 1.0, instrument: "ride", velocity: 0.72 },
    { time: 1.5, instrument: "ride", velocity: 0.72 },
    { time: 2.0, instrument: "kick", velocity: 0.88 },
    { time: 2.0, instrument: "ride", velocity: 0.72 },
    { time: 3.0, instrument: "snare", velocity: 0.84 },
    { time: 3.0, instrument: "crash", velocity: 0.8 },
  ],
} as const;

export type ExternalTranscriptionSampleName =
  keyof typeof EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES;

export const EXTERNAL_TRANSCRIPTION_SAMPLE_NAMES = Object.keys(
  EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES
) as ExternalTranscriptionSampleName[];