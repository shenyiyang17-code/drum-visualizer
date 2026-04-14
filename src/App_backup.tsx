console.log("App loaded - current file");
import { useEffect, useMemo, useRef, useState } from "react";
import ScoreView from "./components/ScoreView";

const LANES = [
  { key: "hh", label: "HH", group: "上层镲片" },
  { key: "sd", label: "SD", group: "中层鼓件" },
  { key: "bd", label: "BD", group: "底鼓" },
];

function getSymbol(lane: string) {
  if (lane === "hh") return "×";
  if (lane === "sd") return "●";
  if (lane === "bd") return "■";
  return "";
}

export default function App() {
  const [events, setEvents] = useState<any[]>([]);
  const [time, setTime] = useState(0);

  const [stepsPerBar] = useState(16);
  const [barsPerPage] = useState(5);
  const [secondsPerPage] = useState(8);
  const [manualPage] = useState(0);

  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(8);
  const [isSelectingLoopStart, setIsSelectingLoopStart] = useState(true);

  const [audioSrc] = useState("/Michael Jackson Billie Jean.wav");
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("./drum_events.json")
      .then((r) => r.json())
      .then((data) => {
        const list = data?.events || data?.drum_events || data;
        setEvents(Array.isArray(list) ? list : []);
      })
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const timer = window.setInterval(() => {
      if (!audio.paused) {
        setTime(audio.currentTime || 0);
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, []);

  const bpm = 120;
  const secondsPerBeat = 60 / bpm;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !metronomeEnabled) return;

    let timer: number | null = null;
    let lastBeat = -1;

    const playClick = (isDownBeat: boolean) => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = isDownBeat ? 1800 : 500;
      gain.gain.value = isDownBeat ? 0.35 : 0.05;

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    };

    const start = () => {
      lastBeat = Math.floor(audio.currentTime / secondsPerBeat);

      timer = window.setInterval(() => {
        if (audio.paused) return;

        const beat = Math.floor(audio.currentTime / secondsPerBeat);
        if (beat !== lastBeat) {
          lastBeat = beat;
          playClick(beat % 4 === 0);
        }
      }, 20);
    };

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);

    return () => {
      stop();
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
    };
  }, [secondsPerBeat, metronomeEnabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.currentTime >= loopEnd) {
      audio.currentTime = loopStart;
    }
  }, [time, loopStart, loopEnd]);

  const totalCols = stepsPerBar * barsPerPage;
  const colsPerSecond = (stepsPerBar / 4) / secondsPerBeat;

  const pageStart = manualPage * secondsPerPage;
  const pageEnd = pageStart + secondsPerPage;

  const currentCol = Math.floor((time - pageStart) * colsPerSecond);
  const snappedCol = Math.max(0, Math.min(totalCols - 1, currentCol));
  const playheadX = snappedCol * 28;

  const grid = useMemo(() => {
    const map: Record<string, string[]> = {};
    LANES.forEach((lane) => {
      map[lane.key] = Array(totalCols).fill("");
    });

    events.forEach((ev) => {
      const t = Number(ev?.time);
      if (!Number.isFinite(t)) return;

      const lane = String(ev?.lane || "").toLowerCase();
      if (!map[lane]) return;

      const idx = Math.floor((t - pageStart) * colsPerSecond);
      if (t >= pageStart && t < pageEnd && idx >= 0 && idx < totalCols) {
        map[lane][idx] = getSymbol(lane);
      }
    });

    return map;
  }, [events, pageStart, pageEnd, colsPerSecond, totalCols]);

  return (
    <div
      style={{
        padding: 20,
        background: "#0d1016",
        color: "#fff",
        minHeight: "100vh",
      }}
    >
      <audio ref={audioRef} src={audioSrc} controls style={{ width: 400 }} />

      <div style={{ marginTop: 10 }}>
        时间: {time.toFixed(2)} ｜ 当前列: {snappedCol}
      </div>

      <div style={{ marginTop: 10 }}>
        当前操作：{isSelectingLoopStart ? "选择循环开始" : "选择循环结束"}
      </div>

      <button
        onClick={() => setMetronomeEnabled((v) => !v)}
        style={{ marginTop: 10 }}
      >
        {metronomeEnabled ? "关节拍器" : "开节拍器"}
      </button>

      <div style={{ marginTop: 20 }}>
        <ScoreView
          exportMode={false}
          lanes={LANES}
          totalCols={totalCols}
          stepsPerBar={stepsPerBar}
          currentBeatInBar={1}
          currentCol={snappedCol}
          grid={grid}
          handleClick={(col) => {
            const t = pageStart + col / colsPerSecond;

            if (isSelectingLoopStart) {
              setLoopStart(t);
              if (t > loopEnd) setLoopEnd(t);
              setIsSelectingLoopStart(false);
            } else {
              setLoopEnd(t);
              if (t < loopStart) setLoopStart(t);
              setIsSelectingLoopStart(true);
            }
          }}
          loopStartCol={Math.max(
            0,
            Math.min(totalCols - 1, Math.floor((loopStart - pageStart) * colsPerSecond))
          )}
          loopEndCol={Math.max(
            0,
            Math.min(totalCols - 1, Math.floor((loopEnd - pageStart) * colsPerSecond))
          )}
          playheadX={playheadX}
        />
      </div>
    </div>
  );
}