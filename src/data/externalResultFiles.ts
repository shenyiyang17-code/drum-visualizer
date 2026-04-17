export const EXTERNAL_RESULT_FILES = {
  transcription_file_demo: {
    format: "external_transcription_results",
    sampleName: "ride_transcription",
  },
  initial_events_file_demo: {
    format: "external_initial_events",
    sampleName: "ride_groove",
  },
} as const;

export type ExternalResultFileName = keyof typeof EXTERNAL_RESULT_FILES;

export type ExternalResultFileEntry =
  (typeof EXTERNAL_RESULT_FILES)[ExternalResultFileName];