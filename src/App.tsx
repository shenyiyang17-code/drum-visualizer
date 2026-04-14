import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScoreView from "./components/ScoreView";
import drumDataRaw from "./drum_events.json";

type TrackName = "HH" | "SD" | "BD";

type DrumEvent = {
  time: number;
  track: TrackName;
};

type EditMode = "play" | "setLoopStart" | "setLoopEnd";

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

const AUDIO_SRC = "/Michael Jackson Billie Jean.wav";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const parsed = useMemo(() => normalizeDrumData(drumDataRaw as DrumDataShape), []);
  const bpm = parsed.bpm;
  const duration = parsed.duration;
  const events = parsed.events;

  const beatsPerBar = 4;
  const stepsPerBeat = 4;
  const secondsPerBeat = 60 / bpm;
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const totalSteps = Math.ceil(duration / stepDuration);
  const barSteps = beatsPerBar * stepsPerBeat;
  const bars = Math.ceil(totalSteps / barSteps);

  const stepMap = useMemo(
    () => buildStepMap(events, totalSteps, stepDuration),
    [events, totalSteps, stepDuration]
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [mode, setMode] = useState<EditMode>("play");

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
      const next = clamp(t, 0, duration);
      audio.currentTime = next;
      setCurrentTime(next);
    },
    [duration]
  );

  const seekToSnapped = useCallback(
    (t: number) => {
      seekTo(snapTime(t));
    },
    [seekTo, snapTime]
  );

  const jumpToBar = useCallback(
    (barIndex: number) => {
      const targetStep = clamp(barIndex * barSteps, 0, totalSteps - 1);
      seekToSnapped(targetStep * stepDuration);
    },
    [barSteps, seekToSnapped, stepDuration, totalSteps]
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

  const clearLoop = useCallback(() => {
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

      if (mode === "play") {
        seekTo(target);
        return;
      }

      if (mode === "setLoopStart") {
        setLoopStartAt(target);
        setMode("play");
        return;
      }

      if (mode === "setLoopEnd") {
        setLoopEndAt(target);
        setMode("play");
        return;
      }
    },
    [mode, seekTo, setLoopEndAt, setLoopStartAt, snapTime]
  );

  const currentStep = Math.round(currentTime / stepDuration);
  const currentBar = Math.floor(currentStep / barSteps);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const tick = () => {
      const t = audio.currentTime;

      if (hasLoop && loopStart !== null && loopEnd !== null && t >= loopEnd) {
        audio.currentTime = loopStart;
        setCurrentTime(loopStart);
      } else {
        setCurrentTime(t);
      }

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
  }, [hasLoop, isPlaying, loopEnd, loopStart]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

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
      console.log("audio loadedmetadata", { duration: audio.duration, src: audio.src });
    };

    const onCanPlay = () => {
      audio.defaultPlaybackRate = playbackSpeed;
      audio.playbackRate = playbackSpeed;
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
  }, [playbackSpeed]);

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
      <audio ref={audioRef} src={encodeURI(AUDIO_SRC)} preload="auto" />

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
          <div style={{ opacity: 0.72, marginTop: 6 }}>
            Zoom / Bar Navigation / Mini Map / DAW-style practice workflow
          </div>
        </div>

        <div
          style={{
            background: "#1a1f29",
            border: "1px solid #2a3140",
            borderRadius: 14,
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button onClick={togglePlay} style={buttonStyle(isPlaying)}>
              {isPlaying ? "暂停" : "播放"}（Space）
            </button>

            <button
              onClick={() => seekTo(hasLoop && loopStart !== null ? loopStart : 0)}
              style={buttonStyle(false)}
            >
              回到起点（Enter）
            </button>

            <button onClick={() => setMode("play")} style={buttonStyle(mode === "play")}>
              播放模式
            </button>

            <button
              onClick={() => setMode("setLoopStart")}
              style={buttonStyle(mode === "setLoopStart")}
            >
              设置循环开始
            </button>

            <button
              onClick={() => setMode("setLoopEnd")}
              style={buttonStyle(mode === "setLoopEnd")}
            >
              设置循环结束
            </button>

            

            <button onClick={clearLoop} style={buttonStyle(false)}>
              清除循环（Delete）
            </button>

            

            <button
              onClick={() => setMetronomeEnabled((v) => !v)}
              style={buttonStyle(metronomeEnabled)}
            >
              节拍器 {metronomeEnabled ? "ON" : "OFF"}（M）
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button onClick={decreasePlaybackSpeed} style={buttonStyle(false)}>
              -0.1
            </button>
            <div
              style={{
                background: "#141923",
                border: "1px solid #283142",
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 700,
                minWidth: 76,
                textAlign: "center",
              }}
            >
              {playbackSpeed.toFixed(1)}x
            </div>
            <button onClick={increasePlaybackSpeed} style={buttonStyle(false)}>
              +0.1
            </button>
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
            <InfoCard label="总时长" value={`${duration.toFixed(2)}s`} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <label style={fieldWrapStyle}>
              <span style={labelStyle}>Loop Start</span>
              <input
                type="number"
                step={stepDuration}
                value={loopStart ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setLoopStart(null);
                    return;
                  }
                  setLoopStartAt(Number(v));
                }}
                style={inputStyle}
              />
            </label>

            <label style={fieldWrapStyle}>
              <span style={labelStyle}>Loop End</span>
              <input
                type="number"
                step={stepDuration}
                value={loopEnd ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setLoopEnd(null);
                    return;
                  }
                  setLoopEndAt(Number(v));
                }}
                style={inputStyle}
              />
            </label>

            <div style={{ opacity: 0.8 }}>
              快捷键：Space / Enter / [ / ] / ← → / Shift+← → / - / + / 0
            </div>
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
          onSeek={seekToSnapped}
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
    color: "#fff",
    border: "1px solid " + (active ? "#60a5fa" : "#344155"),
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 600,
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
  padding: "8px 10px",
  minWidth: 140,
};