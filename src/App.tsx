import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Midi } from "@tonejs/midi";
import ScoreView from "./components/ScoreView";
import {
  EXTERNAL_INITIAL_EVENT_SAMPLES,
  type ExternalInitialDrumEvent,
  type ExternalInitialSampleName,
} from "./data/externalInitialEventSamples";
import {
  EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES,
  EXTERNAL_TRANSCRIPTION_SAMPLE_NAMES,
  type ExternalTranscriptionHit,
  type ExternalTranscriptionInstrument,
  type ExternalTranscriptionSampleName,
} from "./data/externalTranscriptionResults";
import {
  EXTERNAL_RESULT_FILES,
  type ExternalResultFileEntry,
  type ExternalResultFileName,
} from "./data/externalResultFiles";
import {
  AUDIO_VIDEO_SOURCE_RESULTS,
  type AudioVideoSourceResult,
  type AudioVideoSourceResultName,
} from "./data/audioVideoSourceResults";
import {
  AUDIO_VIDEO_RESULT_FILES,
  type AudioVideoResultFileEntry,
  type AudioVideoResultFileName,
} from "./data/audioVideoResultFiles";
import drumDataRaw from "./drum_events.json";
import {
  V3_ALLOWED_INSTRUMENTS,
  type BasicDrumInstrument,
  type V3DrumArticulation,
  type V3StepNoteGroup,
  type V3TempDrumEvent,
} from "./types/v3Drum";

type TrackName = "HH" | "SD" | "BD";

type DrumEvent = {
  time: number;
  track: TrackName;
};

type MappedDrumInstrument = Exclude<BasicDrumInstrument, "UNMAPPED">;
type MappedDrumArticulation = Exclude<V3DrumArticulation, "unknown">;

type MappedDrumInfo = {
  instrument: MappedDrumInstrument;
  articulation: MappedDrumArticulation;
};

type InitialDrumInstrument =
  | "BD"
  | "SD"
  | "HH"
  | "CR"
  | "RD"
  | "TM_HIGH"
  | "TM_MID"
  | "TM_FLOOR"
  | "UNMAPPED";

type InitialDrumArticulation =
  | "normal"
  | "closed"
  | "open"
  | "pedal"
  | "ghost"
  | "unknown";

type InitialDrumEvent = {
  time: number;
  instrument: InitialDrumInstrument;
  articulation: InitialDrumArticulation;
  velocity: number;
};

type InputSourceType = "midi_test" | "external_initial_events";

type InputMode =
  | "midi_test"
  | "external_initial_events"
  | "external_transcription_results"
  | "external_result_file"
  | "audio_video_source_result"
  | "audio_video_result_file";

type PipelineInput =
  | {
      sourceType: Extract<InputSourceType, "midi_test">;
      midiNotes: Array<{ midi: number; time: number; velocity: number }>;
    }
  | {
      sourceType: Extract<InputSourceType, "external_initial_events">;
      initialEvents: InitialDrumEvent[];
    };

type ActiveInputModeSummary = {
  mode: InputMode;
  midiTestFile: string | null;
  externalInitialSample: string | null;
  externalTranscriptionSample: string | null;
  externalResultFile: string | null;
  audioVideoSourceResult: string | null;
  audioVideoResultFile: string | null;
};

type ExternalResultFileContentItem = ExternalInitialDrumEvent | ExternalTranscriptionHit;

type ResolvedExternalResultFileEntry = {
  format: ExternalResultFileEntry["format"];
  content: ExternalResultFileContentItem[];
};

type EditMode = "setLoopStart" | "setLoopEnd" | null;

type DrumDataShape =
  | DrumEvent[]
  | {
      bpm?: number;
      duration?: number;
      events?: Array<{
        time?: number;
        t?: number;
        instrument?: string;
        track?: string;
        lane?: string;
      }>;
    };

type TrackTypeId = "original" | "drums" | "guitar" | "bass";

type TrackTypeConfig = {
  label: string;
  audioSrc: string;
};

type PracticeContent = {
  title: string;
  scoreData: DrumDataShape;
  trackTypes: Record<TrackTypeId, TrackTypeConfig>;
};

const TRACK_TYPE_OPTIONS: Array<{ id: TrackTypeId; label: string }> = [
  { id: "original", label: "原曲" },
  { id: "drums", label: "鼓轨" },
  { id: "guitar", label: "吉他轨（开发中）" },
  { id: "bass", label: "贝斯轨（开发中）" },
];

const TARGET_TEST_BAR_COUNT = 32;
const DEFAULT_BEATS_PER_BAR = 4;
const AUDIO_BAR_START_TIME = 0;
const AUDIO_BAR_END_TIME = 62;

const PRACTICE_CONTENT: PracticeContent = {
  title: "Billie Jean",
  scoreData: drumDataRaw as DrumDataShape,
  trackTypes: {
    original: { label: "原曲", audioSrc: "/audio/billie-jean.wav" },
    drums: { label: "鼓轨", audioSrc: "/audio/billie-jean.wav" },
    guitar: { label: "吉他轨（开发中）", audioSrc: "/audio/billie-jean.wav" },
    bass: { label: "贝斯轨（开发中）", audioSrc: "/audio/billie-jean.wav" },
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatClockTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const totalSeconds = Math.floor(safeValue);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function quantizeToGrid(time: number, stepDuration: number) {
  const stepIndex = Math.round(time / stepDuration);
  return {
    stepIndex,
    quantizedTime: stepIndex * stepDuration,
  };
}

function dedupeEventsByStepAndInstrument(events: V3TempDrumEvent[]) {
  const seen = new Map<string, V3TempDrumEvent>();

  for (const ev of events) {
    const key = `${ev.stepIndex}:${ev.instrument}:${ev.articulation}`;

    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, ev);
      continue;
    }

    if (ev.velocity > prev.velocity) {
      seen.set(key, ev);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.stepIndex !== b.stepIndex) return a.stepIndex - b.stepIndex;
    return a.time - b.time;
  });
}

function getLowValueNoiseCandidates(events: V3TempDrumEvent[]) {
  return events.filter((ev) => {
    if (ev.instrument === "UNMAPPED") return true;

    if (ev.velocity <= 0.15) return true;

    return false;
  });
}

function filterSafeNoiseCandidates(events: V3TempDrumEvent[]) {
  return events.filter((ev) => {
    if (
      ev.instrument === "SD" &&
      ev.articulation === "normal" &&
      ev.velocity <= 0.15
    ) {
      return false;
    }

    return true;
  });
}

function simplifyForPractice(events: V3TempDrumEvent[]) {
  const hhLike = new Set(["HH"]);
  const cymbalLike = new Set(["CR", "RD"]);

  return events.filter((ev, index, arr) => {
    if (ev.instrument === "BD" || ev.instrument === "SD") return true;

    if (hhLike.has(ev.instrument) || cymbalLike.has(ev.instrument)) {
      let prevSame: V3TempDrumEvent | null = null;

      for (let i = index - 1; i >= 0; i -= 1) {
        if (arr[i].instrument === ev.instrument) {
          prevSame = arr[i];
          break;
        }
      }

      if (prevSame && ev.stepIndex - prevSame.stepIndex === 1) {
        return false;
      }
    }

    return true;
  });
}

function normalizeTrackName(input: string | undefined): TrackName | null {
  if (!input) return null;
  const v = input.toLowerCase();

  if (["hh", "hihat", "hi-hat", "hat"].includes(v)) return "HH";
  if (["sd", "snare"].includes(v)) return "SD";
  if (["bd", "kick", "bassdrum", "bass", "kickdrum"].includes(v)) return "BD";

  return null;
}

function normalizeDrumData(raw: DrumDataShape): {
  bpm: number;
  duration: number;
  events: DrumEvent[];
} {
  let bpm = 120;
  let duration = 0;
  let events: DrumEvent[] = [];

  if (Array.isArray(raw)) {
    events = raw
      .map((e: any) => {
        const track = normalizeTrackName(e.track ?? e.instrument ?? e.lane);
        const time = Number(e.time ?? e.t ?? 0);
        if (!track || Number.isNaN(time)) return null;
        return { time, track };
      })
      .filter(Boolean) as DrumEvent[];
  } else {
    bpm = Number(raw.bpm ?? 120);
    duration = Number(raw.duration ?? 0);

    events = (raw.events ?? [])
      .map((e) => {
        const track = normalizeTrackName(e.track ?? e.instrument ?? e.lane);
        const time = Number(e.time ?? e.t ?? 0);
        if (!track || Number.isNaN(time)) return null;
        return { time, track };
      })
      .filter(Boolean) as DrumEvent[];
  }

  if (!duration && events.length > 0) {
    duration = Math.max(...events.map((e) => e.time)) + 2;
  }

  return {
    bpm,
    duration: Math.max(duration, 8),
    events,
  };
}

function extendDrumDataToBars(
  raw: DrumDataShape,
  targetBarCount: number,
  beatsPerBar: number
): DrumDataShape {
  const normalized = normalizeDrumData(raw);
  const secondsPerBeat = 60 / normalized.bpm;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  const currentBarCount = Math.ceil(normalized.duration / secondsPerBar);

  if (currentBarCount >= targetBarCount || normalized.events.length === 0) {
    return {
      bpm: normalized.bpm,
      duration: normalized.duration,
      events: normalized.events,
    };
  }

  const maxEventTime = Math.max(...normalized.events.map((event) => event.time));
  const patternBarCount = Math.max(1, Math.ceil((maxEventTime + 0.0001) / secondsPerBar));
  const patternDuration = patternBarCount * secondsPerBar;
  const targetDuration = targetBarCount * secondsPerBar;
  const repeatCount = Math.ceil(targetDuration / patternDuration);

  const repeatedEvents: DrumEvent[] = [];

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    const offset = repeatIndex * patternDuration;

    for (const event of normalized.events) {
      const nextTime = event.time + offset;
      if (nextTime >= targetDuration) continue;
      repeatedEvents.push({ ...event, time: nextTime });
    }
  }

  return {
    bpm: normalized.bpm,
    duration: targetDuration,
    events: repeatedEvents,
  };
}

function buildStepMap(
  events: DrumEvent[],
  stepCount: number,
  stepDuration: number
): Record<TrackName, Set<number>> {
  const map: Record<TrackName, Set<number>> = {
    HH: new Set<number>(),
    SD: new Set<number>(),
    BD: new Set<number>(),
  };

  for (const ev of events) {
    const step = Math.round(ev.time / stepDuration);
    if (step >= 0 && step < stepCount) {
      map[ev.track].add(step);
    }
  }

  return map;
}

// 第一版映射规则
const MIDI_NOTE_TO_DRUM_INFO: Record<number, MappedDrumInfo> = {
  36: { instrument: "BD", articulation: "normal" },
  37: { instrument: "SD", articulation: "ghost" },
  38: { instrument: "SD", articulation: "normal" },
  40: { instrument: "SD", articulation: "ghost" },
  41: { instrument: "TM_FLOOR", articulation: "normal" },
  42: { instrument: "HH", articulation: "closed" },
  43: { instrument: "TM_FLOOR", articulation: "normal" },
  44: { instrument: "HH", articulation: "pedal" },
  45: { instrument: "TM_MID", articulation: "normal" },
  46: { instrument: "HH", articulation: "open" },
  47: { instrument: "TM_MID", articulation: "normal" },
  48: { instrument: "TM_HIGH", articulation: "normal" },
  49: { instrument: "CR", articulation: "normal" },
  50: { instrument: "TM_HIGH", articulation: "normal" },
  51: { instrument: "RD", articulation: "normal" },
  53: { instrument: "RD", articulation: "normal" },
  57: { instrument: "CR", articulation: "normal" },
  59: { instrument: "RD", articulation: "normal" },
};

function mapMidiNoteToDrumInfo(midiNote: number): MappedDrumInfo | null {
  return MIDI_NOTE_TO_DRUM_INFO[midiNote] ?? null;
}

function buildInitialDrumEventsFromMidiNotes(
  notes: Array<{ midi: number; time: number; velocity: number }>
): InitialDrumEvent[] {
  return notes.map((note) => {
    const mapped = mapMidiNoteToDrumInfo(note.midi);

    if (!mapped) {
      return {
        time: note.time,
        instrument: "UNMAPPED",
        articulation: "unknown",
        velocity: note.velocity,
      };
    }

    return {
      time: note.time,
      instrument: mapped.instrument,
      articulation: mapped.articulation,
      velocity: note.velocity,
    };
  });
}

function buildPipelineInputToInitialEvents(input: PipelineInput): InitialDrumEvent[] {
  if (input.sourceType === "midi_test") {
    return buildInitialDrumEventsFromMidiNotes(input.midiNotes);
  }

  return input.initialEvents;
}

function buildPipelineInputFromExternalInitialEvents(
  initialEvents: InitialDrumEvent[]
): PipelineInput {
  return {
    sourceType: "external_initial_events",
    initialEvents,
  };
}

function getActiveExternalInitialEvents(
  sampleName: ExternalInitialSampleName
): InitialDrumEvent[] {
  return EXTERNAL_INITIAL_EVENT_SAMPLES[sampleName].map((ev: ExternalInitialDrumEvent) => ({
    time: ev.time,
    instrument: ev.instrument,
    articulation: ev.articulation,
    velocity: ev.velocity,
  }));
}

function mapExternalTranscriptionInstrument(
  instrument: ExternalTranscriptionInstrument
): {
  instrument: InitialDrumInstrument;
  articulation: InitialDrumArticulation;
} {
  switch (instrument) {
    case "kick":
      return { instrument: "BD", articulation: "normal" };
    case "snare":
      return { instrument: "SD", articulation: "normal" };
    case "hihat_closed":
      return { instrument: "HH", articulation: "closed" };
    case "hihat_open":
      return { instrument: "HH", articulation: "open" };
    case "hihat_pedal":
      return { instrument: "HH", articulation: "pedal" };
    case "crash":
      return { instrument: "CR", articulation: "normal" };
    case "ride":
      return { instrument: "RD", articulation: "normal" };
    case "tom_high":
      return { instrument: "TM_HIGH", articulation: "normal" };
    case "tom_mid":
      return { instrument: "TM_MID", articulation: "normal" };
    case "tom_floor":
      return { instrument: "TM_FLOOR", articulation: "normal" };
    default:
      return { instrument: "UNMAPPED", articulation: "unknown" };
  }
}

function buildInitialEventsFromExternalTranscriptionHits(
  hits: ExternalTranscriptionHit[]
): InitialDrumEvent[] {
  return hits.map((hit) => {
    const mapped = mapExternalTranscriptionInstrument(hit.instrument);
    return {
      time: hit.time,
      instrument: mapped.instrument,
      articulation: mapped.articulation,
      velocity: hit.velocity,
    };
  });
}

function getActiveExternalTranscriptionHits(
  sampleName: ExternalTranscriptionSampleName
): ExternalTranscriptionHit[] {
  return EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES[sampleName].map((hit) => ({
    time: hit.time,
    instrument: hit.instrument,
    velocity: hit.velocity,
  }));
}

function buildPipelineInputFromExternalTranscriptionSample(
  sampleName: ExternalTranscriptionSampleName
): PipelineInput {
  const hits = getActiveExternalTranscriptionHits(sampleName);
  const initialEvents = buildInitialEventsFromExternalTranscriptionHits(
    hits.map((hit: ExternalTranscriptionHit) => ({
      time: hit.time,
      instrument: hit.instrument,
      velocity: hit.velocity,
    }))
  );

  return buildPipelineInputFromExternalInitialEvents(initialEvents);
}

function isValidExternalResultFileFormat(
  format: unknown
): format is "external_initial_events" | "external_transcription_results" {
  return (
    format === "external_initial_events" ||
    format === "external_transcription_results"
  );
}

function validateExternalResultFileEntry(fileEntry: unknown) {
  if (!fileEntry || typeof fileEntry !== "object") {
    return {
      isValid: false,
      reason: "file entry is not an object",
      format: null,
      contentCount: 0,
    };
  }

  const maybeEntry = fileEntry as {
    format?: unknown;
    content?: unknown;
  };

  if (!isValidExternalResultFileFormat(maybeEntry.format)) {
    return {
      isValid: false,
      reason: "invalid file format",
      format: maybeEntry.format ?? null,
      contentCount: 0,
    };
  }

  if (!Array.isArray(maybeEntry.content)) {
    return {
      isValid: false,
      reason: "content is not an array",
      format: maybeEntry.format,
      contentCount: 0,
    };
  }

  return {
    isValid: true,
    reason: null,
    format: maybeEntry.format,
    contentCount: maybeEntry.content.length,
  };
}

function validateExternalResultFileContentSample(
  fileEntry: ResolvedExternalResultFileEntry
) {
  const sample = fileEntry.content.slice(0, 10);

  const invalidItemCount = sample.filter((item) => {
    if (!item || typeof item !== "object") return true;

    const maybeItem = item as Record<string, unknown>;

    return (
      typeof maybeItem.time !== "number" ||
      typeof maybeItem.velocity !== "number" ||
      typeof maybeItem.instrument !== "string"
    );
  }).length;

  return {
    checkedCount: sample.length,
    invalidItemCount,
  };
}

function resolveExternalResultFileEntry(
  fileName: ExternalResultFileName
): ResolvedExternalResultFileEntry {
  const fileEntry: ExternalResultFileEntry = EXTERNAL_RESULT_FILES[fileName];

  return {
    format: fileEntry.format,
    content: getExternalResultFileContent(fileName),
  };
}

function buildPipelineInputFromExternalResultFile(
  fileName: ExternalResultFileName
): PipelineInput {
  const fileEntry: ExternalResultFileEntry = EXTERNAL_RESULT_FILES[fileName];
  const resolvedFileEntry = resolveExternalResultFileEntry(fileName);
  const fileValidation = validateExternalResultFileEntry(resolvedFileEntry);

  console.log("[RESULT-FILE] validation", fileValidation);

  if (!fileValidation.isValid) {
    return buildPipelineInputFromExternalInitialEvents([]);
  }

  if (fileEntry.format === "external_transcription_results") {
    return buildPipelineInputFromExternalTranscriptionSample(fileEntry.sampleName);
  }

  return buildPipelineInputFromExternalInitialEvents(
    getActiveExternalInitialEvents(fileEntry.sampleName)
  );
}

function isValidAudioVideoSourceKind(
  kind: unknown
): kind is "audio_file" | "video_file" {
  return kind === "audio_file" || kind === "video_file";
}

function isValidAudioVideoTranscriptionFormat(
  format: unknown
): format is "external_transcription_results" {
  return format === "external_transcription_results";
}

function validateAudioVideoSourceResult(result: unknown) {
  if (!result || typeof result !== "object") {
    return {
      isValid: false,
      reason: "source result is not an object",
      sourceKind: null,
      transcriptionFormat: null,
      transcriptionCount: 0,
    };
  }

  const maybeResult = result as {
    sourceName?: unknown;
    sourceKind?: unknown;
    transcriptionFormat?: unknown;
    transcriptionContent?: unknown;
  };

  if (
    typeof maybeResult.sourceName !== "string" ||
    maybeResult.sourceName.length === 0
  ) {
    return {
      isValid: false,
      reason: "invalid source name",
      sourceKind: null,
      transcriptionFormat: null,
      transcriptionCount: 0,
    };
  }

  if (!isValidAudioVideoSourceKind(maybeResult.sourceKind)) {
    return {
      isValid: false,
      reason: "invalid source kind",
      sourceKind: maybeResult.sourceKind ?? null,
      transcriptionFormat: null,
      transcriptionCount: 0,
    };
  }

  if (!isValidAudioVideoTranscriptionFormat(maybeResult.transcriptionFormat)) {
    return {
      isValid: false,
      reason: "invalid transcription format",
      sourceKind: maybeResult.sourceKind,
      transcriptionFormat: maybeResult.transcriptionFormat ?? null,
      transcriptionCount: 0,
    };
  }

  if (!Array.isArray(maybeResult.transcriptionContent)) {
    return {
      isValid: false,
      reason: "transcription content is not an array",
      sourceKind: maybeResult.sourceKind,
      transcriptionFormat: maybeResult.transcriptionFormat,
      transcriptionCount: 0,
    };
  }

  return {
    isValid: true,
    reason: null,
    sourceKind: maybeResult.sourceKind,
    transcriptionFormat: maybeResult.transcriptionFormat,
    transcriptionCount: maybeResult.transcriptionContent.length,
  };
}

function validateAudioVideoTranscriptionContentSample(
  result: AudioVideoSourceResult
) {
  const sample = result.transcriptionContent.slice(0, 10);

  const invalidItemCount = sample.filter((item) => {
    if (!item || typeof item !== "object") return true;

    const maybeItem = item as Record<string, unknown>;

    return (
      typeof maybeItem.time !== "number" ||
      typeof maybeItem.velocity !== "number" ||
      typeof maybeItem.instrument !== "string"
    );
  }).length;

  return {
    checkedCount: sample.length,
    invalidItemCount,
  };
}

function validateAudioVideoResultFileContentSample(
  fileEntry: AudioVideoResultFileEntry
) {
  const content = fileEntry.content;
  const sample = content.transcriptionContent.slice(0, 10);

  const invalidItemCount = sample.filter((item) => {
    if (!item || typeof item !== "object") return true;

    const maybeItem = item as Record<string, unknown>;

    return (
      typeof maybeItem.time !== "number" ||
      typeof maybeItem.velocity !== "number" ||
      typeof maybeItem.instrument !== "string"
    );
  }).length;

  return {
    checkedCount: sample.length,
    invalidItemCount,
  };
}

function isValidAudioVideoResultFileFormat(
  format: unknown
): format is "audio_video_source_result" {
  return format === "audio_video_source_result";
}

function validateAudioVideoResultFileEntry(fileEntry: unknown) {
  if (!fileEntry || typeof fileEntry !== "object") {
    return {
      isValid: false,
      reason: "file entry is not an object",
      format: null,
      hasContent: false,
    };
  }

  const maybeEntry = fileEntry as {
    format?: unknown;
    content?: unknown;
  };

  if (!isValidAudioVideoResultFileFormat(maybeEntry.format)) {
    return {
      isValid: false,
      reason: "invalid audio-video file format",
      format: maybeEntry.format ?? null,
      hasContent: false,
    };
  }

  if (!maybeEntry.content || typeof maybeEntry.content !== "object") {
    return {
      isValid: false,
      reason: "missing file content object",
      format: maybeEntry.format,
      hasContent: false,
    };
  }

  return {
    isValid: true,
    reason: null,
    format: maybeEntry.format,
    hasContent: true,
  };
}

function summarizeUnknownLikeEvents(
  events: Array<{ instrument: string; articulation: string; stepIndex?: number }>
) {
  const unknownEvents = events.filter(
    (event) =>
      event.instrument === "UNMAPPED" || event.articulation === "unknown"
  );

  return {
    totalUnknownLikeCount: unknownEvents.length,
    instrumentCounts: unknownEvents.reduce((acc, event) => {
      acc[event.instrument] = (acc[event.instrument] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    articulationCounts: unknownEvents.reduce((acc, event) => {
      acc[event.articulation] = (acc[event.articulation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}

function buildV1PipelineContractSummary(params: {
  inputCount: number;
  finalCount: number;
  hasUnknownInput: boolean;
  hasUnknownFinal: boolean;
  hasKick: boolean;
  hasSnare: boolean;
  hasHiHat: boolean;
  hasCrash: boolean;
  hasRide: boolean;
}) {
  return {
    version: "v1",
    supportsInitialDrumEvents: true,
    preservesKnownCoreVoices: params.hasKick && params.hasSnare,
    supportsHiHatFamily: params.hasHiHat,
    supportsCrash: params.hasCrash,
    supportsRide: params.hasRide,
    acceptsUnknownInput: params.hasUnknownInput,
    unknownMaySurviveToFinal: params.hasUnknownFinal,
    pipelineProducesNonEmptyOutput: params.finalCount > 0,
    inputCount: params.inputCount,
    finalCount: params.finalCount,
  };
}

function buildV1DeliveryBoundarySummary(params: {
  hasKick: boolean;
  hasSnare: boolean;
  hasHiHat: boolean;
  hasCrash: boolean;
  hasRide: boolean;
  hasUnknownInput: boolean;
  hasUnknownFinal: boolean;
  outputStable: boolean;
}) {
  return {
    version: "v1",
    supportedInputs: [
      "InitialDrumEvent[]",
      "audio_video_source_result",
      "audio_video_result_file",
    ],
    stableCoreVoices: {
      kick: params.hasKick,
      snare: params.hasSnare,
      hihat: params.hasHiHat,
      crash: params.hasCrash,
      ride: params.hasRide,
    },
    acceptedCurrentBehavior: {
      acceptsUnknownInput: params.hasUnknownInput,
      mayRetainUnknownToFinal: params.hasUnknownFinal,
      producesStableOutput: params.outputStable,
    },
    notHandledInV1: [
      "automatic unknown cleanup",
      "semantic remapping of unknown hits",
      "advanced transcription repair",
      "real upload parsing UI",
    ],
  };
}

const V1_NOTATION_LANE_ORDER = [
  "CR",
  "RD",
  "HH",
  "HH_PEDAL",
  "TM_HIGH",
  "SD",
  "TM_MID",
  "TM_FLOOR",
  "BD",
] as const;

function getV1NotationLane(instrument: string, articulation: string) {
  if (instrument === "CR") return "CR";
  if (instrument === "RD") return "RD";
  if (instrument === "HH" && articulation === "pedal") return "HH_PEDAL";
  if (instrument === "HH") return "HH";
  if (instrument === "TM_HIGH") return "TM_HIGH";
  if (instrument === "SD") return "SD";
  if (instrument === "TM_MID") return "TM_MID";
  if (instrument === "TM_FLOOR") return "TM_FLOOR";
  if (instrument === "BD") return "BD";
  return "UNASSIGNED";
}

function getV1NotationMarking(instrument: string, articulation: string) {
  if (instrument === "HH" && articulation === "open") {
    return { notehead: "x", marker: "open" };
  }
  if (instrument === "HH" && articulation === "pedal") {
    return { notehead: "x", marker: "pedal" };
  }
  if (instrument === "HH") {
    return { notehead: "x", marker: "closed" };
  }
  if (instrument === "CR") {
    return { notehead: "x", marker: "crash" };
  }
  if (instrument === "RD") {
    return { notehead: "x", marker: "ride" };
  }
  if (instrument === "SD" && articulation === "ghost") {
    return { notehead: "normal", marker: "ghost" };
  }
  if (instrument === "SD") {
    return { notehead: "normal", marker: "normal" };
  }
  if (instrument === "BD") {
    return { notehead: "normal", marker: "normal" };
  }
  if (
    instrument === "TM_HIGH" ||
    instrument === "TM_MID" ||
    instrument === "TM_FLOOR"
  ) {
    return { notehead: "normal", marker: "normal" };
  }
  return { notehead: "normal", marker: "unassigned" };
}

function buildV1NotationFoundationSummary(
  events: Array<{ instrument: string; articulation: string }>
) {
  const laneCounts: Record<string, number> = {};
  const noteheadCounts: Record<string, number> = {};
  const markerCounts: Record<string, number> = {};

  for (const event of events) {
    const lane = getV1NotationLane(event.instrument, event.articulation);
    const marking = getV1NotationMarking(event.instrument, event.articulation);

    laneCounts[lane] = (laneCounts[lane] || 0) + 1;
    noteheadCounts[marking.notehead] = (noteheadCounts[marking.notehead] || 0) + 1;
    markerCounts[marking.marker] = (markerCounts[marking.marker] || 0) + 1;
  }

  return {
    laneOrder: V1_NOTATION_LANE_ORDER,
    laneCounts,
    noteheadCounts,
    markerCounts,
  };
}

function buildV1NotationSameStepLaneCombos(
  steps: Array<{ stepIndex: number; instruments: string[] }>
) {
  let bdHhCount = 0;
  let sdHhCount = 0;
  let bdCrCount = 0;
  let sdCrCount = 0;
  let bdRdCount = 0;
  let sdRdCount = 0;

  const comboSamples: Array<{ stepIndex: number; lanes: string[] }> = [];

  for (const step of steps) {
    const laneSet = new Set(
      step.instruments.map((instrument) => getV1NotationLane(instrument, "normal"))
    );

    const lanes = Array.from(laneSet);

    if (laneSet.has("BD") && laneSet.has("HH")) bdHhCount += 1;
    if (laneSet.has("SD") && laneSet.has("HH")) sdHhCount += 1;
    if (laneSet.has("BD") && laneSet.has("CR")) bdCrCount += 1;
    if (laneSet.has("SD") && laneSet.has("CR")) sdCrCount += 1;
    if (laneSet.has("BD") && laneSet.has("RD")) bdRdCount += 1;
    if (laneSet.has("SD") && laneSet.has("RD")) sdRdCount += 1;

    if (lanes.length >= 2 && comboSamples.length < 12) {
      comboSamples.push({
        stepIndex: step.stepIndex,
        lanes,
      });
    }
  }

  return {
    bdHhCount,
    sdHhCount,
    bdCrCount,
    sdCrCount,
    bdRdCount,
    sdRdCount,
    comboSamples,
  };
}

function buildV1NotationFoundationReadiness(params: {
  events: Array<{ instrument: string; articulation: string }>;
  foundationSummary: {
    laneCounts: Record<string, number>;
    noteheadCounts: Record<string, number>;
    markerCounts: Record<string, number>;
  };
  sameStepCombos: {
    bdHhCount: number;
    sdHhCount: number;
    bdCrCount: number;
    sdCrCount: number;
    bdRdCount: number;
    sdRdCount: number;
  };
}) {
  const { events, foundationSummary, sameStepCombos } = params;

  const hasCrashLane = events.some(
    (event) => getV1NotationLane(event.instrument, event.articulation) === "CR"
  );
  const hasRideLane = events.some(
    (event) => getV1NotationLane(event.instrument, event.articulation) === "RD"
  );
  const hasHiHatLane = events.some(
    (event) => getV1NotationLane(event.instrument, event.articulation) === "HH"
  );
  const hasSnareLane = events.some(
    (event) => getV1NotationLane(event.instrument, event.articulation) === "SD"
  );
  const hasBassDrumLane = events.some(
    (event) => getV1NotationLane(event.instrument, event.articulation) === "BD"
  );

  const supportsMultipleNoteheadTypes =
    Object.keys(foundationSummary.noteheadCounts).length >= 2;

  const supportsMarkerSeparation =
    Object.keys(foundationSummary.markerCounts).length >= 2;

  const hasCoreSameStepSupport =
    sameStepCombos.bdHhCount > 0 ||
    sameStepCombos.sdHhCount > 0 ||
    sameStepCombos.bdCrCount > 0 ||
    sameStepCombos.sdCrCount > 0 ||
    sameStepCombos.bdRdCount > 0 ||
    sameStepCombos.sdRdCount > 0;

  return {
    hasCrashLane,
    hasRideLane,
    hasHiHatLane,
    hasSnareLane,
    hasBassDrumLane,
    supportsMultipleNoteheadTypes,
    supportsMarkerSeparation,
    hasCoreSameStepSupport,
  };
}

function buildV1ArticulationSupportSummary(
  events: Array<{ instrument: string; articulation: string }>
) {
  let hhClosedCount = 0;
  let hhOpenCount = 0;
  let hhPedalCount = 0;
  let sdNormalCount = 0;
  let sdGhostCount = 0;

  for (const event of events) {
    if (event.instrument === "HH" && event.articulation === "closed") hhClosedCount += 1;
    if (event.instrument === "HH" && event.articulation === "open") hhOpenCount += 1;
    if (event.instrument === "HH" && event.articulation === "pedal") hhPedalCount += 1;
    if (event.instrument === "SD" && event.articulation === "normal") sdNormalCount += 1;
    if (event.instrument === "SD" && event.articulation === "ghost") sdGhostCount += 1;
  }

  return {
    hhClosedCount,
    hhOpenCount,
    hhPedalCount,
    sdNormalCount,
    sdGhostCount,
  };
}

function buildV1ArticulationReadiness(summary: {
  hhClosedCount: number;
  hhOpenCount: number;
  hhPedalCount: number;
  sdNormalCount: number;
  sdGhostCount: number;
}) {
  return {
    hasHiHatClosed: summary.hhClosedCount > 0,
    hasHiHatOpen: summary.hhOpenCount > 0,
    hasHiHatPedal: summary.hhPedalCount > 0,
    hasSnareNormal: summary.sdNormalCount > 0,
    hasSnareGhost: summary.sdGhostCount > 0,
    supportsHiHatArticulationFamily:
      summary.hhClosedCount > 0 || summary.hhOpenCount > 0 || summary.hhPedalCount > 0,
    supportsSnareArticulationFamily:
      summary.sdNormalCount > 0 || summary.sdGhostCount > 0,
  };
}

type FakeNotationPreviewLaneId =
  | "CR"
  | "RD"
  | "HH"
  | "HH_PEDAL"
  | "TM_HIGH"
  | "SD"
  | "TM_MID"
  | "TM_FLOOR"
  | "BD";

type FakeNotationPreviewEvent = {
  stepIndex: number;
  instrument: InitialDrumInstrument;
  articulation: InitialDrumArticulation;
};

type FakeNotationPreviewSection = {
  id: string;
  title: string;
  description: string;
  events: FakeNotationPreviewEvent[];
};

const FAKE_NOTATION_PREVIEW_STEP_COUNT = 32;

const FAKE_NOTATION_PREVIEW_LANES: Array<{
  id: FakeNotationPreviewLaneId;
  label: string;
}> = [
  { id: "CR", label: "Crash" },
  { id: "RD", label: "Ride" },
  { id: "HH", label: "HH" },
  { id: "HH_PEDAL", label: "HH Pedal" },
  { id: "TM_HIGH", label: "Tom High" },
  { id: "SD", label: "Snare" },
  { id: "TM_MID", label: "Tom Mid" },
  { id: "TM_FLOOR", label: "Tom Floor" },
  { id: "BD", label: "BD" },
];

function buildFakeNotationPreviewEvents(
  entries: Array<{
    instrument: InitialDrumInstrument;
    articulation: InitialDrumArticulation;
    steps: number[];
  }>
) {
  return entries.flatMap((entry) =>
    entry.steps.map((stepIndex) => ({
      stepIndex,
      instrument: entry.instrument,
      articulation: entry.articulation,
    }))
  );
}

const FAKE_NOTATION_PREVIEW_CANVAS_HEIGHT = 224;

const FAKE_NOTATION_PREVIEW_STAFF_LINE_POSITIONS = [56, 80, 104, 128, 152] as const;

const FAKE_NOTATION_PREVIEW_LANE_POSITIONS: Record<FakeNotationPreviewLaneId, number> = {
  CR: 18,
  RD: 38,
  HH: 56,
  HH_PEDAL: 176,
  TM_HIGH: 80,
  SD: 104,
  TM_MID: 128,
  TM_FLOOR: 152,
  BD: 198,
};

const FAKE_NOTATION_PREVIEW_KIT_HINT_ITEMS: Array<{
  id: FakeNotationPreviewLaneId;
  label: string;
  left: string;
  top: string;
}> = [
  { id: "CR", label: "Crash", left: "18%", top: "14%" },
  { id: "HH", label: "HH", left: "34%", top: "20%" },
  { id: "RD", label: "Ride", left: "70%", top: "16%" },
  { id: "HH_PEDAL", label: "Ped", left: "18%", top: "72%" },
  { id: "TM_HIGH", label: "T1", left: "60%", top: "38%" },
  { id: "SD", label: "SD", left: "42%", top: "50%" },
  { id: "TM_MID", label: "T2", left: "68%", top: "56%" },
  { id: "TM_FLOOR", label: "FT", left: "78%", top: "74%" },
  { id: "BD", label: "BD", left: "48%", top: "82%" },
];

function getFakeNotationPreviewTone(lane: FakeNotationPreviewLaneId) {
  switch (lane) {
    case "CR":
      return {
        ink: "#92400e",
        accent: "#f59e0b",
        soft: "rgba(245, 158, 11, 0.18)",
        glow: "rgba(251, 191, 36, 0.24)",
      };
    case "RD":
      return {
        ink: "#4c1d95",
        accent: "#8b5cf6",
        soft: "rgba(139, 92, 246, 0.16)",
        glow: "rgba(196, 181, 253, 0.24)",
      };
    case "HH":
    case "HH_PEDAL":
      return {
        ink: "#1e3a8a",
        accent: "#38bdf8",
        soft: "rgba(56, 189, 248, 0.14)",
        glow: "rgba(125, 211, 252, 0.22)",
      };
    case "SD":
      return {
        ink: "#7c2d12",
        accent: "#fb923c",
        soft: "rgba(251, 146, 60, 0.14)",
        glow: "rgba(253, 186, 116, 0.2)",
      };
    case "BD":
      return {
        ink: "#166534",
        accent: "#22c55e",
        soft: "rgba(34, 197, 94, 0.14)",
        glow: "rgba(134, 239, 172, 0.22)",
      };
    case "TM_HIGH":
    case "TM_MID":
    case "TM_FLOOR":
      return {
        ink: "#9f1239",
        accent: "#f43f5e",
        soft: "rgba(244, 63, 94, 0.12)",
        glow: "rgba(253, 164, 175, 0.2)",
      };
    default:
      return {
        ink: "#334155",
        accent: "#94a3b8",
        soft: "rgba(148, 163, 184, 0.12)",
        glow: "rgba(148, 163, 184, 0.18)",
      };
  }
}

function getFakeNotationPreviewVisualTop(lane: FakeNotationPreviewLaneId) {
  return FAKE_NOTATION_PREVIEW_LANE_POSITIONS[lane];
}

function getFakeNotationPreviewStepLeftPercent(stepIndex: number) {
  return ((stepIndex + 0.5) / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100;
}

const FAKE_NOTATION_PREVIEW_SECTIONS: FakeNotationPreviewSection[] = [
  {
    id: "basic_groove",
    title: "Basic Groove",
    description: "Closed hi-hat pulse with a minimal backbeat and bass drum anchor.",
    events: buildFakeNotationPreviewEvents([
      { instrument: "HH", articulation: "closed", steps: [0, 4, 8, 12, 16, 20, 24, 28] },
      { instrument: "SD", articulation: "normal", steps: [8, 24] },
      { instrument: "BD", articulation: "normal", steps: [0, 16] },
    ]),
  },
  {
    id: "hi_hat_articulation",
    title: "Hi-Hat Articulation",
    description: "One-bar groove showing closed, open, and pedal hi-hat behavior.",
    events: buildFakeNotationPreviewEvents([
      { instrument: "HH", articulation: "closed", steps: [0, 4, 8] },
      { instrument: "HH", articulation: "open", steps: [12] },
      { instrument: "HH", articulation: "pedal", steps: [20] },
      { instrument: "SD", articulation: "normal", steps: [8, 24] },
      { instrument: "BD", articulation: "normal", steps: [0, 16] },
    ]),
  },
  {
    id: "ride_crash_switch",
    title: "Ride / Crash Switch",
    description: "Opening crash into a ride-led groove without changing the backbeat.",
    events: buildFakeNotationPreviewEvents([
      { instrument: "CR", articulation: "normal", steps: [0] },
      { instrument: "RD", articulation: "normal", steps: [4, 8, 12, 16, 20, 24, 28] },
      { instrument: "SD", articulation: "normal", steps: [8, 24] },
      { instrument: "BD", articulation: "normal", steps: [0, 16] },
    ]),
  },
  {
    id: "simple_fill",
    title: "Simple Fill",
    description: "Basic groove that opens into a short tom fill before the bar resolves.",
    events: buildFakeNotationPreviewEvents([
      { instrument: "HH", articulation: "closed", steps: [0, 4, 8, 12] },
      { instrument: "SD", articulation: "normal", steps: [8] },
      { instrument: "BD", articulation: "normal", steps: [0] },
      { instrument: "TM_HIGH", articulation: "normal", steps: [20] },
      { instrument: "TM_MID", articulation: "normal", steps: [24] },
      { instrument: "TM_FLOOR", articulation: "normal", steps: [28] },
      { instrument: "CR", articulation: "normal", steps: [0] },
    ]),
  },
];

function buildPipelineInputFromAudioVideoSourceResultObject(
  result: AudioVideoSourceResult
): PipelineInput {
  const sourceValidation = validateAudioVideoSourceResult(result);

  console.log("[AV-FILE] source validation", sourceValidation);

  if (!sourceValidation.isValid) {
    return buildPipelineInputFromExternalInitialEvents([]);
  }

  const initialEvents = buildInitialEventsFromExternalTranscriptionHits(
    result.transcriptionContent.map((hit) => ({
      time: hit.time,
      instrument: hit.instrument,
      velocity: hit.velocity,
    }))
  );

  return buildPipelineInputFromExternalInitialEvents(initialEvents);
}

function buildPipelineInputFromAudioVideoSourceResult(
  resultName: AudioVideoSourceResultName
): PipelineInput {
  const result = AUDIO_VIDEO_SOURCE_RESULTS[resultName];
  const normalizedResult: AudioVideoSourceResult = {
    sourceName: result.sourceName,
    sourceKind: result.sourceKind,
    transcriptionFormat: result.transcriptionFormat,
    transcriptionContent: result.transcriptionContent.map((hit) => ({
      time: hit.time,
      instrument: hit.instrument,
      velocity: hit.velocity,
    })),
  };

  return buildPipelineInputFromAudioVideoSourceResultObject(normalizedResult);
}

function buildPipelineInputFromAudioVideoResultFile(
  fileName: AudioVideoResultFileName
): PipelineInput {
  const fileEntry: AudioVideoResultFileEntry = AUDIO_VIDEO_RESULT_FILES[fileName];
  const fileValidation = validateAudioVideoResultFileEntry(fileEntry);

  console.log("[AV-FILE] validation", fileValidation);

  if (!fileValidation.isValid) {
    return buildPipelineInputFromExternalInitialEvents([]);
  }

  return buildPipelineInputFromAudioVideoSourceResultObject(fileEntry.content);
}

function buildAudioVideoSourceKindCoverageCheck(
  sourceKind: AudioVideoSourceResult["sourceKind"]
) {
  return {
    isAudioFile: sourceKind === "audio_file",
    isVideoFile: sourceKind === "video_file",
  };
}

function getExternalResultFileContent(
  fileName: ExternalResultFileName
): ExternalResultFileContentItem[] {
  const fileEntry: ExternalResultFileEntry = EXTERNAL_RESULT_FILES[fileName];

  if (fileEntry.format === "external_transcription_results") {
    return EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES[fileEntry.sampleName].map((hit) => ({
      time: hit.time,
      instrument: hit.instrument,
      velocity: hit.velocity,
    }));
  }

  return EXTERNAL_INITIAL_EVENT_SAMPLES[fileEntry.sampleName].map((event) => ({
    time: event.time,
    instrument: event.instrument,
    articulation: event.articulation,
    velocity: event.velocity,
  }));
}

function buildActiveInputModeSummary(params: {
  mode: InputMode;
  activeMidiTestFile: string;
  activeExternalSample: string;
  activeTranscriptionSample: string;
  activeExternalResultFile: string;
  activeAudioVideoSourceResult: string;
  activeAudioVideoResultFile: string;
}): ActiveInputModeSummary {
  return {
    mode: params.mode,
    midiTestFile: params.mode === "midi_test" ? params.activeMidiTestFile : null,
    externalInitialSample:
      params.mode === "external_initial_events" ? params.activeExternalSample : null,
    externalTranscriptionSample:
      params.mode === "external_transcription_results"
        ? params.activeTranscriptionSample
        : null,
    externalResultFile:
      params.mode === "external_result_file" ? params.activeExternalResultFile : null,
    audioVideoSourceResult:
      params.mode === "audio_video_source_result"
        ? params.activeAudioVideoSourceResult
        : null,
    audioVideoResultFile:
      params.mode === "audio_video_result_file"
        ? params.activeAudioVideoResultFile
        : null,
  };
}

function buildPipelineInputFromActiveMode(params: {
  mode: InputMode;
  midiNotes: Array<{ midi: number; time: number; velocity: number }>;
  activeExternalSample: ExternalInitialSampleName;
  activeTranscriptionSample: ExternalTranscriptionSampleName;
  activeExternalResultFile: ExternalResultFileName;
  activeAudioVideoSourceResult: AudioVideoSourceResultName;
  activeAudioVideoResultFile: AudioVideoResultFileName;
}): PipelineInput {
  if (params.mode === "midi_test") {
    return {
      sourceType: "midi_test",
      midiNotes: params.midiNotes,
    };
  }

  if (params.mode === "external_initial_events") {
    return buildPipelineInputFromExternalInitialEvents(
      getActiveExternalInitialEvents(params.activeExternalSample)
    );
  }

  if (params.mode === "external_transcription_results") {
    return buildPipelineInputFromExternalTranscriptionSample(
      params.activeTranscriptionSample
    );
  }

  if (params.mode === "external_result_file") {
    return buildPipelineInputFromExternalResultFile(params.activeExternalResultFile);
  }

  if (params.mode === "audio_video_source_result") {
    return buildPipelineInputFromAudioVideoSourceResult(
      params.activeAudioVideoSourceResult
    );
  }

  return buildPipelineInputFromAudioVideoResultFile(
    params.activeAudioVideoResultFile
  );
}

void buildPipelineInputFromExternalInitialEvents;

export default function App() {
  const ScoreViewWithMidiDebug = ScoreView as any;

  const [selectedTrackType, setSelectedTrackType] = useState<TrackTypeId>("original");

  const currentTrackType = PRACTICE_CONTENT.trackTypes[selectedTrackType];
  const parsed = useMemo(
    () =>
      normalizeDrumData(
        extendDrumDataToBars(
          PRACTICE_CONTENT.scoreData,
          TARGET_TEST_BAR_COUNT,
          DEFAULT_BEATS_PER_BAR
        )
      ),
    []
  );
  const bpm = parsed.bpm;
  const duration = parsed.duration;
  const events = parsed.events;

  const beatsPerBar = DEFAULT_BEATS_PER_BAR;
  const stepsPerBeat = 4;
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const totalSteps = Math.ceil(duration / stepDuration);
  const barSteps = beatsPerBar * stepsPerBeat;
  const bars = Math.ceil(totalSteps / barSteps);

  const stepMap = useMemo(
    () => buildStepMap(events, totalSteps, stepDuration),
    [events, totalSteps, stepDuration]
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const scrubBarRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingRef = useRef(false);
  const resumePlaybackAfterScrubRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const countInIntervalRef = useRef<number | null>(null);
  const countInStartTimeoutRef = useRef<number | null>(null);
  const pendingSourceSwitchRef = useRef<{ time: number; shouldResume: boolean } | null>(null);
  const trackSwitchInProgressRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [scrubDragTime, setScrubDragTime] = useState<number | null>(null);
  const [trackSwitchDisplayTime, setTrackSwitchDisplayTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countInActive, setCountInActive] = useState(false);
  const [countInBeat, setCountInBeat] = useState(1);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [importedAudioUrl, setImportedAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);

  const [mode, setMode] = useState<EditMode>(null);

  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);

  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.9);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [viewMode, setViewMode] = useState<"raw" | "practice">("practice");
  const [midiDrumEvents, setMidiDrumEvents] = useState<V3TempDrumEvent[]>([]);
  const finalScoreEvents = midiDrumEvents;
  // V3 locked: score-language layer only
  const notesByStep = useMemo<V3StepNoteGroup[]>(() => {
    const grouped = new Map<number, V3TempDrumEvent[]>();

    for (const note of finalScoreEvents) {
      const stepNotes = grouped.get(note.stepIndex);
      if (stepNotes) {
        stepNotes.push(note);
      } else {
        grouped.set(note.stepIndex, [note]);
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([stepIndex, notes]) => ({
        stepIndex,
        notes,
      }));
  }, [finalScoreEvents]);

  const notesByStepCheck = useMemo(
    () =>
      notesByStep.slice(0, 16).map((group) => ({
        stepIndex: group.stepIndex,
        count: group.notes.length,
        inst: group.notes.map((n) => n.instrument),
      })),
    [notesByStep]
  );

  const notationStepSample = useMemo(
    () =>
      notesByStep.slice(0, 20).map((group) => ({
        stepIndex: group.stepIndex,
        instruments: group.notes.map((n) => `${n.instrument}:${n.articulation}`),
        count: group.notes.length,
      })),
    [notesByStep]
  );

  const notationMultiHitSample = useMemo(
    () =>
      notesByStep
        .filter((group) => group.notes.length > 1)
        .slice(0, 20)
        .map((group) => ({
          stepIndex: group.stepIndex,
          instruments: group.notes.map((n) => `${n.instrument}:${n.articulation}`),
        })),
    [notesByStep]
  );

  const v1NotationFoundationSummary = useMemo(
    () => buildV1NotationFoundationSummary(finalScoreEvents),
    [finalScoreEvents]
  );

  const v1NotationSameStepLaneCombos = useMemo(
    () =>
      buildV1NotationSameStepLaneCombos(
        notesByStep.map((step) => ({
          stepIndex: step.stepIndex,
          instruments: step.notes.map((note) => note.instrument),
        }))
      ),
    [notesByStep]
  );

  const v1NotationFoundationReadiness = useMemo(
    () =>
      buildV1NotationFoundationReadiness({
        events: finalScoreEvents,
        foundationSummary: v1NotationFoundationSummary,
        sameStepCombos: v1NotationSameStepLaneCombos,
      }),
    [finalScoreEvents, v1NotationFoundationSummary, v1NotationSameStepLaneCombos]
  );

  const v1ArticulationSupportSummary = useMemo(
    () => buildV1ArticulationSupportSummary(finalScoreEvents),
    [finalScoreEvents]
  );

  const v1ArticulationReadiness = useMemo(
    () => buildV1ArticulationReadiness(v1ArticulationSupportSummary),
    [v1ArticulationSupportSummary]
  );

  useEffect(() => {
    console.log("[OUTPUT] notesByStep sample", notesByStepCheck);
  }, [notesByStepCheck]);

  useEffect(() => {
    console.log("[NOTATION] step sample", notationStepSample);
  }, [notationStepSample]);

  useEffect(() => {
    console.log("[NOTATION] multi-hit step sample", notationMultiHitSample);
  }, [notationMultiHitSample]);

  useEffect(() => {
    console.log("[NOTATION-FOUNDATION] same-step lane combos", {
      bdHhCount: v1NotationSameStepLaneCombos.bdHhCount,
      sdHhCount: v1NotationSameStepLaneCombos.sdHhCount,
      bdCrCount: v1NotationSameStepLaneCombos.bdCrCount,
      sdCrCount: v1NotationSameStepLaneCombos.sdCrCount,
      bdRdCount: v1NotationSameStepLaneCombos.bdRdCount,
      sdRdCount: v1NotationSameStepLaneCombos.sdRdCount,
    });

    console.log(
      "[NOTATION-FOUNDATION] same-step lane combo sample",
      v1NotationSameStepLaneCombos.comboSamples
    );
  }, [v1NotationSameStepLaneCombos]);

  useEffect(() => {
    if (finalScoreEvents.length === 0) {
      return;
    }

    console.log(
      "[NOTATION-FOUNDATION] v1 readiness",
      v1NotationFoundationReadiness
    );

    console.log("[NOTATION-FOUNDATION] module 1 conclusion", {
      laneOrderFixed: true,
      markingRulesFixed: true,
      sameStepLaneCombosObserved:
        v1NotationFoundationReadiness.hasCoreSameStepSupport,
      readyToEnterModule2:
        v1NotationFoundationReadiness.hasSnareLane &&
        v1NotationFoundationReadiness.hasBassDrumLane &&
        v1NotationFoundationReadiness.supportsMultipleNoteheadTypes,
    });
  }, [finalScoreEvents, v1NotationFoundationReadiness]);

  useEffect(() => {
    if (finalScoreEvents.length === 0) {
      return;
    }

    console.log(
      "[ARTICULATION] support summary",
      v1ArticulationSupportSummary
    );

    console.log("[ARTICULATION] readiness", v1ArticulationReadiness);

    console.log("[ARTICULATION] module 2A conclusion", {
      hiHatFamilyObserved:
        v1ArticulationReadiness.supportsHiHatArticulationFamily,
      snareFamilyObserved:
        v1ArticulationReadiness.supportsSnareArticulationFamily,
      currentSampleHasOpenHiHat: v1ArticulationReadiness.hasHiHatOpen,
      currentSampleHasPedalHiHat: v1ArticulationReadiness.hasHiHatPedal,
      currentSampleHasGhostSnare: v1ArticulationReadiness.hasSnareGhost,
    });
  }, [finalScoreEvents, v1ArticulationReadiness, v1ArticulationSupportSummary]);

  console.log("[V5] notesByStep", notesByStep.slice(0, 10));

  const midiStepMap = useMemo(() => {
    const map: Record<TrackName, Set<number>> = {
      HH: new Set<number>(),
      SD: new Set<number>(),
      BD: new Set<number>(),
    };

    for (const event of finalScoreEvents) {
      let track: TrackName | null = null;

      if (event.instrument === "HH") track = "HH";
      if (event.instrument === "SD") track = "SD";
      if (event.instrument === "BD") track = "BD";
      if (!track) continue;

      const step = Math.round(event.time / stepDuration);
      if (step >= 0 && step < totalSteps) {
        map[track].add(step);
      }
    }

    return map;
  }, [finalScoreEvents, stepDuration, totalSteps]);

  const MIDI_TEST_FILES = [
    "test_basic.mid",
    "080 Half-Time Pop Ride.mid",
    "135 Motown Beat Ride.mid",
    "135 Motown Beat Hat.mid",
    "080 Ride (old).mid",
  ] as const;

  // 依次验证：
  // 0 = test_basic.mid
  // 1 = 080 Half-Time Pop Ride.mid
  // 2 = 135 Motown Beat Ride.mid
  // 3 = 135 Motown Beat Hat.mid
  // 4 = 080 Ride (old).mid
  const ACTIVE_MIDI_TEST_INDEX = 2;
  // 可选：
  // "midi_test"
  // "external_initial_events"
  // "external_transcription_results"
  // "external_result_file"
  // "audio_video_source_result"
  // "audio_video_result_file"
  const ACTIVE_INPUT_MODE: InputMode = "audio_video_result_file";
  // 可选：
  // "basic_groove"
  // "ride_groove"
  const ACTIVE_EXTERNAL_SAMPLE: ExternalInitialSampleName = "ride_groove";
  // 可选：
  // "basic_transcription"
  // "ride_transcription"
  const ACTIVE_TRANSCRIPTION_SAMPLE: ExternalTranscriptionSampleName = "ride_transcription";
  // 可选：
  // "transcription_file_demo"
  // "initial_events_file_demo"
  const ACTIVE_EXTERNAL_RESULT_FILE: ExternalResultFileName = "transcription_file_demo";
  // 可选：
  // "demo_audio_result"
  // "demo_video_result"
  const ACTIVE_AUDIO_VIDEO_SOURCE_RESULT: AudioVideoSourceResultName =
    "demo_video_result";
  // 可选：
  // "demo_audio_file_result"
  // "demo_video_file_result"
  // "demo_video_file_result_loose"
  const ACTIVE_AUDIO_VIDEO_RESULT_FILE: AudioVideoResultFileName =
    "demo_video_file_result_loose";
  const activeMidiTestFile = MIDI_TEST_FILES[ACTIVE_MIDI_TEST_INDEX];

  useEffect(() => {
    let cancelled = false;

    const loadMidiPreview = async () => {
      const activeInputModeSummary = buildActiveInputModeSummary({
        mode: ACTIVE_INPUT_MODE,
        activeMidiTestFile,
        activeExternalSample: ACTIVE_EXTERNAL_SAMPLE,
        activeTranscriptionSample: ACTIVE_TRANSCRIPTION_SAMPLE,
        activeExternalResultFile: ACTIVE_EXTERNAL_RESULT_FILE,
        activeAudioVideoSourceResult: ACTIVE_AUDIO_VIDEO_SOURCE_RESULT,
        activeAudioVideoResultFile: ACTIVE_AUDIO_VIDEO_RESULT_FILE,
      });

      console.log("[V4] loadMidiPreview START");
      console.log("[V5] test file:", activeMidiTestFile);
      console.log("[MAP-TEST] current midi file", activeMidiTestFile);
      console.log("[FLOW-TEST] active midi file", activeMidiTestFile);
      console.log("[INPUT-MODE] active mode", ACTIVE_INPUT_MODE);
      console.log("[INPUT-MODE] summary", activeInputModeSummary);
      if (activeInputModeSummary.externalResultFile !== null) {
        const activeExternalResultFileEntry =
          EXTERNAL_RESULT_FILES[ACTIVE_EXTERNAL_RESULT_FILE];
        const activeResolvedExternalResultFileEntry = resolveExternalResultFileEntry(
          ACTIVE_EXTERNAL_RESULT_FILE
        );
        const contentSampleValidation = validateExternalResultFileContentSample(
          activeResolvedExternalResultFileEntry
        );

        console.log("[RESULT-FILE] active file", ACTIVE_EXTERNAL_RESULT_FILE);
        console.log("[RESULT-FILE] file entry", activeExternalResultFileEntry);
        console.log("[RESULT-FILE] file source", "src/data/externalResultFiles.ts");
        console.log(
          "[RESULT-FILE] content format",
          activeResolvedExternalResultFileEntry.format
        );
        console.log(
          "[RESULT-FILE] content count",
          activeResolvedExternalResultFileEntry.content.length
        );
        console.log(
          "[RESULT-FILE] content sample",
          activeResolvedExternalResultFileEntry.content.slice(0, 10)
        );
        console.log(
          "[RESULT-FILE] content sample validation",
          contentSampleValidation
        );
      }
      if (activeInputModeSummary.audioVideoSourceResult !== null) {
        const activeSourceResult =
          AUDIO_VIDEO_SOURCE_RESULTS[ACTIVE_AUDIO_VIDEO_SOURCE_RESULT];
        const activeAudioVideoSource: AudioVideoSourceResult = {
          sourceName: activeSourceResult.sourceName,
          sourceKind: activeSourceResult.sourceKind,
          transcriptionFormat: activeSourceResult.transcriptionFormat,
          transcriptionContent: activeSourceResult.transcriptionContent.map((hit) => ({
            time: hit.time,
            instrument: hit.instrument,
            velocity: hit.velocity,
          })),
        };
        const activeAudioVideoSourceKind = activeAudioVideoSource.sourceKind;
        const contentSampleValidation =
          validateAudioVideoTranscriptionContentSample(activeAudioVideoSource);

        console.log("[AV-SOURCE] active result", ACTIVE_AUDIO_VIDEO_SOURCE_RESULT);
        console.log("[AV-SOURCE] source name", activeAudioVideoSource.sourceName);
        console.log("[AV-SOURCE] source kind", activeAudioVideoSourceKind);
        console.log("[AV-SOURCE] source summary", {
          activeResult: ACTIVE_AUDIO_VIDEO_SOURCE_RESULT,
          sourceName: activeAudioVideoSource.sourceName,
          sourceKind: activeAudioVideoSourceKind,
          transcriptionFormat: activeAudioVideoSource.transcriptionFormat,
          transcriptionCount: activeAudioVideoSource.transcriptionContent.length,
        });
        console.log(
          "[AV-SOURCE] kind coverage check",
          buildAudioVideoSourceKindCoverageCheck(activeAudioVideoSourceKind)
        );
        console.log(
          "[AV-SOURCE] transcription format",
          activeAudioVideoSource.transcriptionFormat
        );
        console.log(
          "[AV-SOURCE] transcription count",
          activeAudioVideoSource.transcriptionContent.length
        );
        console.log(
          "[AV-SOURCE] transcription distribution",
          activeAudioVideoSource.transcriptionContent.reduce((acc, hit) => {
            acc[hit.instrument] = (acc[hit.instrument] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        );
        console.log(
          "[AV-SOURCE] transcription sample",
          activeAudioVideoSource.transcriptionContent.slice(0, 10)
        );
        console.log(
          "[AV-SOURCE] transcription sample validation",
          contentSampleValidation
        );
      }
      if (activeInputModeSummary.audioVideoResultFile !== null) {
        const activeFileEntry = AUDIO_VIDEO_RESULT_FILES[ACTIVE_AUDIO_VIDEO_RESULT_FILE];
        const fileValidation = validateAudioVideoResultFileEntry(activeFileEntry);
        const fileContentValidation =
          validateAudioVideoResultFileContentSample(activeFileEntry);
        const contentDistribution = activeFileEntry.content.transcriptionContent.reduce(
          (acc, hit) => {
            acc[hit.instrument] = (acc[hit.instrument] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        console.log("[AV-FILE] active file", ACTIVE_AUDIO_VIDEO_RESULT_FILE);
        console.log("[AV-FILE] file entry", activeFileEntry);
        console.log("[AV-FILE] file source", "src/data/audioVideoResultFiles.ts");
        console.log("[AV-FILE] content source name", activeFileEntry.content.sourceName);
        console.log("[AV-FILE] content source kind", activeFileEntry.content.sourceKind);
        console.log(
          "[AV-FILE] content transcription count",
          activeFileEntry.content.transcriptionContent.length
        );
        console.log(
          "[AV-FILE] content sample validation",
          fileContentValidation
        );
        console.log(
          "[AV-FILE] content transcription distribution",
          contentDistribution
        );
        console.log("[AV-FILE] loose coverage summary", {
          hasKick: Boolean(contentDistribution.kick),
          hasSnare: Boolean(contentDistribution.snare),
          hasCrash: Boolean(contentDistribution.crash),
          hasUnknown: Boolean(contentDistribution.unknown),
          totalKinds: Object.keys(contentDistribution).length,
        });
        console.log("[AV-FILE] validation summary", {
          activeFile: ACTIVE_AUDIO_VIDEO_RESULT_FILE,
          fileFormat: activeFileEntry.format,
          fileIsValid: fileValidation.isValid,
          contentInvalidItemCount: fileContentValidation.invalidItemCount,
          sourceKind: activeFileEntry.content.sourceKind,
        });
      }
      console.log("[EXTERNAL] sample source", "src/data/externalInitialEventSamples.ts");
      console.log("[EXTERNAL] available samples", Object.keys(EXTERNAL_INITIAL_EVENT_SAMPLES));
      console.log("[TRANSCRIPTION] sample source", "src/data/externalTranscriptionResults.ts");
      console.log("[TRANSCRIPTION] available samples", EXTERNAL_TRANSCRIPTION_SAMPLE_NAMES);

      try {
        const response = await fetch(encodeURI(`/midi/${activeMidiTestFile}`));
        if (!response.ok) {
          console.error("[V4] fetch failed", response.status);
          throw new Error(`Failed to fetch MIDI: ${response.status} ${response.statusText}`);
        }

        const midiBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const midi = new Midi(midiBuffer);
        console.log("[V4] MIDI loaded", midi);

        const midiBpm = midi.header.tempos[0]?.bpm;
        const firstTrack = midi.tracks[0];
        const allNotes = midi.tracks.flatMap((t) => t.notes);

        allNotes.sort((a, b) => a.time - b.time);

        console.log("[V4] bpm", midi.header.tempos);
        console.log("[V4] total notes", allNotes.length);
        console.log(
          "[V4] first 5 notes",
          allNotes.slice(0, 5).map((n) => ({
            time: n.time,
            midi: n.midi,
            velocity: n.velocity,
          }))
        );

        if (midiBpm !== undefined) {
          console.log("[V4] primary bpm", midiBpm);
        }

        const rawMidiNoteCounts = (firstTrack?.notes ?? []).reduce((acc, note) => {
          acc[note.midi] = (acc[note.midi] || 0) + 1;
          return acc;
        }, {} as Record<number, number>);

        console.log("[MAP] raw midi note counts", rawMidiNoteCounts);

        const unmappedRawNotes = (firstTrack?.notes ?? [])
          .filter((note) => !mapMidiNoteToDrumInfo(note.midi))
          .slice(0, 20)
          .map((note) => ({ midi: note.midi, time: note.time }));

        console.log("[MAP] unmapped raw notes sample", unmappedRawNotes);

        const pipelineInput = buildPipelineInputFromActiveMode({
          mode: ACTIVE_INPUT_MODE,
          midiNotes: (firstTrack?.notes ?? []).map((note) => ({
            midi: note.midi,
            time: note.time,
            velocity: note.velocity,
          })),
          activeExternalSample: ACTIVE_EXTERNAL_SAMPLE,
          activeTranscriptionSample: ACTIVE_TRANSCRIPTION_SAMPLE,
          activeExternalResultFile: ACTIVE_EXTERNAL_RESULT_FILE,
          activeAudioVideoSourceResult: ACTIVE_AUDIO_VIDEO_SOURCE_RESULT,
          activeAudioVideoResultFile: ACTIVE_AUDIO_VIDEO_RESULT_FILE,
        });

        console.log("[INPUT-MODE] pipeline source check", {
          mode: ACTIVE_INPUT_MODE,
          pipelineSourceType: pipelineInput.sourceType,
        });

        const activeTranscriptionHits =
          activeInputModeSummary.externalTranscriptionSample !== null
            ? getActiveExternalTranscriptionHits(ACTIVE_TRANSCRIPTION_SAMPLE)
            : [];

        const activeExternalInitialEvents =
          activeInputModeSummary.externalInitialSample !== null
            ? getActiveExternalInitialEvents(ACTIVE_EXTERNAL_SAMPLE)
            : [];

        if (pipelineInput.sourceType === "midi_test" && pipelineInput.midiNotes.length === 0) {
          return;
        }

        if (activeInputModeSummary.externalTranscriptionSample !== null) {
          console.log("[TRANSCRIPTION] active sample", ACTIVE_TRANSCRIPTION_SAMPLE);
          console.log(
            "[TRANSCRIPTION] raw sample count",
            EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES[ACTIVE_TRANSCRIPTION_SAMPLE].length
          );
          console.log(
            "[TRANSCRIPTION] raw sample distribution",
            EXTERNAL_TRANSCRIPTION_RESULT_SAMPLES[ACTIVE_TRANSCRIPTION_SAMPLE].reduce(
              (acc, hit) => {
                acc[hit.instrument] = (acc[hit.instrument] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>
            )
          );
          console.log("[TRANSCRIPTION] active hit count", activeTranscriptionHits.length);
          console.log(
            "[TRANSCRIPTION] active hit sample",
            activeTranscriptionHits.slice(0, 10)
          );
        }

        const initialDrumEvents = buildPipelineInputToInitialEvents(pipelineInput);

        console.log("[ADAPTER] pipeline input source", pipelineInput.sourceType);

        if (pipelineInput.sourceType === "midi_test") {
          console.log("[ADAPTER] midi note count", pipelineInput.midiNotes.length);
        }

        if (activeInputModeSummary.externalInitialSample !== null) {
          console.log("[EXTERNAL] active sample", ACTIVE_EXTERNAL_SAMPLE);
          console.log("[EXTERNAL] sample event count", activeExternalInitialEvents.length);
          console.log(
            "[EXTERNAL] sample distribution",
            activeExternalInitialEvents.reduce((acc, ev) => {
              const key = `${ev.instrument}:${ev.articulation}`;
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          );
          console.log("[ADAPTER] external initial event count", activeExternalInitialEvents.length);
          console.log(
            "[ADAPTER] external initial event sample",
            activeExternalInitialEvents.slice(0, 10)
          );
        }

        console.log("[ADAPTER] initial event count", initialDrumEvents.length);
        console.log(
          "[ADAPTER] initial event sample",
          initialDrumEvents.slice(0, 10).map((ev) => ({
            time: ev.time,
            instrument: ev.instrument,
            articulation: ev.articulation,
            velocity: ev.velocity,
          }))
        );

        const adapterIntegrityCheck = {
          sourceType: pipelineInput.sourceType,
          initialEventCount: initialDrumEvents.length,
          invalidInitialEventCount: initialDrumEvents.filter(
            (ev) =>
              typeof ev.time !== "number" ||
              typeof ev.velocity !== "number" ||
              !ev.instrument ||
              !ev.articulation
          ).length,
        };

        console.log("[ADAPTER] integrity", adapterIntegrityCheck);

        if (activeInputModeSummary.externalResultFile !== null) {
          console.log("[RESULT-FILE] pipeline entry summary", {
            activeFile: ACTIVE_EXTERNAL_RESULT_FILE,
            pipelineSourceType: pipelineInput.sourceType,
            initialEventCount: initialDrumEvents.length,
          });
        }

        if (activeInputModeSummary.audioVideoSourceResult !== null) {
          const activeSourceResult =
            AUDIO_VIDEO_SOURCE_RESULTS[ACTIVE_AUDIO_VIDEO_SOURCE_RESULT];
          const activeAudioVideoSource: AudioVideoSourceResult = {
            sourceName: activeSourceResult.sourceName,
            sourceKind: activeSourceResult.sourceKind,
            transcriptionFormat: activeSourceResult.transcriptionFormat,
            transcriptionContent: activeSourceResult.transcriptionContent.map((hit) => ({
              time: hit.time,
              instrument: hit.instrument,
              velocity: hit.velocity,
            })),
          };
          const activeAudioVideoSourceKind = activeAudioVideoSource.sourceKind;

          console.log("[AV-SOURCE] pipeline entry summary", {
            activeResult: ACTIVE_AUDIO_VIDEO_SOURCE_RESULT,
            sourceKind: activeAudioVideoSourceKind,
            pipelineSourceType: pipelineInput.sourceType,
            initialEventCount: initialDrumEvents.length,
          });
          console.log("[AV-SOURCE] validation summary", {
            activeResult: ACTIVE_AUDIO_VIDEO_SOURCE_RESULT,
            sourceKind: activeAudioVideoSource.sourceKind,
            pipelineSourceType: pipelineInput.sourceType,
            initialEventCount: initialDrumEvents.length,
          });
        }

        if (activeInputModeSummary.audioVideoResultFile !== null) {
          console.log("[AV-FILE] pipeline entry summary", {
            activeFile: ACTIVE_AUDIO_VIDEO_RESULT_FILE,
            sourceKind:
              AUDIO_VIDEO_RESULT_FILES[ACTIVE_AUDIO_VIDEO_RESULT_FILE].content.sourceKind,
            pipelineSourceType: pipelineInput.sourceType,
            initialEventCount: initialDrumEvents.length,
          });
        }

        console.log("[INPUT] initial drum event sample", initialDrumEvents.slice(0, 12));

        const initialDrumEventDistribution = initialDrumEvents.reduce((acc, ev) => {
          const key = `${ev.instrument}:${ev.articulation}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[INPUT] initial drum event distribution", initialDrumEventDistribution);

        const initialInputIntegrity = {
          count: initialDrumEvents.length,
          invalidCount: initialDrumEvents.filter(
            (ev) =>
              typeof ev.time !== "number" ||
              typeof ev.velocity !== "number" ||
              !ev.instrument ||
              !ev.articulation
          ).length,
        };

        console.log("[INPUT] initial input integrity", initialInputIntegrity);
        console.log("[INPUT] pipeline entry confirmed", {
          source: "InitialDrumEvent[]",
          count: initialDrumEvents.length,
        });

        const inputUnknownSummary = summarizeUnknownLikeEvents(initialDrumEvents);

        console.log("[BOUNDARY] input unknown summary", inputUnknownSummary);

        if (initialDrumEvents.length === 0) {
          return;
        }

        const normalizedV3DrumEvents: V3TempDrumEvent[] = initialDrumEvents.map((event) => {
          const { stepIndex, quantizedTime } = quantizeToGrid(event.time, stepDuration);
          const beatIndex = Math.floor(stepIndex / stepsPerBeat);
          const barIndex = Math.floor(beatIndex / beatsPerBar);

          return {
            time: quantizedTime,
            stepIndex,
            beatIndex,
            barIndex,
            instrument: event.instrument,
            articulation: event.articulation,
            velocity: event.velocity,
          };
        });

        const quantizedSample = normalizedV3DrumEvents.slice(0, 12).map((ev) => ({
          instrument: ev.instrument,
          articulation: ev.articulation,
          time: ev.time,
          stepIndex: ev.stepIndex,
          beatIndex: ev.beatIndex,
          barIndex: ev.barIndex,
        }));

        console.log("[GRID] quantized sample", quantizedSample);

        const stepIndexSequence = normalizedV3DrumEvents.slice(0, 24).map((ev) => ev.stepIndex);
        console.log("[GRID] first 24 step indexes", stepIndexSequence);

        const invalidGridEvents = normalizedV3DrumEvents.filter(
          (ev) =>
            ev.stepIndex < 0 ||
            ev.beatIndex < 0 ||
            ev.barIndex < 0 ||
            !Number.isInteger(ev.stepIndex) ||
            !Number.isInteger(ev.beatIndex) ||
            !Number.isInteger(ev.barIndex)
        );

        console.log("[GRID] invalid grid events", invalidGridEvents);

        const uniqueStepCount = new Set(normalizedV3DrumEvents.map((ev) => ev.stepIndex)).size;
        console.log("[GRID] unique step count", uniqueStepCount);

        const groupedByStepForGridCheck = Array.from(
          normalizedV3DrumEvents
            .reduce((map, ev) => {
              const arr = map.get(ev.stepIndex) ?? [];
              arr.push(ev);
              map.set(ev.stepIndex, arr);
              return map;
            }, new Map<number, V3TempDrumEvent[]>())
            .entries()
        ).sort((a, b) => a[0] - b[0]);

        const groupedStepSample = groupedByStepForGridCheck.slice(0, 16).map(([step, events]) => ({
          step,
          inst: events.map((ev) => ev.instrument),
          times: events.map((ev) => ev.time),
        }));

        console.log("[GRID-MERGE] grouped step sample", groupedStepSample);

        const multiHitSteps = groupedByStepForGridCheck
          .filter(([, events]) => events.length > 1)
          .slice(0, 20)
          .map(([step, events]) => ({
            step,
            inst: events.map((ev) => ev.instrument),
            articulations: events.map((ev) => ev.articulation),
            times: events.map((ev) => ev.time),
          }));

        console.log("[GRID-MERGE] multi-hit steps", multiHitSteps);

        const comboCheck = {
          bdSdSameStepCount: groupedByStepForGridCheck.filter(([, events]) => {
            const set = new Set(events.map((ev) => ev.instrument));
            return set.has("BD") && set.has("SD");
          }).length,
          bdHhSameStepCount: groupedByStepForGridCheck.filter(([, events]) => {
            const set = new Set(events.map((ev) => ev.instrument));
            return set.has("BD") && set.has("HH");
          }).length,
          sdHhSameStepCount: groupedByStepForGridCheck.filter(([, events]) => {
            const set = new Set(events.map((ev) => ev.instrument));
            return set.has("SD") && set.has("HH");
          }).length,
          bdCrSameStepCount: groupedByStepForGridCheck.filter(([, events]) => {
            const set = new Set(events.map((ev) => ev.instrument));
            return set.has("BD") && set.has("CR");
          }).length,
          bdRdSameStepCount: groupedByStepForGridCheck.filter(([, events]) => {
            const set = new Set(events.map((ev) => ev.instrument));
            return set.has("BD") && set.has("RD");
          }).length,
        };

        console.log("[GRID-MERGE] combo check", comboCheck);

        const sameStepSpreadSample = groupedByStepForGridCheck
          .filter(([, events]) => events.length > 1)
          .slice(0, 20)
          .map(([step, events]) => {
            const times = events.map((ev) => ev.time);
            return {
              step,
              minTime: Math.min(...times),
              maxTime: Math.max(...times),
              spread: Math.max(...times) - Math.min(...times),
            };
          });

        console.log("[GRID-MERGE] same-step spread sample", sameStepSpreadSample);

        console.log("[V4-2] mapped events", normalizedV3DrumEvents.length);
        console.log(
          "[V4-2] sample",
          normalizedV3DrumEvents.slice(0, 10).map((e) => ({
            instrument: e.instrument,
            articulation: e.articulation,
            velocity: e.velocity,
          }))
        );

        console.log(
          "[V4-3] quantized sample",
          normalizedV3DrumEvents.slice(0, 10).map((e) => ({
            time: e.time,
            step: e.stepIndex,
          }))
        );

        const mappedCounts = normalizedV3DrumEvents.reduce((acc, ev) => {
          const key = `${ev.instrument}:${ev.articulation}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[MAP] mapped instrument/articulation counts", mappedCounts);

        const mappedInstrumentSet = Array.from(
          new Set(normalizedV3DrumEvents.map((ev) => ev.instrument))
        );
        const mappedArticulationSet = Array.from(
          new Set(
            normalizedV3DrumEvents
              .map((ev) => ev.articulation)
              .filter((articulation) => articulation !== "unknown")
          )
        );
        const coverageCheck = {
          BD: mappedInstrumentSet.includes("BD"),
          SD: mappedInstrumentSet.includes("SD"),
          HH: mappedInstrumentSet.includes("HH"),
          CR: mappedInstrumentSet.includes("CR"),
          RD: mappedInstrumentSet.includes("RD"),
          TM_HIGH: mappedInstrumentSet.includes("TM_HIGH"),
          TM_MID: mappedInstrumentSet.includes("TM_MID"),
          TM_FLOOR: mappedInstrumentSet.includes("TM_FLOOR"),
        };
        const coverageSummary = {
          core: {
            BD: mappedInstrumentSet.includes("BD"),
            SD: mappedInstrumentSet.includes("SD"),
            HH: mappedInstrumentSet.includes("HH"),
          },
          cymbals: {
            CR: mappedInstrumentSet.includes("CR"),
            RD: mappedInstrumentSet.includes("RD"),
          },
          toms: {
            TM_HIGH: mappedInstrumentSet.includes("TM_HIGH"),
            TM_MID: mappedInstrumentSet.includes("TM_MID"),
            TM_FLOOR: mappedInstrumentSet.includes("TM_FLOOR"),
          },
          articulations: {
            normal: mappedArticulationSet.includes("normal"),
            closed: mappedArticulationSet.includes("closed"),
            open: mappedArticulationSet.includes("open"),
            pedal: mappedArticulationSet.includes("pedal"),
            ghost: mappedArticulationSet.includes("ghost"),
          },
        };
        const missingCoverage = {
          instruments: Object.entries(coverageCheck)
            .filter(([, ok]) => !ok)
            .map(([name]) => name),
          articulations: Object.entries(coverageSummary.articulations)
            .filter(([, ok]) => !ok)
            .map(([name]) => name),
        };
        const unresolvedCoreCoverage = {
          ghost: coverageSummary.articulations.ghost,
          toms: {
            TM_HIGH: coverageSummary.toms.TM_HIGH,
            TM_MID: coverageSummary.toms.TM_MID,
            TM_FLOOR: coverageSummary.toms.TM_FLOOR,
          },
        };

        console.log("[MAP-TEST] mapped instruments present", mappedInstrumentSet);
        console.log("[MAP-TEST] mapped articulations present", mappedArticulationSet);
        console.log("[MAP-TEST] coverage check", coverageCheck);
        console.log("[MAP-TEST] coverage summary", coverageSummary);
        console.log("[MAP-TEST] missing coverage", missingCoverage);
        console.log("[MAP-TEST] unresolved core coverage", unresolvedCoreCoverage);

        const dedupedV3DrumEvents = dedupeEventsByStepAndInstrument(normalizedV3DrumEvents);

        const dedupedUnknownSummary = summarizeUnknownLikeEvents(dedupedV3DrumEvents);

        console.log("[BOUNDARY] deduped unknown summary", dedupedUnknownSummary);

        const dedupeStats = {
          rawCount: normalizedV3DrumEvents.length,
          dedupedCount: dedupedV3DrumEvents.length,
          removedCount: normalizedV3DrumEvents.length - dedupedV3DrumEvents.length,
        };

        console.log("[DENOISE] dedupe stats", dedupeStats);

        const duplicateBuckets = Array.from(
          normalizedV3DrumEvents
            .reduce((map, ev) => {
              const key = `${ev.stepIndex}:${ev.instrument}:${ev.articulation}`;
              const arr = map.get(key) ?? [];
              arr.push(ev);
              map.set(key, arr);
              return map;
            }, new Map<string, V3TempDrumEvent[]>())
            .entries()
        )
          .filter(([, arr]) => arr.length > 1)
          .slice(0, 20)
          .map(([key, arr]) => ({
            key,
            count: arr.length,
            velocities: arr.map((ev) => ev.velocity),
            times: arr.map((ev) => ev.time),
          }));

        console.log("[DENOISE] duplicate buckets sample", duplicateBuckets);

        console.log(
          "[DENOISE] deduped sample",
          dedupedV3DrumEvents.slice(0, 12).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            velocity: ev.velocity,
            time: ev.time,
          }))
        );

        const lowValueNoiseCandidates = getLowValueNoiseCandidates(dedupedV3DrumEvents);

        const noiseCandidateStats = {
          dedupedCount: dedupedV3DrumEvents.length,
          candidateCount: lowValueNoiseCandidates.length,
        };

        console.log("[DENOISE] noise candidate stats", noiseCandidateStats);

        console.log(
          "[DENOISE] noise candidate sample",
          lowValueNoiseCandidates.slice(0, 20).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            velocity: ev.velocity,
            time: ev.time,
          }))
        );

        const noiseCandidateByInstrument = lowValueNoiseCandidates.reduce((acc, ev) => {
          acc[ev.instrument] = (acc[ev.instrument] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[DENOISE] noise candidate by instrument", noiseCandidateByInstrument);

        const safelyFilteredV3DrumEvents = filterSafeNoiseCandidates(dedupedV3DrumEvents);

        const filteredUnknownSummary = summarizeUnknownLikeEvents(
          safelyFilteredV3DrumEvents
        );

        console.log("[BOUNDARY] filtered unknown summary", filteredUnknownSummary);

        const safeFilterStats = {
          dedupedCount: dedupedV3DrumEvents.length,
          filteredCount: safelyFilteredV3DrumEvents.length,
          removedCount: dedupedV3DrumEvents.length - safelyFilteredV3DrumEvents.length,
        };

        console.log("[DENOISE] safe filter stats", safeFilterStats);

        const safelyRemovedEvents = dedupedV3DrumEvents.filter((ev) => {
          return !safelyFilteredV3DrumEvents.some(
            (kept) =>
              kept.stepIndex === ev.stepIndex &&
              kept.instrument === ev.instrument &&
              kept.articulation === ev.articulation &&
              kept.time === ev.time &&
              kept.velocity === ev.velocity
          );
        });

        console.log(
          "[DENOISE] safely removed sample",
          safelyRemovedEvents.slice(0, 20).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            velocity: ev.velocity,
            time: ev.time,
          }))
        );

        console.log(
          "[DENOISE] safely filtered sample",
          safelyFilteredV3DrumEvents.slice(0, 12).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            velocity: ev.velocity,
            time: ev.time,
          }))
        );

        const practiceSimplifiedEvents = simplifyForPractice(safelyFilteredV3DrumEvents);

        const simplifyStats = {
          filteredCount: safelyFilteredV3DrumEvents.length,
          simplifiedCount: practiceSimplifiedEvents.length,
          removedCount: safelyFilteredV3DrumEvents.length - practiceSimplifiedEvents.length,
        };

        console.log("[SIMPLIFY] simplify stats", simplifyStats);

        const simplifiedRemovedSample = safelyFilteredV3DrumEvents.filter((ev) => {
          return !practiceSimplifiedEvents.some(
            (kept) =>
              kept.stepIndex === ev.stepIndex &&
              kept.instrument === ev.instrument &&
              kept.articulation === ev.articulation &&
              kept.time === ev.time &&
              kept.velocity === ev.velocity
          );
        });

        console.log(
          "[SIMPLIFY] removed sample",
          simplifiedRemovedSample.slice(0, 20).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            velocity: ev.velocity,
            time: ev.time,
          }))
        );

        const simplifiedRemovedByInstrument = simplifiedRemovedSample.reduce((acc, ev) => {
          acc[ev.instrument] = (acc[ev.instrument] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[SIMPLIFY] removed by instrument", simplifiedRemovedByInstrument);

        const adjacentCymbalPairs = safelyFilteredV3DrumEvents
          .map((ev, index, arr) => {
            if (index === 0) return null;
            const prev = arr[index - 1];
            if (prev.instrument !== ev.instrument) return null;
            if (!["HH", "CR", "RD"].includes(ev.instrument)) return null;

            return {
              instrument: ev.instrument,
              prevStep: prev.stepIndex,
              currentStep: ev.stepIndex,
              gap: ev.stepIndex - prev.stepIndex,
            };
          })
          .filter(
            (
              value
            ): value is {
              instrument: V3TempDrumEvent["instrument"];
              prevStep: number;
              currentStep: number;
              gap: number;
            } => value !== null
          )
          .slice(0, 30);

        console.log("[SIMPLIFY] adjacent cymbal pairs", adjacentCymbalPairs);

        const simplifiedInstrumentDistribution = practiceSimplifiedEvents.reduce((acc, ev) => {
          acc[ev.instrument] = (acc[ev.instrument] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[SIMPLIFY] instrument distribution", simplifiedInstrumentDistribution);

        const cleanedEvents: V3TempDrumEvent[] = safelyFilteredV3DrumEvents;

        const grooveCoreSteps = new Set<number>();

        for (const e of cleanedEvents) {
          if (e.instrument === "BD" || e.instrument === "SD") {
            grooveCoreSteps.add(e.stepIndex);
          }
        }

        console.log("[V4-5] groove core steps", Array.from(grooveCoreSteps).slice(0, 20));

        console.log(
          "[V4-4] cleaned count",
          cleanedEvents.length,
          "raw",
          safelyFilteredV3DrumEvents.length
        );

        const finalScoreEvents: V3TempDrumEvent[] = practiceSimplifiedEvents;

        const finalUnknownSummary = summarizeUnknownLikeEvents(finalScoreEvents);

        const v1PipelineContractSummary = buildV1PipelineContractSummary({
          inputCount: initialDrumEvents.length,
          finalCount: finalScoreEvents.length,
          hasUnknownInput: inputUnknownSummary.totalUnknownLikeCount > 0,
          hasUnknownFinal: finalUnknownSummary.totalUnknownLikeCount > 0,
          hasKick: finalScoreEvents.some((event) => event.instrument === "BD"),
          hasSnare: finalScoreEvents.some((event) => event.instrument === "SD"),
          hasHiHat: finalScoreEvents.some((event) => event.instrument === "HH"),
          hasCrash: finalScoreEvents.some((event) => event.instrument === "CR"),
          hasRide: finalScoreEvents.some((event) => event.instrument === "RD"),
        });

        const v1DeliveryBoundarySummary = buildV1DeliveryBoundarySummary({
          hasKick: finalScoreEvents.some((event) => event.instrument === "BD"),
          hasSnare: finalScoreEvents.some((event) => event.instrument === "SD"),
          hasHiHat: finalScoreEvents.some((event) => event.instrument === "HH"),
          hasCrash: finalScoreEvents.some((event) => event.instrument === "CR"),
          hasRide: finalScoreEvents.some((event) => event.instrument === "RD"),
          hasUnknownInput: inputUnknownSummary.totalUnknownLikeCount > 0,
          hasUnknownFinal: finalUnknownSummary.totalUnknownLikeCount > 0,
          outputStable: finalScoreEvents.length > 0,
        });

        const v1NotationFoundationSummary = buildV1NotationFoundationSummary(
          finalScoreEvents
        );

        console.log("[BOUNDARY] final unknown summary", finalUnknownSummary);
        console.log("[BOUNDARY] unknown flow summary", {
          inputUnknownLikeCount: inputUnknownSummary.totalUnknownLikeCount,
          dedupedUnknownLikeCount: dedupedUnknownSummary.totalUnknownLikeCount,
          filteredUnknownLikeCount: filteredUnknownSummary.totalUnknownLikeCount,
          finalUnknownLikeCount: finalUnknownSummary.totalUnknownLikeCount,
        });
        console.log("[BOUNDARY] v1 handling summary", {
          unknownObserved: inputUnknownSummary.totalUnknownLikeCount > 0,
          unknownSurvivesToFinal: finalUnknownSummary.totalUnknownLikeCount > 0,
          pipelineStableWithUnknown:
            inputUnknownSummary.totalUnknownLikeCount > 0 && finalScoreEvents.length > 0,
        });
        console.log("[CONTRACT] v1 pipeline summary", v1PipelineContractSummary);
        console.log("[CONTRACT] v1 sample conclusion", {
          activeInputMode: ACTIVE_INPUT_MODE,
          currentAudioVideoFile:
            ACTIVE_INPUT_MODE === "audio_video_result_file"
              ? ACTIVE_AUDIO_VIDEO_RESULT_FILE
              : null,
          outputStable: finalScoreEvents.length > 0,
          unknownRetained: finalUnknownSummary.totalUnknownLikeCount > 0,
        });
        console.log("[DELIVERY] v1 boundary summary", v1DeliveryBoundarySummary);
        console.log("[DELIVERY] v1 sample readiness", {
          activeInputMode: ACTIVE_INPUT_MODE,
          currentAudioVideoFile:
            ACTIVE_INPUT_MODE === "audio_video_result_file"
              ? ACTIVE_AUDIO_VIDEO_RESULT_FILE
              : null,
          stableOutput: finalScoreEvents.length > 0,
          keepsUnknownInCurrentVersion:
            finalUnknownSummary.totalUnknownLikeCount > 0,
          readyForV1Scope: finalScoreEvents.length > 0,
        });
        console.log("[NOTATION-FOUNDATION] lane order", V1_NOTATION_LANE_ORDER);
        console.log("[NOTATION-FOUNDATION] summary", v1NotationFoundationSummary);

        const simplifiedEvents: V3TempDrumEvent[] = finalScoreEvents;

        console.log(
          "[V4-6] simplified count",
          simplifiedEvents.length,
          "from",
          practiceSimplifiedEvents.length
        );

        console.log("[SIMPLIFY-FLOW] safe filtered count", safelyFilteredV3DrumEvents.length);
        console.log("[SIMPLIFY-FLOW] practice simplified count", practiceSimplifiedEvents.length);
        console.log("[SIMPLIFY-FLOW] final simplified count", simplifiedEvents.length);

        const simplifyFlowCheck = {
          safeFilteredCount: safelyFilteredV3DrumEvents.length,
          practiceSimplifiedCount: practiceSimplifiedEvents.length,
          finalCount:
            typeof simplifiedEvents !== "undefined"
              ? simplifiedEvents.length
              : practiceSimplifiedEvents.length,
        };

        console.log("[SIMPLIFY-FLOW] check", simplifyFlowCheck);

        const flowSummary = {
          rawMappedCount: normalizedV3DrumEvents.length,
          dedupedCount: dedupedV3DrumEvents.length,
          safelyFilteredCount: safelyFilteredV3DrumEvents.length,
          practiceSimplifiedCount: practiceSimplifiedEvents.length,
          finalScoreCount: finalScoreEvents.length,
        };

        console.log("[FLOW] summary", flowSummary);

        const flowDelta = {
          dedupeRemoved: normalizedV3DrumEvents.length - dedupedV3DrumEvents.length,
          safeFilterRemoved: dedupedV3DrumEvents.length - safelyFilteredV3DrumEvents.length,
          simplifyRemoved: safelyFilteredV3DrumEvents.length - practiceSimplifiedEvents.length,
          finalRemoved: practiceSimplifiedEvents.length - finalScoreEvents.length,
        };

        console.log("[FLOW] delta", flowDelta);

        const flowIntegrityCheck = {
          finalEqualsPracticeSimplified:
            finalScoreEvents.length === practiceSimplifiedEvents.length,
          noUnexpectedGrowth:
            dedupedV3DrumEvents.length <= normalizedV3DrumEvents.length &&
            safelyFilteredV3DrumEvents.length <= dedupedV3DrumEvents.length &&
            practiceSimplifiedEvents.length <= safelyFilteredV3DrumEvents.length &&
            finalScoreEvents.length <= practiceSimplifiedEvents.length,
        };

        console.log("[FLOW] integrity check", flowIntegrityCheck);

        console.log("[FLOW] stage sample", {
          normalized: normalizedV3DrumEvents.slice(0, 6).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
          })),
          deduped: dedupedV3DrumEvents.slice(0, 6).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
          })),
          filtered: safelyFilteredV3DrumEvents.slice(0, 6).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
          })),
          simplified: practiceSimplifiedEvents.slice(0, 6).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
          })),
          final: finalScoreEvents.slice(0, 6).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
          })),
        });

        console.log(
          "[OUTPUT] final score sample",
          finalScoreEvents.slice(0, 16).map((ev) => ({
            instrument: ev.instrument,
            articulation: ev.articulation,
            stepIndex: ev.stepIndex,
            beatIndex: ev.beatIndex,
            barIndex: ev.barIndex,
            time: ev.time,
            velocity: ev.velocity,
          }))
        );

        const finalOutputIntegrity = {
          count: finalScoreEvents.length,
          invalidEvents: finalScoreEvents.filter(
            (ev) =>
              !ev.instrument ||
              !ev.articulation ||
              !Number.isInteger(ev.stepIndex) ||
              !Number.isInteger(ev.beatIndex) ||
              !Number.isInteger(ev.barIndex) ||
              typeof ev.time !== "number" ||
              typeof ev.velocity !== "number"
          ).length,
        };

        console.log("[OUTPUT] integrity check", finalOutputIntegrity);

        const finalOutputDistribution = finalScoreEvents.reduce((acc, ev) => {
          const key = `${ev.instrument}:${ev.articulation}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log("[OUTPUT] distribution", finalOutputDistribution);

        const notationRuleCheck = {
          hasBD: finalScoreEvents.some((ev) => ev.instrument === "BD"),
          hasSD: finalScoreEvents.some((ev) => ev.instrument === "SD"),
          hasHH: finalScoreEvents.some((ev) => ev.instrument === "HH"),
          hasCR: finalScoreEvents.some((ev) => ev.instrument === "CR"),
          hasRD: finalScoreEvents.some((ev) => ev.instrument === "RD"),
          hasTom: finalScoreEvents.some((ev) =>
            ["TM_HIGH", "TM_MID", "TM_FLOOR"].includes(ev.instrument)
          ),
          hasClosedHH: finalScoreEvents.some(
            (ev) => ev.instrument === "HH" && ev.articulation === "closed"
          ),
          hasOpenHH: finalScoreEvents.some(
            (ev) => ev.instrument === "HH" && ev.articulation === "open"
          ),
          hasPedalHH: finalScoreEvents.some(
            (ev) => ev.instrument === "HH" && ev.articulation === "pedal"
          ),
          hasGhostSD: finalScoreEvents.some(
            (ev) => ev.instrument === "SD" && ev.articulation === "ghost"
          ),
        };

        console.log("[NOTATION] rule coverage", notationRuleCheck);

        const invalidNotationEvents = finalScoreEvents.filter((ev) => {
          const validInstrument = [
            "BD",
            "SD",
            "HH",
            "CR",
            "RD",
            "TM_HIGH",
            "TM_MID",
            "TM_FLOOR",
            "UNMAPPED",
          ].includes(ev.instrument);

          const validArticulation = [
            "normal",
            "closed",
            "open",
            "pedal",
            "ghost",
            "unknown",
          ].includes(ev.articulation);

          return !validInstrument || !validArticulation;
        });

        console.log("[NOTATION] invalid events", invalidNotationEvents);

        const grooveSkeletonCheck = {
          bdStepCount: new Set(
            finalScoreEvents.filter((ev) => ev.instrument === "BD").map((ev) => ev.stepIndex)
          ).size,
          sdStepCount: new Set(
            finalScoreEvents.filter((ev) => ev.instrument === "SD").map((ev) => ev.stepIndex)
          ).size,
          hhStepCount: new Set(
            finalScoreEvents.filter((ev) => ev.instrument === "HH").map((ev) => ev.stepIndex)
          ).size,
        };

        console.log("[NOTATION] groove skeleton check", grooveSkeletonCheck);

        const crossSampleSummary = {
          file: activeMidiTestFile,
          rawMappedCount: normalizedV3DrumEvents.length,
          dedupedCount: dedupedV3DrumEvents.length,
          safelyFilteredCount: safelyFilteredV3DrumEvents.length,
          practiceSimplifiedCount: practiceSimplifiedEvents.length,
          finalScoreCount: finalScoreEvents.length,
          invalidOutputCount: finalOutputIntegrity.invalidEvents,
          hasBD: finalScoreEvents.some((ev) => ev.instrument === "BD"),
          hasSD: finalScoreEvents.some((ev) => ev.instrument === "SD"),
          hasHH: finalScoreEvents.some((ev) => ev.instrument === "HH"),
          hasCR: finalScoreEvents.some((ev) => ev.instrument === "CR"),
          hasRD: finalScoreEvents.some((ev) => ev.instrument === "RD"),
        };

        console.log("[FLOW-TEST] summary", crossSampleSummary);

        const crossSampleFlowCheck = {
          file: activeMidiTestFile,
          finalEqualsPracticeSimplified:
            finalScoreEvents.length === practiceSimplifiedEvents.length,
          noUnexpectedGrowth:
            dedupedV3DrumEvents.length <= normalizedV3DrumEvents.length &&
            safelyFilteredV3DrumEvents.length <= dedupedV3DrumEvents.length &&
            practiceSimplifiedEvents.length <= safelyFilteredV3DrumEvents.length &&
            finalScoreEvents.length <= practiceSimplifiedEvents.length,
          invalidOutputZero: finalOutputIntegrity.invalidEvents === 0,
        };

        console.log("[FLOW-TEST] integrity", crossSampleFlowCheck);

        console.log("[V4-7] mode", viewMode, "events", finalScoreEvents.length);

        setMidiDrumEvents(finalScoreEvents);

        const instrumentDistribution = finalScoreEvents.reduce((acc, ev) => {
          acc[ev.instrument] = (acc[ev.instrument] ?? 0) + 1;
          return acc;
        }, Object.fromEntries(V3_ALLOWED_INSTRUMENTS.map((instrument) => [instrument, 0])) as Record<
          BasicDrumInstrument,
          number
        >);

        console.log("[MIDI V3] events count", finalScoreEvents.length);
        console.log("[MIDI V3] instrument distribution", instrumentDistribution);
        console.log("[MIDI V3] V3 locked");
      } catch (error) {
        console.error("[MIDI V3] Failed to load or parse MIDI", error);
      }
    };

    void loadMidiPreview();

    return () => {
      cancelled = true;
    };
  }, [beatsPerBar, stepDuration, stepsPerBeat, viewMode]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const metronomeGainRef = useRef<GainNode | null>(null);
  const lastMetroAudioTimeRef = useRef<number>(0);
  const lastMetroBeatRef = useRef<number>(-1);

  const hasLoopRange = loopStart !== null && loopEnd !== null && loopEnd > loopStart;
  const hasLoop = loopEnabled && hasLoopRange;
  const audioTitle = selectedAudioFile?.name ?? `${PRACTICE_CONTENT.title} · ${currentTrackType.label}`;
  const audioSrc = importedAudioUrl ?? encodeURI(currentTrackType.audioSrc);
  const displayedDuration = audioDuration ?? duration;
  const playbackDuration = audioDuration ?? duration;
  const visualCurrentTime = scrubDragTime ?? trackSwitchDisplayTime ?? currentTime;
  const scoreSyncTime = clamp(visualCurrentTime - secondsPerBar, 0, duration);
  const scoreSyncStep = clamp(Math.round(scoreSyncTime / stepDuration), 0, totalSteps - 1);
  const scoreSyncBar = Math.floor(scoreSyncStep / barSteps);
  const activeCymbal =
    notesByStep
      .find((group) => group.stepIndex === scoreSyncStep)
      ?.notes.find((note) => ["HH", "CR", "RD"].includes(note.instrument))?.instrument ?? null;
  const playbackProgress = playbackDuration > 0 ? clamp(visualCurrentTime / playbackDuration, 0, 1) : 0;
  const scrubBarMarkers = useMemo(
    () => Array.from({ length: Math.max(bars, 1) }, (_, barIndex) => barIndex),
    [bars]
  );
  const formattedCurrentTime = formatClockTime(visualCurrentTime);
  const formattedDisplayedDuration = formatClockTime(displayedDuration);
  const metronomeDotActive = metronomeEnabled && isPlaying && !countInActive && !trackSwitchInProgressRef.current;
  const metronomeDotBeat = metronomeDotActive
    ? ((Math.floor(visualCurrentTime / secondsPerBeat) % beatsPerBar) + beatsPerBar) % beatsPerBar + 1
    : 1;
  const fakeNotationPreviewSections = FAKE_NOTATION_PREVIEW_SECTIONS;

  useEffect(() => {
    console.log(
      "[FAKE-PREVIEW] notation-style v2",
      fakeNotationPreviewSections.map((section) => ({
        id: section.id,
        eventCount: section.events.length,
      }))
    );
  }, [fakeNotationPreviewSections]);

  useEffect(() => {
    console.log("[OUTPUT] score props summary", {
      finalScoreEventCount: finalScoreEvents.length,
      notesByStepCount: notesByStep.length,
      currentStep: scoreSyncStep,
      currentBar: scoreSyncBar,
      hasLoop,
      activeCymbal,
    });
  }, [activeCymbal, finalScoreEvents.length, hasLoop, notesByStep.length, scoreSyncBar, scoreSyncStep]);

  void stepMap;

  const snapTime = useCallback(
    (t: number) => {
      const safe = clamp(t, 0, duration);
      const snappedStep = Math.round(safe / stepDuration);
      return clamp(snappedStep * stepDuration, 0, duration);
    },
    [duration, stepDuration]
  );

  const seekTo = useCallback(
    (t: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const next = clamp(t, 0, playbackDuration);
      setTrackSwitchDisplayTime(null);
      audio.currentTime = next;
      setCurrentTime(next);
    },
    [playbackDuration]
  );

  const seekToSnapped = useCallback(
    (t: number) => {
      seekTo(snapTime(t));
    },
    [seekTo, snapTime]
  );

  const getCalibratedBarTime = useCallback(
    (barIndex: number) => {
      const lastBarIndex = Math.max(bars - 1, 0);
      const clampedBarIndex = clamp(barIndex, 0, lastBarIndex);

      if (lastBarIndex === 0) {
        return clamp(AUDIO_BAR_START_TIME, 0, playbackDuration);
      }

      const normalizedBarPosition = clampedBarIndex / lastBarIndex;
      const calibratedTime =
        AUDIO_BAR_START_TIME +
        normalizedBarPosition * (AUDIO_BAR_END_TIME - AUDIO_BAR_START_TIME);

      return clamp(calibratedTime, 0, playbackDuration);
    },
    [bars, playbackDuration]
  );

  const jumpToBar = useCallback(
    (barIndex: number) => {
      seekTo(getCalibratedBarTime(barIndex));
    },
    [getCalibratedBarTime, seekTo]
  );

  const seekToBarTime = useCallback(
    (barTime: number) => {
      const estimatedBarIndex = secondsPerBar > 0 ? Math.round(barTime / secondsPerBar) : 0;
      seekTo(getCalibratedBarTime(estimatedBarIndex));
    },
    [getCalibratedBarTime, secondsPerBar, seekTo]
  );

  const decreasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeed((v) => parseFloat(clamp(v - 0.1, 0.5, 2.0).toFixed(1)));
  }, []);

  const increasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeed((v) => parseFloat(clamp(v + 0.1, 0.5, 2.0).toFixed(1)));
  }, []);

  const clearCountInTimers = useCallback(() => {
    if (countInIntervalRef.current !== null) {
      window.clearInterval(countInIntervalRef.current);
      countInIntervalRef.current = null;
    }

    if (countInStartTimeoutRef.current !== null) {
      window.clearTimeout(countInStartTimeoutRef.current);
      countInStartTimeoutRef.current = null;
    }
  }, []);

  const resetMetronomeTracking = useCallback(() => {
    lastMetroBeatRef.current = -1;
    lastMetroAudioTimeRef.current = 0;
  }, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    let audioContext = audioContextRef.current;
    if (!audioContext) {
      audioContext = new AudioContext();
      audioContextRef.current = audioContext;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    audio.playbackRate = playbackSpeed;

    const shouldRunCountIn = audio.currentTime <= 0.001;

    if (shouldRunCountIn) {
      const triggerCountInClick = () => {
        if (audioContext.state !== "running") return;

        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(1760, audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, audioContext.currentTime + 0.03);

        filter.type = "highpass";
        filter.frequency.setValueAtTime(900, audioContext.currentTime);

        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.22, audioContext.currentTime + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.04);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioContext.destination);

        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.05);
      };

      clearCountInTimers();
      setCountInActive(true);

      let beat = 1;
      setCountInBeat(beat);
      triggerCountInClick();

      countInIntervalRef.current = window.setInterval(() => {
        beat += 1;
        if (beat > beatsPerBar) return;
        setCountInBeat(beat);
        triggerCountInClick();
      }, secondsPerBeat * 1000);

      countInStartTimeoutRef.current = window.setTimeout(async () => {
        clearCountInTimers();
        setCountInActive(false);
        setCountInBeat(1);

        // console.log("play() called -- attempting audio.play()", { src: audio.src });
        try {
          await audio.play();
          // console.log("play() succeeded");
          setIsPlaying(true);
        } catch (err) {
          console.error("audio play failed:", err);
        }
      }, secondsPerBar * 1000);

      return;
    }

    // console.log("play() called -- attempting audio.play()", { src: audio.src });
    try {
      await audio.play();
      // console.log("play() succeeded");
      setIsPlaying(true);
    } catch (err) {
      console.error("audio play failed:", err);
    }
  }, [beatsPerBar, clearCountInTimers, playbackSpeed, secondsPerBar, secondsPerBeat]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    clearCountInTimers();
    resetMetronomeTracking();
    setCountInActive(false);
    setCountInBeat(1);
    // console.log("pause() called");
    audio.pause();
    // console.log("pause() executed");
    setIsPlaying(false);
  }, [clearCountInTimers, resetMetronomeTracking]);

  const togglePlay = useCallback(() => {
    if (isPlaying || countInActive) pause();
    else play();
  }, [countInActive, isPlaying, pause, play]);

  const resetPlaybackState = useCallback(() => {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    clearCountInTimers();
    resetMetronomeTracking();

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    resumePlaybackAfterScrubRef.current = false;
    isScrubbingRef.current = false;
    setIsPlaying(false);
    setCountInActive(false);
    setCountInBeat(1);
    setCurrentTime(0);
    setLoopStart(null);
    setLoopEnd(null);
    setLoopEnabled(false);
    setMode(null);
    setAudioDuration(null);
  }, [clearCountInTimers, resetMetronomeTracking]);

  const handleReturnToStart = useCallback(() => {
    pause();
    seekTo(0);
  }, [pause, seekTo]);

  const openAudioPicker = useCallback(() => {
    audioInputRef.current?.click();
  }, []);

  const handleAudioFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const nextUrl = URL.createObjectURL(file);

    resetPlaybackState();
    setSelectedAudioFile(file);
    setImportedAudioUrl((prevUrl) => {
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      return nextUrl;
    });
    event.target.value = "";
  }, [resetPlaybackState]);

  const handleTrackTypeChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextTrackType = event.target.value as TrackTypeId;
      if (nextTrackType === selectedTrackType) return;

      const audio = audioRef.current;
      const nextTime = clamp(audio?.currentTime ?? currentTime, 0, playbackDuration);
      const shouldResume = !!audio && !audio.paused;

      pendingSourceSwitchRef.current = {
        time: nextTime,
        shouldResume,
      };
      trackSwitchInProgressRef.current = true;

      clearCountInTimers();
      resetMetronomeTracking();

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (audio) {
        audio.pause();
      }

      resumePlaybackAfterScrubRef.current = false;
      isScrubbingRef.current = false;
      setIsPlaying(shouldResume);
      setCountInActive(false);
      setCountInBeat(1);
      setTrackSwitchDisplayTime(nextTime);
      setCurrentTime(nextTime);

      setSelectedAudioFile(null);
      setImportedAudioUrl((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return null;
      });
      setSelectedTrackType(nextTrackType);
    },
    [clearCountInTimers, currentTime, playbackDuration, resetMetronomeTracking, selectedTrackType]
  );

  const updateScrubFromPointer = useCallback(
    (clientX: number) => {
      const scrubBar = scrubBarRef.current;
      if (!scrubBar || playbackDuration <= 0) return;
      const audio = audioRef.current;
      if (!audio) return;

      const rect = scrubBar.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const nextTime = ratio * playbackDuration;

      setTrackSwitchDisplayTime(null);
      setScrubDragTime(nextTime);
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [playbackDuration]
  );

  const handleScrubPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      event.preventDefault();
      resumePlaybackAfterScrubRef.current = !!audio && !audio.paused;
      isScrubbingRef.current = true;
      setTrackSwitchDisplayTime(null);

      if (audio && !audio.paused) {
        audio.pause();
        setIsPlaying(false);
      }

      setScrubDragTime(audio?.currentTime ?? currentTime);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateScrubFromPointer(event.clientX);
    },
    [currentTime, updateScrubFromPointer]
  );

  const handleScrubPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return;
      updateScrubFromPointer(event.clientX);
    },
    [updateScrubFromPointer]
  );

  const finishScrub = useCallback(
    (clientX?: number) => {
      if (!isScrubbingRef.current) return;

      if (typeof clientX === "number") {
        updateScrubFromPointer(clientX);
      }

      isScrubbingRef.current = false;
      setScrubDragTime(null);

      if (resumePlaybackAfterScrubRef.current) {
        resumePlaybackAfterScrubRef.current = false;
        void play();
        return;
      }

      resumePlaybackAfterScrubRef.current = false;
      setCurrentTime(audioRef.current?.currentTime ?? currentTime);
    },
    [currentTime, play, updateScrubFromPointer]
  );

  const handleScrubPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishScrub(event.clientX);
    },
    [finishScrub]
  );

  const handleScrubPointerCancel = useCallback(() => {
    finishScrub();
  }, [finishScrub]);

  const handleScrubLostPointerCapture = useCallback(() => {
    finishScrub();
  }, [finishScrub]);

  const clearLoop = useCallback(() => {
    setMode(null);
    setLoopStart(null);
    setLoopEnd(null);
    setLoopEnabled(false);
  }, []);

  const applyLoop = useCallback(() => {
    if (!hasLoopRange) return;
    setMode(null);
    setLoopEnabled(true);
  }, [hasLoopRange]);

  const setLoopStartAt = useCallback(
    (t: number) => {
      const v = snapTime(t);
      setLoopEnabled(false);

      setLoopStart(() => {
        const nextStart = v;

        setLoopEnd((prevEnd) => {
          if (prevEnd === null) return prevEnd;
          if (prevEnd <= nextStart) {
            return clamp(nextStart + stepDuration, 0, duration);
          }
          return prevEnd;
        });

        return nextStart;
      });
    },
    [duration, snapTime, stepDuration]
  );

  const setLoopEndAt = useCallback(
    (t: number) => {
      const v = snapTime(t);
      setLoopEnabled(false);

      setLoopEnd(() => {
        const nextEnd = v;

        setLoopStart((prevStart) => {
          if (prevStart === null) return prevStart;
          if (nextEnd <= prevStart) {
            return clamp(nextEnd - stepDuration, 0, duration);
          }
          return prevStart;
        });

        return nextEnd;
      });
    },
    [duration, snapTime, stepDuration]
  );

  const handleGridTimeAction = useCallback(
    (t: number) => {
      const target = snapTime(t);

      if (mode === null) {
        seekTo(target);
        return;
      }

      if (mode === "setLoopStart") {
        setLoopStartAt(target);
        setMode(null);
        return;
      }

      if (mode === "setLoopEnd") {
        setLoopEndAt(target);
        setMode(null);
        return;
      }
    },
    [mode, seekTo, setLoopEndAt, setLoopStartAt, snapTime]
  );

  const currentBar = scoreSyncBar;
  const maxLoopInputValue = totalSteps * stepDuration;

  const syncPlaybackPosition = useCallback(
    (nextTime: number) => {
      const clampedTime = clamp(nextTime, 0, playbackDuration);
      setCurrentTime(clampedTime);
    },
    [playbackDuration]
  );

  const syncFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (trackSwitchInProgressRef.current || isScrubbingRef.current) return;

    const audioTime = audio.currentTime;

    if (hasLoop && loopStart !== null && loopEnd !== null) {
      if (audioTime < loopStart || audioTime >= loopEnd) {
        audio.currentTime = loopStart;
        syncPlaybackPosition(loopStart);
        return;
      }
    }

    syncPlaybackPosition(audioTime);
  }, [hasLoop, loopEnd, loopStart, syncPlaybackPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const tick = () => {
      syncFromAudio();
      rafRef.current = requestAnimationFrame(tick);
    };

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, syncFromAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncOnAudioEvent = () => {
      if (trackSwitchInProgressRef.current || isScrubbingRef.current) return;
      syncFromAudio();
    };

    const onEnded = () => {
      audio.pause();
      clearCountInTimers();
      resetMetronomeTracking();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resumePlaybackAfterScrubRef.current = false;
      isScrubbingRef.current = false;
      syncPlaybackPosition(audio.duration || audio.currentTime || playbackDuration);
      setIsPlaying(false);
      setCountInActive(false);
      setCountInBeat(1);
    };

    audio.addEventListener("timeupdate", syncOnAudioEvent);
    audio.addEventListener("seeking", syncOnAudioEvent);
    audio.addEventListener("seeked", syncOnAudioEvent);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", syncOnAudioEvent);
      audio.removeEventListener("seeking", syncOnAudioEvent);
      audio.removeEventListener("seeked", syncOnAudioEvent);
      audio.removeEventListener("ended", onEnded);
    };
  }, [clearCountInTimers, playbackDuration, resetMetronomeTracking, syncFromAudio, syncPlaybackPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = playbackSpeed;
    audio.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Audio lifecycle logging and error handling
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      audio.defaultPlaybackRate = playbackSpeed;
      audio.playbackRate = playbackSpeed;
      if (!trackSwitchInProgressRef.current) {
        syncPlaybackPosition(audio.currentTime);
      }
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      // console.log("audio loadedmetadata", { duration: audio.duration, src: audio.src });
    };

    const onCanPlay = () => {
      audio.defaultPlaybackRate = playbackSpeed;
      audio.playbackRate = playbackSpeed;
      if (!trackSwitchInProgressRef.current) {
        syncPlaybackPosition(audio.currentTime);
      }
      // console.log("audio canplay", { src: audio.src });
    };

    const onError = (ev: any) => {
      console.error("audio error event", ev, "audio.error:", audio.error, { src: audio.src });
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
    };
  }, [playbackSpeed, syncPlaybackPosition]);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const ensureMetronomeGain = useCallback((ctx: AudioContext) => {
    if (!metronomeGainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = metronomeVolume;
      gain.connect(ctx.destination);
      metronomeGainRef.current = gain;
    }
    return metronomeGainRef.current;
  }, [metronomeVolume]);

  useEffect(() => {
    const ctx = audioContextRef.current;
    const gain = metronomeGainRef.current;
    if (!ctx || !gain) return;

    gain.gain.setTargetAtTime(metronomeVolume, ctx.currentTime, 0.01);
  }, [metronomeVolume]);

  const beep = useCallback(
    (accent: boolean) => {
      const ctx = ensureAudioContext();

      if (ctx.state !== "running") return;

      const metroGain = ensureMetronomeGain(ctx);

      const osc = ctx.createOscillator();
      const clickGain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = accent ? 1200 : 800;

      clickGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(accent ? 0.34 : 0.24, ctx.currentTime + 0.004);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);

      osc.connect(clickGain);
      clickGain.connect(metroGain);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.07);
    },
    [ensureAudioContext, ensureMetronomeGain]
  );

  useEffect(() => {
    if (!metronomeEnabled || !isPlaying || countInActive) {
      lastMetroBeatRef.current = -1;
      lastMetroAudioTimeRef.current = 0;
      return;
    }

    const audioTime = audioRef.current?.currentTime ?? currentTime;
    if (audioTime + 0.001 < lastMetroAudioTimeRef.current) {
      // Seek or loop wrap moved backward; re-arm beat edge detection.
      lastMetroBeatRef.current = -1;
    }
    lastMetroAudioTimeRef.current = audioTime;

    const beatIndex = Math.floor(audioTime / secondsPerBeat);

    if (beatIndex !== lastMetroBeatRef.current) {
      lastMetroBeatRef.current = beatIndex;
      const accent = beatIndex % beatsPerBar === 0;
      beep(accent);
    }
  }, [beep, beatsPerBar, countInActive, currentTime, isPlaying, metronomeEnabled, secondsPerBeat]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        (target as HTMLElement | null)?.isContentEditable;

      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        seekTo(hasLoop && loopStart !== null ? loopStart : 0);
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        setLoopStartAt(currentTime);
        return;
      }

      if (e.key === "]") {
        e.preventDefault();
        setLoopEndAt(currentTime);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        clearLoop();
        return;
      }


      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        setMetronomeEnabled((v) => !v);
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const delta = e.shiftKey ? secondsPerBeat * beatsPerBar : secondsPerBeat;
        seekToSnapped(currentTime - delta);
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        const delta = e.shiftKey ? secondsPerBeat * beatsPerBar : secondsPerBeat;
        seekToSnapped(currentTime + delta);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clearLoop,
    currentTime,
    hasLoop,
    loopStart,
    seekTo,
    seekToSnapped,
    secondsPerBeat,
    beatsPerBar,
    setLoopEndAt,
    setLoopStartAt,
    togglePlay,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const pendingSwitch = pendingSourceSwitchRef.current;

    const applySourceState = async () => {
      const targetTime = pendingSwitch
        ? clamp(
            pendingSwitch.time,
            0,
            Number.isFinite(audio.duration) ? audio.duration : playbackDuration
          )
        : 0;

      audio.currentTime = targetTime;
      syncPlaybackPosition(targetTime);
      trackSwitchInProgressRef.current = false;
      setTrackSwitchDisplayTime(null);

      if (!pendingSwitch?.shouldResume) {
        setIsPlaying(false);
        return;
      }

      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("audio play failed after source switch:", err);
        setIsPlaying(false);
      }
    };

    const handleCanPlay = () => {
      pendingSourceSwitchRef.current = null;
      void applySourceState();
    };

    audio.load();

    if (pendingSwitch) {
      audio.addEventListener("canplay", handleCanPlay, { once: true });
      return () => {
        audio.removeEventListener("canplay", handleCanPlay);
      };
    }

    trackSwitchInProgressRef.current = false;
    setTrackSwitchDisplayTime(null);
    audio.currentTime = 0;
    syncPlaybackPosition(0);
  }, [audioSrc, playbackDuration, syncPlaybackPosition]);

  useEffect(() => {
    return () => {
      clearCountInTimers();
      if (importedAudioUrl) URL.revokeObjectURL(importedAudioUrl);
    };
  }, [clearCountInTimers, importedAudioUrl]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111318",
        color: "#f3f4f6",
        padding: 24,
        boxSizing: "border-box",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <audio ref={audioRef} src={audioSrc} preload="auto" />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        onChange={handleAudioFileChange}
        style={{ display: "none" }}
      />

      <div
        style={{
          maxWidth: 1500,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>drum-visualizer</h1>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "0 2px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  color: "#cbd5e1",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {audioTitle}
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#94a3b8",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                <span>轨道类型</span>
                <select
                  value={selectedTrackType}
                  onChange={handleTrackTypeChange}
                  style={{
                    border: "1px solid #344155",
                    background: "#202735",
                    color: "#e5e7eb",
                    borderRadius: 9,
                    padding: "6px 10px",
                    fontSize: 13,
                    fontWeight: 500,
                    outline: "none",
                  }}
                >
                  {TRACK_TYPE_OPTIONS.map((trackType) => (
                    <option key={trackType.id} value={trackType.id}>
                      {trackType.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div
              ref={scrubBarRef}
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              onPointerCancel={handleScrubPointerCancel}
              onLostPointerCapture={handleScrubLostPointerCapture}
              style={{
                position: "relative",
                height: 14,
                borderRadius: 999,
                background: "rgba(51, 65, 85, 0.72)",
                boxShadow: "inset 0 0 0 1px rgba(71, 85, 105, 0.55)",
                cursor: "pointer",
                touchAction: "none",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${playbackProgress * 100}%`,
                  background: "linear-gradient(90deg, rgba(96, 165, 250, 0.88) 0%, rgba(125, 211, 252, 0.92) 100%)",
                  borderRadius: 999,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
              >
                {scrubBarMarkers.map((barIndex) => {
                  const leftPercent = bars > 0 ? (barIndex / bars) * 100 : 0;
                  const isEdge = barIndex === 0;

                  return (
                    <span
                      key={barIndex}
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPercent}%`,
                        width: 12,
                        transform: isEdge ? "none" : "translateX(-6px)",
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          bottom: 2,
                          left: "50%",
                          width: 1,
                          background: "rgba(226, 232, 240, 0.42)",
                          transform: "translateX(-50%)",
                        }}
                      />
                    </span>
                  );
                })}
              </div>
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `calc(${playbackProgress * 100}% - 6px)`,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#f8fafc",
                  boxShadow: "0 0 0 2px rgba(15, 23, 42, 0.45)",
                  transform: "translateY(-50%)",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 12,
                color: "#94a3b8",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span>{formattedCurrentTime}</span>
              <span>{formattedDisplayedDuration}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={openAudioPicker}
            style={{
              border: "1px solid #344155",
              background: "#202735",
              color: "#e5e7eb",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            导入音频
          </button>
        </div>

        <div
          style={{
            background: "#1a1f29",
            border: "1px solid #2a3140",
            borderRadius: 14,
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <button onClick={togglePlay} style={buttonStyle(isPlaying)}>
                {isPlaying ? "暂停" : "播放"}
              </button>

              <button
                onClick={handleReturnToStart}
                style={buttonStyle(false)}
              >
                回到起点
              </button>

              <button
                onClick={() => setMetronomeEnabled((v) => !v)}
                style={buttonStyle(metronomeEnabled, "metronome")}
              >
                节拍器
              </button>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#94a3b8",
                  fontSize: 12,
                }}
              >
                <span>音量</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={metronomeVolume}
                  onChange={(e) => setMetronomeVolume(Number(e.target.value))}
                  style={{ width: 110 }}
                />
                <span style={{ minWidth: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(metronomeVolume * 100)}%
                </span>
              </div>
            </div>

          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              padding: 16,
              background: "linear-gradient(180deg, #161c27 0%, #131923 100%)",
              border: "1px solid #334155",
              borderRadius: 14,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                width: "fit-content",
                maxWidth: "100%",
                padding: 8,
                background: "rgba(15, 20, 28, 0.78)",
                border: "1px solid rgba(71, 85, 105, 0.55)",
                borderRadius: 12,
              }}
            >
              <button
                onClick={() => setMode("setLoopStart")}
                style={buttonStyle(mode === "setLoopStart")}
              >
                {mode === "setLoopStart" ? "确定循环开始" : "设置循环开始"}
              </button>

              <input
                type="number"
                step={stepDuration}
                min={0}
                max={maxLoopInputValue}
                aria-label="Loop Start"
                value={loopStart ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setLoopEnabled(false);
                    setLoopStart(null);
                    return;
                  }
                  setLoopStartAt(clamp(Number(v), 0, maxLoopInputValue));
                }}
                style={{
                  ...inputStyle,
                  width: 112,
                  minWidth: 112,
                  maxWidth: 112,
                  flex: "0 0 112px",
                  borderRadius: 10,
                  border: "1px solid #475569",
                  background: "#111722",
                  padding: "0 12px",
                }}
              />

              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1,
                  height: 42,
                  width: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 20px",
                }}
              >
                →
              </div>

              <input
                type="number"
                step={stepDuration}
                min={0}
                max={maxLoopInputValue}
                aria-label="Loop End"
                value={loopEnd ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setLoopEnabled(false);
                    setLoopEnd(null);
                    return;
                  }
                  setLoopEndAt(clamp(Number(v), 0, maxLoopInputValue));
                }}
                style={{
                  ...inputStyle,
                  width: 112,
                  minWidth: 112,
                  maxWidth: 112,
                  flex: "0 0 112px",
                  borderRadius: 10,
                  border: "1px solid #475569",
                  background: "#111722",
                  padding: "0 12px",
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              />

              <button
                onClick={() => setMode("setLoopEnd")}
                style={buttonStyle(mode === "setLoopEnd")}
              >
                {mode === "setLoopEnd" ? "确定循环结束" : "设置循环结束"}
              </button>

              <button
                onClick={applyLoop}
                disabled={!hasLoopRange}
                style={{
                  ...buttonStyle(hasLoop),
                  opacity: hasLoopRange ? 1 : 0.45,
                  cursor: hasLoopRange ? "pointer" : "not-allowed",
                }}
              >
                应用循环
              </button>

              <button
                onClick={clearLoop}
                style={{
                  ...buttonStyle(false),
                  background: "rgba(22, 28, 39, 0.58)",
                  color: "#94a3b8",
                  border: "1px solid rgba(71, 85, 105, 0.75)",
                  fontWeight: 500,
                }}
              >
                清除循环
              </button>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: 6,
                background: "#0f141c",
                border: "1px solid #334155",
                borderRadius: 10,
                minHeight: 54,
              }}
            >
              <button onClick={decreasePlaybackSpeed} style={buttonStyle(false)}>
                -0.1
              </button>
              <div
                style={{
                  background: "#141923",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  height: 42,
                  padding: "0 14px",
                  fontWeight: 800,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 82,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box",
                  letterSpacing: 0.2,
                }}
              >
                {playbackSpeed.toFixed(1)}x
              </div>
              <button onClick={increasePlaybackSpeed} style={buttonStyle(false)}>
                +0.1
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setViewMode("raw")}
                style={{
                  ...buttonStyle(viewMode === "raw"),
                  padding: 8,
                }}
              >
                原始
              </button>

              <button
                onClick={() => setViewMode("practice")}
                style={{
                  ...buttonStyle(viewMode === "practice"),
                  padding: 8,
                }}
              >
                练习
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            <InfoCard label="BPM" value={String(bpm)} />
            <InfoCard label="当前时间" value={`${currentTime.toFixed(3)}s`} />
            <InfoCard label="当前 Step" value={`${scoreSyncStep} / ${totalSteps - 1}`} />
            <InfoCard label="当前小节" value={`${currentBar + 1} / ${bars}`} />
            <InfoCard label="总时长" value={`${displayedDuration.toFixed(1)}s`} />
          </div>

          <div
            style={{
              background: "#141923",
              border: "1px solid #283142",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>小节导航</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {Array.from({ length: bars }).map((_, i) => {
                const active = i === currentBar;
                return (
                  <button
                    key={i}
                    onClick={() => jumpToBar(i)}
                    style={{
                      background: active ? "#3b82f6" : "#202735",
                      color: "#fff",
                      border: "1px solid " + (active ? "#60a5fa" : "#344155"),
                      borderRadius: 8,
                      padding: "8px 10px",
                      cursor: "pointer",
                      fontWeight: 700,
                      minWidth: 54,
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section
          style={{
            background: "linear-gradient(180deg, #151b25 0%, #10161f 100%)",
            border: "1px solid #2b3444",
            borderRadius: 18,
            padding: 20,
            display: "grid",
            gap: 18,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: 0.2,
              }}
            >
              Fake Notation Preview
            </div>
            <div
              style={{
                color: "#94a3b8",
                fontSize: 13,
                lineHeight: 1.6,
                maxWidth: 760,
              }}
            >
              Static hand-built preview cards for checking hierarchy, symbols, and
              groove feel before any real notation rendering is wired into the product.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            {fakeNotationPreviewSections.map((section) => (
              <FakeNotationPreviewCard key={section.id} section={section} />
            ))}
          </div>
        </section>

        <ScoreViewWithMidiDebug
          notesByStep={notesByStep}
          duration={duration}
          bpm={bpm}
          beatsPerBar={beatsPerBar}
          stepsPerBeat={stepsPerBeat}
          currentTime={scoreSyncTime}
          currentStep={scoreSyncStep}
          loopStart={loopStart}
          loopEnd={loopEnd}
          hasLoop={hasLoop}
          trackSteps={midiStepMap}
          onGridTimeAction={handleGridTimeAction}
          onSeek={seekToBarTime}
          countInActive={countInActive}
          countInBeat={countInBeat}
          metronomeActive={metronomeDotActive}
          metronomeBeat={metronomeDotBeat}
          onSetLoopStart={setLoopStartAt}
          onSetLoopEnd={setLoopEndAt}
          snapTime={snapTime}
          onMiniMapSeek={seekToSnapped}
        />
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#141923",
        border: "1px solid #283142",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function FakeNotationPreviewCard({
  section,
}: {
  section: FakeNotationPreviewSection;
}) {
  const previewEvents = useMemo(
    () =>
      section.events
        .map((event) => {
          const lane = getV1NotationLane(event.instrument, event.articulation);

          if (lane === "UNASSIGNED") {
            return null;
          }

          return {
            ...event,
            lane,
            top: getFakeNotationPreviewVisualTop(lane),
            leftPercent: getFakeNotationPreviewStepLeftPercent(event.stepIndex),
          };
        })
        .filter(
          (
            value
          ): value is FakeNotationPreviewEvent & {
            lane: FakeNotationPreviewLaneId;
            top: number;
            leftPercent: number;
          } => value !== null
        ),
    [section.events]
  );

  const usedLaneIds = useMemo(
    () => new Set(previewEvents.map((event) => event.lane)),
    [previewEvents]
  );

  return (
    <article
      style={{
        background: "linear-gradient(180deg, rgba(19, 24, 34, 0.98) 0%, rgba(13, 18, 27, 0.98) 100%)",
        border: "1px solid rgba(71, 85, 105, 0.32)",
        borderRadius: 18,
        padding: 18,
        display: "grid",
        gap: 16,
        boxShadow: "0 18px 36px rgba(2, 6, 23, 0.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{section.title}</div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            {section.description}
          </div>
        </div>

        <div
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            background: "rgba(30, 41, 59, 0.72)",
            border: "1px solid rgba(71, 85, 105, 0.35)",
            color: "#94a3b8",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          2-bar preview
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(180deg, #f6efdf 0%, #efe5d2 100%)",
          border: "1px solid rgba(146, 120, 88, 0.4)",
          borderRadius: 16,
          padding: 14,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "72px minmax(0, 1fr)",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div
            style={{
              position: "relative",
              height: FAKE_NOTATION_PREVIEW_CANVAS_HEIGHT + 34,
              paddingTop: 34,
            }}
          >
            {FAKE_NOTATION_PREVIEW_LANES.map((lane) => {
              const active = usedLaneIds.has(lane.id);

              return (
                <div
                  key={lane.id}
                  style={{
                    position: "absolute",
                    top: getFakeNotationPreviewVisualTop(lane.id) + 26,
                    left: 0,
                    transform: "translateY(-50%)",
                    color: active ? "#4b5563" : "#9ca3af",
                    fontSize: 11,
                    fontWeight: active ? 700 : 600,
                    letterSpacing: 0.2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {lane.label}
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                position: "relative",
                height: 26,
                color: "#7c6d56",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
              }}
            >
              {[0, 16].map((stepIndex, barIndex) => (
                <div
                  key={`bar-${stepIndex}`}
                  style={{
                    position: "absolute",
                    left: `${(stepIndex / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100}%`,
                    width: `${(16 / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100}%`,
                    transform: barIndex === 0 ? "none" : "translateX(1px)",
                    textAlign: "center",
                  }}
                >
                  Bar {barIndex + 1}
                </div>
              ))}

              {[0, 4, 8, 12, 16, 20, 24, 28].map((stepIndex) => (
                <div
                  key={`beat-${stepIndex}`}
                  style={{
                    position: "absolute",
                    left: `${((stepIndex + 2) / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100}%`,
                    top: 12,
                    transform: "translateX(-50%)",
                    color: "#8b7355",
                    fontSize: 10,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {(stepIndex / 4) % 4 + 1}
                </div>
              ))}
            </div>

            <div
              style={{
                position: "relative",
                height: FAKE_NOTATION_PREVIEW_CANVAS_HEIGHT,
              }}
            >
              {FAKE_NOTATION_PREVIEW_STAFF_LINE_POSITIONS.map((top, index) => (
                <div
                  key={`staff-line-${index}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height: 1.5,
                    background: "rgba(82, 67, 47, 0.42)",
                  }}
                />
              ))}

              {[18, 176, 198].map((top, index) => (
                <div
                  key={`guide-${index}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height: 1,
                    background: "rgba(120, 104, 82, 0.16)",
                    borderTop: "1px dashed rgba(120, 104, 82, 0.24)",
                  }}
                />
              ))}

              {[0, 16, 32].map((stepIndex) => (
                <div
                  key={`barline-${stepIndex}`}
                  style={{
                    position: "absolute",
                    top: 10,
                    bottom: 10,
                    left: `${(stepIndex / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100}%`,
                    width: stepIndex === 0 || stepIndex === 32 ? 2 : 1.5,
                    transform: stepIndex === 32 ? "translateX(-2px)" : "none",
                    background: "rgba(82, 67, 47, 0.45)",
                  }}
                />
              ))}

              {[4, 8, 12, 20, 24, 28].map((stepIndex) => (
                <div
                  key={`beat-guide-${stepIndex}`}
                  style={{
                    position: "absolute",
                    top: 14,
                    bottom: 14,
                    left: `${(stepIndex / FAKE_NOTATION_PREVIEW_STEP_COUNT) * 100}%`,
                    borderLeft: "1px dashed rgba(120, 104, 82, 0.26)",
                  }}
                />
              ))}

              {previewEvents.map((event) => (
                <div
                  key={`${event.instrument}:${event.articulation}:${event.stepIndex}`}
                  style={{
                    position: "absolute",
                    top: event.top,
                    left: `${event.leftPercent}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <FakeNotationPreviewGlyph event={event} lane={event.lane} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              color: "#8b7355",
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            Static notation-style preview only. This card is intentionally detached from
            the real score pipeline.
          </div>

          <FakeNotationPreviewKitHint usedLaneIds={usedLaneIds} />
        </div>
      </div>
    </article>
  );
}

function FakeNotationPreviewGlyph({
  event,
  lane,
}: {
  event: FakeNotationPreviewEvent;
  lane: FakeNotationPreviewLaneId;
}) {
  const tone = getFakeNotationPreviewTone(lane);
  const isHiHatOpen = event.instrument === "HH" && event.articulation === "open";
  const isHiHatPedal = event.instrument === "HH" && event.articulation === "pedal";
  const isGhostSnare = event.instrument === "SD" && event.articulation === "ghost";
  const isBassDrum = lane === "BD";
  const isCymbalFamily = ["CR", "RD", "HH", "HH_PEDAL"].includes(lane);
  const crossSize = lane === "CR" ? 16 : lane === "RD" ? 13 : 12;

  return (
    <div
      style={{
        position: "relative",
        width: 28,
        height: 28,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 6,
          borderRadius: "50%",
          background: tone.glow,
          filter: "blur(6px)",
          opacity: 0.9,
        }}
      />

      {isCymbalFamily ? (
        <>
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: isHiHatPedal ? 8 : 5,
              width: 1.5,
              height: isHiHatPedal ? 10 : 18,
              background: tone.ink,
              transform: "translateX(-50%)",
              borderRadius: 999,
              opacity: 0.9,
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: isHiHatPedal ? "40%" : "50%",
              width: crossSize,
              height: 2,
              background: tone.ink,
              transform: "translate(-50%, -50%) rotate(45deg)",
              borderRadius: 999,
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: isHiHatPedal ? "40%" : "50%",
              width: crossSize,
              height: 2,
              background: tone.ink,
              transform: "translate(-50%, -50%) rotate(-45deg)",
              borderRadius: 999,
            }}
          />

          {lane === "CR" ? (
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: 2,
                width: 18,
                height: 1.5,
                background: tone.accent,
                transform: "translateX(-50%)",
                borderRadius: 999,
              }}
            />
          ) : null}

          {lane === "RD" ? (
            <span
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: tone.accent,
              }}
            />
          ) : null}

          {isHiHatOpen ? (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 1,
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: `1.5px solid ${tone.accent}`,
                background: "rgba(246, 239, 223, 0.88)",
              }}
            />
          ) : null}

          {isHiHatPedal ? (
            <span
              style={{
                position: "absolute",
                left: "50%",
                bottom: 0,
                transform: "translateX(-50%)",
                color: tone.ink,
                fontSize: 7,
                fontWeight: 800,
                letterSpacing: 0.15,
                textTransform: "uppercase",
              }}
            >
              ped
            </span>
          ) : null}
        </>
      ) : (
        <>
          {!isBassDrum ? (
            <span
              style={{
                position: "absolute",
                left: "61%",
                top: 3,
                width: 1.5,
                height: 18,
                background: tone.ink,
                borderRadius: 999,
              }}
            />
          ) : null}

          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: isBassDrum ? 18 : 14,
              height: isBassDrum ? 12 : 10,
              background: isGhostSnare ? "rgba(246, 239, 223, 0.9)" : tone.ink,
              border: `1.5px solid ${tone.ink}`,
              borderRadius: "50%",
              boxShadow: `0 0 0 2px ${tone.soft}`,
              transform: "translate(-50%, -50%) rotate(-18deg)",
            }}
          />

          {lane === "TM_HIGH" || lane === "TM_MID" || lane === "TM_FLOOR" ? (
            <span
              style={{
                position: "absolute",
                top: 4,
                right: 3,
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: tone.accent,
              }}
            />
          ) : null}

          {isGhostSnare ? (
            <span
              style={{
                position: "absolute",
                left: "50%",
                bottom: 0,
                transform: "translateX(-50%)",
                color: tone.ink,
                fontSize: 7,
                fontWeight: 800,
                letterSpacing: 0.1,
              }}
            >
              g
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function FakeNotationPreviewKitHint({
  usedLaneIds,
}: {
  usedLaneIds: Set<FakeNotationPreviewLaneId>;
}) {
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
      <div
        style={{
          color: "#8b7355",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Kit Hint
      </div>

      <div
        style={{
          position: "relative",
          width: 150,
          height: 116,
          borderRadius: 16,
          background: "linear-gradient(180deg, rgba(255, 248, 235, 0.58) 0%, rgba(240, 230, 211, 0.82) 100%)",
          border: "1px solid rgba(146, 120, 88, 0.28)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.52)",
        }}
      >
        {FAKE_NOTATION_PREVIEW_KIT_HINT_ITEMS.map((item) => {
          const active = usedLaneIds.has(item.id);
          const tone = getFakeNotationPreviewTone(item.id);
          const isBassDrum = item.id === "BD";

          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                left: item.left,
                top: item.top,
                transform: "translate(-50%, -50%)",
                display: "grid",
                justifyItems: "center",
                gap: 3,
              }}
            >
              <span
                style={{
                  width: isBassDrum ? 24 : 16,
                  height: isBassDrum ? 19 : 16,
                  borderRadius: "50%",
                  background: active ? tone.soft : "rgba(148, 163, 184, 0.08)",
                  border: `1.5px solid ${
                    active ? tone.accent : "rgba(148, 163, 184, 0.26)"
                  }`,
                  boxShadow: active ? `0 0 0 2px ${tone.glow}` : "none",
                }}
              />
              <span
                style={{
                  color: active ? tone.ink : "#94a3b8",
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: 0.15,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buttonStyle(active: boolean, tone: "default" | "metronome" = "default"): React.CSSProperties {
  const isMetronome = tone === "metronome";

  return {
    background: active ? (isMetronome ? "#14b8a6" : "#3b82f6") : "#202735",
    color: active ? "#f8fafc" : "#fff",
    border: "1px solid " + (active ? (isMetronome ? "#5eead4" : "#60a5fa") : "#344155"),
    borderRadius: 10,
    minHeight: 42,
    padding: "0 14px",
    cursor: "pointer",
    fontWeight: active ? 700 : 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    boxShadow: active && isMetronome ? "0 0 0 1px rgba(94, 234, 212, 0.24), 0 8px 18px rgba(20, 184, 166, 0.22)" : "none",
  };
}

const inputStyle: React.CSSProperties = {
  background: "#0f141c",
  color: "#fff",
  border: "1px solid #334155",
  borderRadius: 8,
  height: 42,
  padding: "0 10px",
  minWidth: 140,
  boxSizing: "border-box",
};