import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScoreView from "./components/ScoreView";
import drumDataRaw from "./drum_events.json";

type TrackName = "HH" | "SD" | "BD";

type DrumEvent = {
  time: number;
  track: TrackName;
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

type TrackTypeId = "original" | "drums" | "guitar";

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
  { id: "guitar", label: "吉他轨" },
];

const TARGET_TEST_BAR_COUNT = 32;
const DEFAULT_BEATS_PER_BAR = 4;

const PRACTICE_CONTENT: PracticeContent = {
  title: "Billie Jean",
  scoreData: drumDataRaw as DrumDataShape,
  trackTypes: {
    original: { label: "原曲", audioSrc: "/audio/billie-jean.wav" },
    drums: { label: "鼓轨", audioSrc: "/audio/billie-jean.wav" },
    guitar: { label: "吉他轨", audioSrc: "/audio/billie-jean.wav" },
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

export default function App() {
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

  const [currentTime, setCurrentTime] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [importedAudioUrl, setImportedAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);

  const [mode, setMode] = useState<EditMode>(null);

  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);

  const snapEnabled = true;
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const [stepWidth, setStepWidth] = useState(28);
  const [zoom, setZoom] = useState(1);

  const audioContextRef = useRef<AudioContext | null>(null);
  const lastMetroBeatRef = useRef<number>(-1);

  const hasLoop = loopStart !== null && loopEnd !== null && loopEnd > loopStart;
  const audioTitle = selectedAudioFile?.name ?? `${PRACTICE_CONTENT.title} · ${currentTrackType.label}`;
  const audioSrc = importedAudioUrl ?? encodeURI(currentTrackType.audioSrc);
  const displayedDuration = audioDuration ?? duration;
  const playbackDuration = audioDuration ?? duration;
  const playbackProgress = playbackDuration > 0 ? clamp(currentTime / playbackDuration, 0, 1) : 0;
  const scrubBarMarkers = useMemo(
    () => Array.from({ length: Math.max(bars, 1) }, (_, barIndex) => barIndex),
    [bars]
  );
  const formattedCurrentTime = formatClockTime(currentTime);
  const formattedDisplayedDuration = formatClockTime(displayedDuration);

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
      audio.currentTime = next;
      setCurrentTime(next);
      setCurrentStep(clamp(Math.round(next / stepDuration), 0, totalSteps - 1));
    },
    [playbackDuration, stepDuration, totalSteps]
  );

  const seekToSnapped = useCallback(
    (t: number) => {
      seekTo(snapTime(t));
    },
    [seekTo, snapTime]
  );

  const jumpToBar = useCallback(
    (barIndex: number) => {
      const targetTime = clamp(barIndex * secondsPerBar, 0, playbackDuration);
      seekTo(targetTime);
    },
    [playbackDuration, secondsPerBar, seekTo]
  );

  const zoomIn = useCallback(() => {
    setStepWidth((v) => clamp(v + 4, 12, 64));
  }, []);

  const zoomOut = useCallback(() => {
    setStepWidth((v) => clamp(v - 4, 12, 64));
  }, []);

  const resetZoom = useCallback(() => {
    setStepWidth(28);
  }, []);

  const increaseZoom = useCallback(() => {
    setZoom((v) => Math.min(3, parseFloat((v + 0.1).toFixed(2))));
  }, []);

  const decreaseZoom = useCallback(() => {
    setZoom((v) => Math.max(0.5, parseFloat((v - 0.1).toFixed(2))));
  }, []);

  const updatePlaybackSpeed = useCallback((nextSpeed: number) => {
    setPlaybackSpeed(parseFloat(clamp(nextSpeed, 0.5, 2.0).toFixed(1)));
  }, []);

  const decreasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeed((v) => parseFloat(clamp(v - 0.1, 0.5, 2.0).toFixed(1)));
  }, []);

  const increasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeed((v) => parseFloat(clamp(v + 0.1, 0.5, 2.0).toFixed(1)));
  }, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = playbackSpeed;

    console.log("play() called -- attempting audio.play()", { src: audio.src });
    try {
      await audio.play();
      console.log("play() succeeded");
      setIsPlaying(true);
    } catch (err) {
      console.error("audio play failed:", err);
    }
  }, [playbackSpeed]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    console.log("pause() called");
    audio.pause();
    console.log("pause() executed");
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const resetPlaybackState = useCallback(() => {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    resumePlaybackAfterScrubRef.current = false;
    isScrubbingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentStep(0);
    setLoopStart(null);
    setLoopEnd(null);
    setMode(null);
    setAudioDuration(null);
  }, []);

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

      resetPlaybackState();
      setSelectedAudioFile(null);
      setImportedAudioUrl((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return null;
      });
      setSelectedTrackType(nextTrackType);
    },
    [resetPlaybackState, selectedTrackType]
  );

  const seekFromScrubRatio = useCallback(
    (ratio: number) => {
      if (playbackDuration <= 0) return;
      seekTo(clamp(ratio, 0, 1) * playbackDuration);
    },
    [playbackDuration, seekTo]
  );

  const updateScrubFromPointer = useCallback(
    (clientX: number) => {
      const scrubBar = scrubBarRef.current;
      if (!scrubBar || playbackDuration <= 0) return;

      const rect = scrubBar.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = (clientX - rect.left) / rect.width;
      seekFromScrubRatio(ratio);
    },
    [playbackDuration, seekFromScrubRatio]
  );

  const handleScrubPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      event.preventDefault();
      resumePlaybackAfterScrubRef.current = !!audio && !audio.paused;
      isScrubbingRef.current = true;

      if (audio && !audio.paused) {
        audio.pause();
        setIsPlaying(false);
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      updateScrubFromPointer(event.clientX);
    },
    [updateScrubFromPointer]
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

      if (resumePlaybackAfterScrubRef.current) {
        resumePlaybackAfterScrubRef.current = false;
        void play();
        return;
      }

      resumePlaybackAfterScrubRef.current = false;
    },
    [play, updateScrubFromPointer]
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
  }, []);

  const setLoopStartAt = useCallback(
    (t: number) => {
      const v = snapTime(t);

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

  const currentBar = Math.floor(currentStep / barSteps);
  const maxLoopInputValue = totalSteps * stepDuration;

  const syncPlaybackPosition = useCallback(
    (nextTime: number) => {
      const clampedTime = clamp(nextTime, 0, playbackDuration);
      const nextStep = clamp(Math.round(clampedTime / stepDuration), 0, totalSteps - 1);
      setCurrentTime(clampedTime);
      setCurrentStep(nextStep);
    },
    [playbackDuration, stepDuration, totalSteps]
  );

  const syncFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const audioTime = audio.currentTime;

    if (hasLoop && loopStart !== null && loopEnd !== null && audioTime >= loopEnd) {
      audio.currentTime = loopStart;
      syncPlaybackPosition(loopStart);
      return;
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
      syncFromAudio();
    };

    const onEnded = () => {
      audio.pause();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resumePlaybackAfterScrubRef.current = false;
      isScrubbingRef.current = false;
      syncPlaybackPosition(audio.duration || audio.currentTime || playbackDuration);
      setIsPlaying(false);
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
  }, [playbackDuration, syncFromAudio, syncPlaybackPosition]);

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
      syncPlaybackPosition(audio.currentTime);
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      console.log("audio loadedmetadata", { duration: audio.duration, src: audio.src });
    };

    const onCanPlay = () => {
      audio.defaultPlaybackRate = playbackSpeed;
      audio.playbackRate = playbackSpeed;
      syncPlaybackPosition(audio.currentTime);
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

  const beep = useCallback(
    (accent: boolean) => {
      const ctx = ensureAudioContext();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = accent ? 1200 : 800;

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.07);
    },
    [ensureAudioContext]
  );

  useEffect(() => {
    if (!metronomeEnabled || !isPlaying) {
      lastMetroBeatRef.current = -1;
      return;
    }

    const beatIndex = Math.floor(currentTime / secondsPerBeat);

    if (beatIndex !== lastMetroBeatRef.current) {
      lastMetroBeatRef.current = beatIndex;
      const accent = beatIndex % beatsPerBar === 0;
      beep(accent);
    }
  }, [beep, beatsPerBar, currentTime, isPlaying, metronomeEnabled, secondsPerBeat]);

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

      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
        return;
      }

      if (e.key === "0") {
        e.preventDefault();
        resetZoom();
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
    resetZoom,
    seekTo,
    seekToSnapped,
    secondsPerBeat,
    beatsPerBar,
    setLoopEndAt,
    setLoopStartAt,
    togglePlay,
    zoomIn,
    zoomOut,
  ]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      if (e.deltaY < 0) {
        setZoom((v) => Math.min(3, parseFloat((v + 0.1).toFixed(2))));
      } else if (e.deltaY > 0) {
        setZoom((v) => Math.max(0.5, parseFloat((v - 0.1).toFixed(2))));
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel as EventListener);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.load();
    audio.currentTime = 0;
    syncPlaybackPosition(0);
  }, [audioSrc]);

  useEffect(() => {
    return () => {
      if (importedAudioUrl) URL.revokeObjectURL(importedAudioUrl);
    };
  }, [importedAudioUrl]);

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
                    <button
                      key={barIndex}
                      type="button"
                      aria-label={`跳转到第 ${barIndex + 1} 小节`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        jumpToBar(barIndex);
                      }}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPercent}%`,
                        width: 12,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        transform: isEdge ? "none" : "translateX(-6px)",
                        cursor: "pointer",
                        pointerEvents: "auto",
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
                    </button>
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
                onClick={() => seekTo(hasLoop && loopStart !== null ? loopStart : 0)}
                style={buttonStyle(false)}
              >
                回到起点
              </button>

              <button
                onClick={() => setMetronomeEnabled((v) => !v)}
                style={buttonStyle(metronomeEnabled)}
              >
                节拍器
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <button onClick={zoomOut} style={buttonStyle(false)}>
                缩小
              </button>
              <button onClick={resetZoom} style={buttonStyle(false)}>
                默认
              </button>
              <button onClick={zoomIn} style={buttonStyle(false)}>
                放大
              </button>
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
                onClick={clearLoop}
                style={{
                  ...buttonStyle(false),
                  background: "rgba(22, 28, 39, 0.58)",
                  color: "#94a3b8",
                  border: "1px solid rgba(71, 85, 105, 0.75)",
                  fontWeight: 500,
                }}
              >
                清除循环（Delete）
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
            <InfoCard label="当前 Step" value={`${currentStep} / ${totalSteps - 1}`} />
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

        <ScoreView
          duration={duration}
          bpm={bpm}
          beatsPerBar={beatsPerBar}
          stepsPerBeat={stepsPerBeat}
          currentTime={currentTime}
          currentStep={currentStep}
          loopStart={loopStart}
          loopEnd={loopEnd}
          hasLoop={hasLoop}
          trackSteps={stepMap}
          onGridTimeAction={handleGridTimeAction}
          onSeek={seekTo}
          onSetLoopStart={setLoopStartAt}
          onSetLoopEnd={setLoopEndAt}
          snapTime={snapTime}
          stepWidth={stepWidth}
          zoom={zoom}
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

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#3b82f6" : "#202735",
    color: active ? "#f8fafc" : "#fff",
    border: "1px solid " + (active ? "#60a5fa" : "#344155"),
    borderRadius: 10,
    minHeight: 42,
    padding: "0 14px",
    cursor: "pointer",
    fontWeight: active ? 700 : 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };
}

const fieldWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
};

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