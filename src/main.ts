import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Controls from "./Controls";
import Grid from "./Grid";

function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [pageSec, setPageSec] = useState(8);
  const [stepCount, setStepCount] = useState(16);
  const [subSecCount, setSubSecCount] = useState(4);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [currentBar, setCurrentBar] = useState(1);
  const [currentBeat, setCurrentBeat] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const jumpToPage = (p: number) => {
    const safe = Math.max(1, p);
    setPage(safe);
    const audio = audioRef.current;
    if (audio) audio.currentTime = (safe - 1) * pageSec;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0d1016 0%, #11151d 100%)",
        color: "#f3f6ff",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid #2c3344",
            borderRadius: 16,
            padding: 18,
            marginBottom: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
            鼓可视化
          </div>
          <div style={{ color: "#9aa4ba", lineHeight: 1.7, fontSize: 14 }}>
            当前页：{page} · 第{currentBar}小节 · 第{currentBeat}拍 · 当前时间：{currentTime.toFixed(2)}s / {duration.toFixed(2)}s
          </div>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid #2c3344",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          }}
        >
          <Controls
            pageSec={pageSec}
            setPageSec={setPageSec}
            stepCount={stepCount}
            setStepCount={setStepCount}
            subSecCount={subSecCount}
            setSubSecCount={setSubSecCount}
          />

          <div style={{ display: "flex", gap: 10, margin: "14px 0" }}>
            <button onClick={() => jumpToPage(page - 1)}>上一页</button>
            <button onClick={() => jumpToPage(page + 1)}>下一页</button>
            <input
              type="number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToPage(Number(pageInput));
              }}
              style={{ width: 70 }}
            />
          </div>

          <audio
            ref={audioRef}
            controls
            src="/Michael Jackson Billie Jean.wav"
            style={{ width: "100%" }}
            onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration || 0)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          <div style={{ marginTop: 12, color: "#9aa4ba", fontSize: 14 }}>
            状态：{isPlaying ? "播放中" : "已暂停"}
          </div>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid #2c3344",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          }}
        >
          <Grid
            audioRef={audioRef}
            stepCount={stepCount}
            subSecCount={subSecCount}
            pageSec={pageSec}
            setCurrentBar={setCurrentBar}
            setCurrentBeat={setCurrentBeat}
          />
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(<App />);
