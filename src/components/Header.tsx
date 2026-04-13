import React from "react";

type Props = {
  exportMode: boolean;
  currentPage: number;
  totalPages: number;
  currentBar: number;
  currentBeat: number;
  stepsPerBar: number;
  pageStart: number;
  pageEnd: number;
};

export default function Header({
  exportMode,
  currentPage,
  totalPages,
  currentBar,
  currentBeat,
  stepsPerBar,
  pageStart,
  pageEnd,
}: Props) {
  return (
    <div
      style={{
        background: exportMode ? "#ffffff" : "rgba(255,255,255,0.03)",
        border: exportMode ? "1px solid rgba(15,23,42,0.08)" : "1px solid #2c3344",
        borderRadius: 16,
        padding: 18,
        marginBottom: 16,
        boxShadow: exportMode ? "none" : "0 10px 30px rgba(0,0,0,0.18)",
        textAlign: "center",
        color: exportMode ? "#0f172a" : "#f3f6ff",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        鼓可视化
      </div>
      <div
        style={{
          color: exportMode ? "#475569" : "#9aa4ba",
          lineHeight: 1.7,
          fontSize: 14,
        }}
      >
        第{currentPage}页 / 共{totalPages}页 · 第{currentBar}小节 · 第{currentBeat}拍 ·
        120 BPM · 4/4 拍 · 每小节{stepsPerBar}步 · {pageStart.toFixed(2)}秒–{pageEnd.toFixed(2)}秒
      </div>
    </div>
  );
}
