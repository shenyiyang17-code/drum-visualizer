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
  const [loopStartInput, setLoopStartInput] = useState("0");
  const [loopEndInput, setLoopEndInput] = useState("8");
  const [isSelectingLoopStart, setIsSelectingLoopStart] = useState(true);

  const [audioSrc] = useState("/Michael Jackson Billie Jean.wav");
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const applyLoopRange = () => {
    const start = Number(loopStartInput);
    const end = Number(loopEndInput);

    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (start < 0 || end < 0) return;

    const fixedStart = Math.min(start, end);
    const fixedEnd = Math.max(start, end);

    setLoopStart(fixedStart);
    setLoopEnd(fixedEnd);
    setIsSelectingLoopStart(true);
  };

  const clearLoopRange = () => {
    setLoopStart(0);
    setLoopEnd(secondsPerPage);
    setLoopStartInput("0");
    setLoopEndInput(String(secondsPerPage));
    setIsSelectingLoopStart(true);
  };

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
      gain.gain.value = isDownBeat ? 0.35 : 0.1;

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

  useEffect(() => {
    setLoopStartInput(loopStart.toFixed(2));
    setLoopEndInput(loopEnd.toFixed(2));
  }, [loopStart, loopEnd]);

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

      <div style={{ marginTop: 10, lineHeight: 1.8 }}>
        <div>
          当前操作：
          {isSelectingLoopStart ? "点击谱面选择循环开始" : "点击谱面选择循环结束"}
        </div>
        <div>
          循环开始：{loopStart.toFixed(2)}s ｜ 循环结束：{loopEnd.toFixed(2)}s
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <label>
            开始：
            <input
              type="number"
              step="0.01"
              value={loopStartInput}
              onChange={(e) => setLoopStartInput(e.target.value)}
              style={{ marginLeft: 6, width: 90 }}
            />
          </label>

          <label>
            结束：
            <input
              type="number"
              step="0.01"
              value={loopEndInput}
              onChange={(e) => setLoopEndInput(e.target.value)}
              style={{ marginLeft: 6, width: 90 }}
            />
          </label>

          <button onClick={applyLoopRange}>应用循环</button>
          <button onClick={clearLoopRange}>清除循环</button>
        </div>
      </div>

      <button
        onClick={() => setMetronomeEnabled((v) => !v)}
        style={{
          marginTop: 10,
          padding: "10px 16px",
          borderRadius: 10,
          border: metronomeEnabled ? "1px solid #22c55e" : "1px solid #475569",
          background: metronomeEnabled ? "rgba(34,197,94,0.18)" : "#1e293b",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: metronomeEnabled ? "0 0 0 2px rgba(34,197,94,0.15)" : "none",
        }}
      >
        {metronomeEnabled ? "节拍器：已开启" : "节拍器：已关闭"}
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
              setIsSelectingLoopStart(false);
            } else {
              setLoopEnd(t);
              setIsSelectingLoopStart(true);
            }
          }}
          onLoopStartDrag={(col) => {
            const t = pageStart + col / colsPerSecond;
            setLoopStart(Math.min(t, loopEnd));
          }}
          
          onLoopEndDrag={(col) => {
            const t = pageStart + col / colsPerSecond;
            setLoopEnd(Math.max(t, loopStart));
          }}
          loopStartCol={Math.max(
            0,
            Math.min(
              totalCols - 1,
              Math.floor((loopStart - pageStart) * colsPerSecond)
            )
          )}
          loopEndCol={Math.max(
            0,
            Math.min(
              totalCols - 1,
              Math.floor((loopEnd - pageStart) * colsPerSecond)
            )
          )}
          playheadX={playheadX}
        />
      </div>
    </div>
  );
}