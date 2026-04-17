import {
  AUDIO_VIDEO_SOURCE_RESULTS,
  type AudioVideoSourceResult,
} from "./audioVideoSourceResults";

export type AudioVideoResultFileEntry = {
  format: "audio_video_source_result";
  content: AudioVideoSourceResult;
};

export const AUDIO_VIDEO_RESULT_FILES = {
  demo_audio_file_result: {
    format: "audio_video_source_result",
    content: {
      sourceName: AUDIO_VIDEO_SOURCE_RESULTS.demo_audio_result.sourceName,
      sourceKind: AUDIO_VIDEO_SOURCE_RESULTS.demo_audio_result.sourceKind,
      transcriptionFormat: AUDIO_VIDEO_SOURCE_RESULTS.demo_audio_result.transcriptionFormat,
      transcriptionContent:
        AUDIO_VIDEO_SOURCE_RESULTS.demo_audio_result.transcriptionContent.map((hit) => ({
          time: hit.time,
          instrument: hit.instrument,
          velocity: hit.velocity,
        })),
    },
  },
  demo_video_file_result: {
    format: "audio_video_source_result",
    content: {
      sourceName: AUDIO_VIDEO_SOURCE_RESULTS.demo_video_result.sourceName,
      sourceKind: AUDIO_VIDEO_SOURCE_RESULTS.demo_video_result.sourceKind,
      transcriptionFormat: AUDIO_VIDEO_SOURCE_RESULTS.demo_video_result.transcriptionFormat,
      transcriptionContent:
        AUDIO_VIDEO_SOURCE_RESULTS.demo_video_result.transcriptionContent.map((hit) => ({
          time: hit.time,
          instrument: hit.instrument,
          velocity: hit.velocity,
        })),
    },
  },
} satisfies Record<string, AudioVideoResultFileEntry>;

export type AudioVideoResultFileName = keyof typeof AUDIO_VIDEO_RESULT_FILES;