import React, { useState, useEffect } from "react";

type Props = {
  secondsPerPage: number;
  setSecondsPerPage: (n: number) => void;
  stepsPerBar: number;
  setStepsPerBar: (n: number) => void;
  barsPerPage: number;
  setBarsPerPage: (n: number) => void;
  currentPage: number;
  totalPages: number;
  pageInput: string;
  setPageInput: (v: string) => void;
  jumpToPage: (n: number) => void;
  isPlaying: boolean;
  time: number;
  audioDuration: number;
  audioReady: boolean;
  eventCount: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  audioSrc: string;
  setAudioSrc: (v: string) => void;

  loopStart: number | null;
  loopEnd: number | null;
  setLoopStart: (n: number | null) => void;
  setLoopEnd: (n: number | null) => void;
  loopEnabled: boolean;
  setLoopEnabled: (v: boolean) => void;
};

export default function ControlsPanel({
  secondsPerPage,
  setSecondsPerPage,
  stepsPerBar,
  setStepsPerBar,
  barsPerPage,
  setBarsPerPage,
  currentPage,
  totalPages,
  pageInput,
  setPageInput,
  jumpToPage,
  isPlaying,
  time,
  audioDuration,
  audioReady,
  eventCount,
  audioRef,
  audioSrc,
  setAudioSrc,
  loopStart,
  loopEnd,
  setLoopStart,
  setLoopEnd,
  loopEnabled,
  setLoopEnabled,
}: Props) {
  const [fileName, setFileName] = useState("");
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [audioRef, playbackRate]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #2c3344",
    background: "#1d2230",
    color: "#f3f6ff",
  };

  const btnStyle: React.CSSProperties = {
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid #2c3344",
    background: "#1d2230",
    color: "#f3f6ff",
    cursor: "pointer",
    fontWeight: 700,
  };

  const pillStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #2c3344",
    color: "#9aa4ba",
    fontSize: 14,
  };

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid #2c3344",
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          每页秒数
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={secondsPerPage}
            onChange={(e) => setSecondsPerPage(Math.max(1, Number(e.target.value) || 1))}
            style={inputStyle}
          />
        </label>

        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          每小节格数
          <input
            type="number"
            min={4}
            max={32}
            step={4}
            value={stepsPerBar}
            onChange={(e) => setStepsPerBar(Math.max(4, Number(e.target.value) || 4))}
            style={inputStyle}
          />
        </label>

        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          每页小节数
          <input
            type="number"
            min={1}
            max={16}
            step={1}
            value={barsPerPage}
            onChange={(e) => setBarsPerPage(Math.max(1, Number(e.target.value) || 1))}
            style={inputStyle}
          />
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 160px",
          gap: 14,
          marginBottom: 14,
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btnStyle} onClick={() => jumpToPage(currentPage - 1)}>
            上一页
          </button>
          <button style={btnStyle} onClick={() => jumpToPage(currentPage + 1)}>
            下一页
          </button>
        </div>

        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          跳到页码
          <input
            type="number"
            min={1}
            max={totalPages}
            step={1}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => jumpToPage(Number(pageInput) || 1)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToPage(Number(pageInput) || 1);
            }}
            style={inputStyle}
          />
        </label>

        <div style={{ color: "#9aa4ba", fontSize: 14, textAlign: "right", paddingBottom: 8 }}>
          当前页：{currentPage} / {totalPages}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={pillStyle}>状态：{isPlaying ? "播放中" : "已停止"}</div>
        <div style={pillStyle}>当前时间：{time.toFixed(2)}s</div>
        <div style={pillStyle}>总时长：{audioDuration.toFixed(2)}s</div>
        <div style={pillStyle}>音频状态：{audioReady ? "已就绪" : "加载中"}</div>
        <div style={pillStyle}>事件数：{eventCount}</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 14,
          alignItems: "end",
        }}
      >
        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          循环开始（秒）
          <input
            type="number"
            min={0}
            max={audioDuration || 9999}
            step={0.1}
            value={loopStart ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setLoopStart(v === "" ? null : Number(v));
            }}
            style={inputStyle}
          />
        </label>

        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          循环结束（秒）
          <input
            type="number"
            min={0}
            max={audioDuration || 9999}
            step={0.1}
            value={loopEnd ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setLoopEnd(v === "" ? null : Number(v));
            }}
            style={inputStyle}
          />
        </label>

        <button
          style={btnStyle}
          onClick={() => {
            if (loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
              setLoopEnabled(!loopEnabled);
            }
          }}
        >
          {loopEnabled ? "关闭循环" : "开启循环"}
        </button>

        <button
          style={btnStyle}
          onClick={() => {
            setLoopEnabled(false);
            setLoopStart(null);
            setLoopEnd(null);
          }}
        >
          清除循环
        </button>
      </div>

      <div style={{ marginBottom: 14, fontSize: 12, color: "#9aa4ba" }}>
        循环状态：{loopEnabled ? "已开启" : "未开启"} ｜ 开始：{loopStart ?? "-"} ｜ 结束：
        {loopEnd ?? "-"}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ color: "#9aa4ba", fontSize: 13, display: "block", marginBottom: 6 }}>
          上传音频文件
        </label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            setAudioSrc(url);
            setFileName(file.name);
          }}
          style={inputStyle}
        />
        {fileName && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#9aa4ba" }}>
            当前文件：{fileName}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ color: "#9aa4ba", fontSize: 13 }}>
          播放速度（0.5 - 2.0）
          <input
            type="number"
            min={0.5}
            max={2}
            step={0.1}
            value={playbackRate}
            onChange={(e) => {
              const v = Number(e.target.value) || 1;
              setPlaybackRate(Math.max(0.5, Math.min(2, v)));
            }}
            style={inputStyle}
          />
        </label>
      </div>

      <audio
        ref={audioRef}
        src={audioSrc}
        controls
        style={{ width: "100%" }}
      />
    </div>
  );
}