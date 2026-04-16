import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Midi } from "@tonejs/midi";
import ScoreView from "./components/ScoreView";
import drumDataRaw from "./drum_events.json";

type TrackName = "HH" | "SD" | "BD";

type DrumEvent = {
  time: number;
  track: TrackName;
};

type BasicDrumInstrument = "BD" | "SD" | "HH" | "CR" | "RD" | "TM_HIGH" | "TM_MID" | "TM_FLOOR";

type MappedDrumInfo = {
  instrument: BasicDrumInstrument;
  articulation: "normal" | "closed" | "pedal" | "open";
};

type V3TempDrumEvent = {
  time: number;
  stepIndex: number;
  beatIndex: number;
  barIndex: number;
  instrument: BasicDrumInstrument | "UNMAPPED";
  articulation: MappedDrumInfo["articulation"] | "unknown";
  velocity: number;
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

function mapMidiNoteToDrumInfo(midiNote: number): MappedDrumInfo | null {
  if (midiNote === 36) return { instrument: "BD", articulation: "normal" };
  if (midiNote === 38) return { instrument: "SD", articulation: "normal" };
  if (midiNote === 42) return { instrument: "HH", articulation: "closed" };
  if (midiNote === 44) return { instrument: "HH", articulation: "pedal" };
  if (midiNote === 46) return { instrument: "HH", articulation: "open" };
  if (midiNote === 49) return { instrument: "CR", articulation: "normal" };
  if (midiNote === 51) return { instrument: "RD", articulation: "normal" };
  if (midiNote === 48 || midiNote === 50) return { instrument: "TM_HIGH", articulation: "normal" };
  if (midiNote === 45 || midiNote === 47) return { instrument: "TM_MID", articulation: "normal" };
  if (midiNote === 41 || midiNote === 43) return { instrument: "TM_FLOOR", articulation: "normal" };
  return null;
}

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
  const [midiDrumEvents, setMidiDrumEvents] = useState<V3TempDrumEvent[]>([]);
  const [activeCymbal, setActiveCymbal] = useState<"HH" | "RD">("HH");

  const midiStepMap = useMemo(() => {
    const map: Record<TrackName, Set<number>> = {
      HH: new Set<number>(),
      SD: new Set<number>(),
      BD: new Set<number>(),
    };

    for (const event of midiDrumEvents) {
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
  }, [midiDrumEvents, stepDuration, totalSteps]);

  useEffect(() => {
    console.log("[MIDI V3] midiStepMap", midiStepMap);
  }, [midiStepMap]);

  useEffect(() => {
    let cancelled = false;

    const loadMidiPreview = async () => {
      try {
        const response = await fetch(encodeURI("/midi/080 Half-Time Pop Ride.mid"));
        if (!response.ok) {
          throw new Error(`Failed to fetch MIDI: ${response.status} ${response.statusText}`);
        }

        const midiBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const midi = new Midi(midiBuffer);
        const firstTrack = midi.tracks[0];

        if (!firstTrack) {
          console.log("[MIDI V3] No tracks found in /midi/080 Half-Time Pop Ride.mid");
          return;
        }

        const first20Notes = firstTrack.notes.slice(0, 20).map((note) => ({
          time: note.time,
          midi: note.midi,
        }));

        const normalizedV3DrumEvents: V3TempDrumEvent[] = firstTrack.notes.map((note) => {
          const mapped = mapMidiNoteToDrumInfo(note.midi);
          const si = Math.round(note.time / stepDuration);
          const bi = Math.floor(si / stepsPerBeat);

          return {
            time: note.time,
            stepIndex: si,
            beatIndex: bi,
            barIndex: Math.floor(bi / beatsPerBar),
            instrument: mapped?.instrument ?? "UNMAPPED",
            articulation: mapped?.articulation ?? "unknown",
            velocity: note.velocity,
          };
        });

        setMidiDrumEvents(normalizedV3DrumEvents);
        console.log("[MIDI V3] quantized sample", normalizedV3DrumEvents.slice(0, 20));
        console.log("[MIDI V3] bar/beat sample", normalizedV3DrumEvents.slice(0, 20));

        const first20MappedDrumEvents = normalizedV3DrumEvents.slice(0, 20);

        console.log("[MIDI V3] First-track first 20 notes", first20Notes);
        console.log("[MIDI V3] First-track first 20 mapped drum events", first20MappedDrumEvents);

        const instrumentCounts = normalizedV3DrumEvents.reduce((acc, ev) => {
          acc[ev.instrument] = (acc[ev.instrument] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log("[MIDI V3] instrument counts", instrumentCounts);

        const detectedCymbal: "HH" | "RD" =
          (instrumentCounts["RD"] ?? 0) > (instrumentCounts["HH"] ?? 0) ? "RD" : "HH";
        setActiveCymbal(detectedCymbal);
        console.log("[MIDI V3] active cymbal", detectedCymbal);

        // --- V3 step 20: validate CR / RD events ---
        const crEvents = normalizedV3DrumEvents.filter((e) => e.instrument === "CR");
        const rdEvents = normalizedV3DrumEvents.filter((e) => e.instrument === "RD");

        const densityMetric = (events: V3TempDrumEvent[], label: string) => {
          if (events.length < 2) return 0;
          const span = events[events.length - 1].time - events[0].time;
          const density = span > 0 ? events.length / span : 0;
          console.log(
            `[MIDI V3] ${label}: ${events.length} events, span ${span.toFixed(1)}s, density ${density.toFixed(2)} events/s`
          );
          return density;
        };

        const crDensity = densityMetric(crEvents, "CR (crash)");
        densityMetric(rdEvents, "RD (ride)");

        // Warn if CR density looks too high (crashes should be sparse)
        if (crDensity > 2) {
          console.warn(
            `[MIDI V3] CR density ${crDensity.toFixed(2)} events/s is unusually high — some events may be misclassified`
          );
        }

        // Check for CR bursts: >3 crashes within any 2-second window
        for (let i = 0; i < crEvents.length; i++) {
          const windowEnd = crEvents[i].time + 2;
          let count = 0;
          for (let j = i; j < crEvents.length && crEvents[j].time <= windowEnd; j++) {
            count++;
          }
          if (count > 3) {
            console.warn(
              `[MIDI V3] CR burst: ${count} crashes within 2s starting at ${crEvents[i].time.toFixed(2)}s — likely misclassified`
            );
            break;
          }
        }

        // --- V3 step 21: detect HH vs RD overlaps ---
        const hhEvents = normalizedV3DrumEvents.filter((e) => e.instrument === "HH");
        const overlapThreshold = 0.02;
        const overlaps: Array<{ time: number; hh: V3TempDrumEvent; rd: V3TempDrumEvent }> = [];
        let rdIdx = 0;
        for (const hh of hhEvents) {
          while (rdIdx < rdEvents.length && rdEvents[rdIdx].time < hh.time - overlapThreshold) {
            rdIdx++;
          }
          for (
            let j = rdIdx;
            j < rdEvents.length && rdEvents[j].time <= hh.time + overlapThreshold;
            j++
          ) {
            overlaps.push({ time: hh.time, hh, rd: rdEvents[j] });
          }
        }
        console.log("[MIDI V3] HH/RD overlap count", overlaps.length);
        if (overlaps.length > 0) {
          console.log("[MIDI V3] HH/RD overlap sample", overlaps.slice(0, 5));
        }
      } catch (error) {
        console.error("[MIDI V3] Failed to load or parse MIDI", error);
      }
    };

    void loadMidiPreview();

    return () => {
      cancelled = true;
    };
  }, []);

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

        console.log("play() called -- attempting audio.play()", { src: audio.src });
        try {
          await audio.play();
          console.log("play() succeeded");
          setIsPlaying(true);
        } catch (err) {
          console.error("audio play failed:", err);
        }
      }, secondsPerBar * 1000);

      return;
    }

    console.log("play() called -- attempting audio.play()", { src: audio.src });
    try {
      await audio.play();
      console.log("play() succeeded");
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
    console.log("pause() called");
    audio.pause();
    console.log("pause() executed");
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
      console.log("audio loadedmetadata", { duration: audio.duration, src: audio.src });
    };

    const onCanPlay = () => {
      audio.defaultPlaybackRate = playbackSpeed;
      audio.playbackRate = playbackSpeed;
      if (!trackSwitchInProgressRef.current) {
        syncPlaybackPosition(audio.currentTime);
      }
      console.log("audio canplay", { src: audio.src });
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

        <ScoreViewWithMidiDebug
          midiDebugEvents={midiDrumEvents}
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
          activeCymbal={activeCymbal}
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