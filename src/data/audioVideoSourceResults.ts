export type AudioVideoSourceKind = "audio_file" | "video_file";

export type AudioVideoTranscriptionFormat = "external_transcription_results";

export type AudioVideoSourceResult = {
  sourceName: string;
  sourceKind: AudioVideoSourceKind;
  transcriptionFormat: AudioVideoTranscriptionFormat;
  transcriptionContent: Array<{
    time: number;
    instrument:
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
    velocity: number;
  }>;
};

export const AUDIO_VIDEO_SOURCE_RESULTS = {
  demo_audio_result: {
    sourceName: "demo_song.wav",
    sourceKind: "audio_file",
    transcriptionFormat: "external_transcription_results",
    transcriptionContent: [
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
  },
  demo_video_result: {
    sourceName: "demo_song.mp4",
    sourceKind: "video_file",
    transcriptionFormat: "external_transcription_results",
    transcriptionContent: [
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
  },
} as const;

export type AudioVideoSourceResultName = keyof typeof AUDIO_VIDEO_SOURCE_RESULTS;