import React from "react";

type Lane = {
  key: string;
  label: string;
  group: string;
};

type Props = {
  exportMode: boolean;
  lanes: Lane[];
  totalCols: number;
  stepsPerBar: number;
  currentBeatInBar: number;
  currentCol: number;
  grid: Record<string, string[]>;
  handleClick: (col: number) => void;
  playheadX: number;
  loopStartCol: number;
  loopEndCol: number;
  onLoopStartDrag: (col: number) => void;
  onLoopEndDrag: (col: number) => void;
};

function getCellStyle(
  lane: string,
  isBarStart: boolean,
  isPreviewBar: boolean,
  hasValue: boolean
): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 24,
    height: 24,
    marginRight: 4,
    borderRadius: 8,
    textAlign: "center",
    lineHeight: "24px",
    cursor: "pointer",
    userSelect: "none",
    border: isPreviewBar
      ? "2px dashed #444c60"
      : isBarStart
      ? "2px solid #64748b"
      : "1px solid #31384a",
    background: isPreviewBar
      ? "rgba(120,130,160,0.12)"
      : isBarStart
      ? "#20283a"
      : "#1b2130",
    color: hasValue ? "#0b0f14" : "#5f6b85",
    fontWeight: hasValue ? 900 : 500,
    fontSize: hasValue ? 16 : 14,
    flex: "0 0 auto",
    position: "relative",
    zIndex: 2,
    overflow: "hidden",
  };

  if (!hasValue) return base;

  if (lane === "hh") {
    base.background = isPreviewBar ? "rgba(142,231,242,0.4)" : "#8ee7f2";
  } else if (lane === "sd") {
    base.background = isPreviewBar ? "rgba(243,244,246,0.4)" : "#f3f4f6";
  } else if (lane === "bd") {
    base.background = isPreviewBar ? "rgba(246,229,141,0.4)" : "#f6e58d";
  }

  return base;
}

export default function ScoreView({
  exportMode,
  lanes,
  totalCols,
  stepsPerBar,
  currentBeatInBar,
  currentCol,
  grid,
  handleClick,
  playheadX,
  loopStartCol,
  loopEndCol,
  onLoopStartDrag,
  onLoopEndDrag,
}: Props) {
  const safeLanes = lanes ?? [];
  const safeGrid = grid ?? {};
  const safeStepsPerBar = Math.max(1, stepsPerBar);
  const totalBars = Math.ceil(totalCols / safeStepsPerBar);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = React.useState<null | "start" | "end">(null);

  const start = Math.max(0, Math.min(loopStartCol ?? 0, loopEndCol ?? 0));
  const end = Math.min(totalCols - 1, Math.max(loopStartCol ?? 0, loopEndCol ?? 0));

  const getColFromClientX = (clientX: number, container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left - 88;
    const col = Math.round(relativeX / 28);
    return Math.max(0, Math.min(totalCols - 1, col));
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => {
        if (!draggingHandle || !containerRef.current) return;
        const col = getColFromClientX(e.clientX, containerRef.current);

        if (draggingHandle === "start") {
          onLoopStartDrag(col);
        } else {
          onLoopEndDrag(col);
        }
      }}
      onMouseUp={() => setDraggingHandle(null)}
      onMouseLeave={() => setDraggingHandle(null)}
      style={{
        position: "relative",
        background: exportMode ? "#ffffff" : "rgba(255,255,255,0.03)",
        border: exportMode
          ? "1px solid rgba(15,23,42,0.08)"
          : "1px solid #2c3344",
        borderRadius: 16,
        padding: 16,
      }}
    >
      {/* 循环区域 */}
      <div
        style={{
          position: "absolute",
          top: 56,
          bottom: 16,
          left: 88 + start * 28,
          width: Math.max(0, (end - start + 1) * 28 - 4),
          background: "rgba(255,255,255,0.04)",
          borderRadius: 8,
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        {/* 左拖拽边界 */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setDraggingHandle("start");
          }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 10,
            marginLeft: -4,
            background: "#60a5fa",
            cursor: "ew-resize",
            zIndex: 5,
            pointerEvents: "auto",
          }}
        />

        {/* 右拖拽边界 */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setDraggingHandle("end");
          }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: 10,
            marginRight: -4,
            background: "#60a5fa",
            cursor: "ew-resize",
            zIndex: 5,
            pointerEvents: "auto",
          }}
        />
      </div>

      {/* 播放头 */}
      <div
        style={{
          position: "absolute",
          top: 56,
          bottom: 16,
          left: 88 + playheadX,
          width: 8,
          background: "rgba(255, 77, 109, 0.3)",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* 顶部拍号 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 14,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ width: 88 }} />
        {Array.from({ length: totalCols }).map((_, i) => {
          const barIndex = Math.floor(i / safeStepsPerBar);
          const isPreviewBar = barIndex === totalBars - 1;

          return (
            <div
              key={i}
              onClick={() => handleClick(i)}
              style={{
                width: 24,
                height: 24,
                marginRight: 4,
                borderRadius: 8,
                textAlign: "center",
                lineHeight: "24px",
                cursor: "pointer",
                border: isPreviewBar
                  ? "2px dashed #444c60"
                  : i % safeStepsPerBar === 0
                  ? "3px solid #64748b"
                  : "1px solid #2a3142",
                background: isPreviewBar
                  ? "rgba(120,130,160,0.12)"
                  : "#161b24",
                color: "#8792ab",
                fontSize: 11,
                fontWeight: 700,
                position: "relative",
                zIndex: 2,
              }}
            >
              {Math.floor((i % safeStepsPerBar) / Math.max(1, safeStepsPerBar / 4)) + 1}
            </div>
          );
        })}
      </div>

      {["上层镲片", "中层鼓件", "底鼓"].map((group) => {
        const rows = safeLanes.filter((l) => l.group === group);

        if (rows.length === 0) return null;

        return (
          <div
            key={group}
            style={{
              marginBottom: 22,
              position: "relative",
              zIndex: 2,
            }}
          >
            <div
              style={{
                color: exportMode ? "#0f172a" : "#dce6ff",
                fontWeight: 800,
                margin: "4px 0 10px 88px",
                fontSize: 18,
              }}
            >
              {group}
            </div>

            {rows.map((lane) => {
              const rowValues =
                safeGrid[lane.key] ?? Array.from({ length: totalCols }, () => "");

              return (
                <div key={lane.key} style={{ display: "flex", marginBottom: 8 }}>
                  <div
                    style={{
                      width: 88,
                      fontWeight: 800,
                      color: exportMode ? "#0f172a" : "#dce6ff",
                    }}
                  >
                    {lane.label}
                  </div>

                  {Array.from({ length: totalCols }).map((_, i) => {
                    const v = rowValues[i] ?? "";
                    const barIndex = Math.floor(i / safeStepsPerBar);
                    const isPreviewBar = barIndex === totalBars - 1;
                    const hasValue = Boolean(v);

                    return (
                      <div
                        key={i}
                        onClick={() => handleClick(i)}
                        style={getCellStyle(
                          lane.key,
                          i % safeStepsPerBar === 0,
                          isPreviewBar,
                          hasValue
                        )}
                      >
                        {hasValue && (
                          <div
                            style={{
                              position: "absolute",
                              top: 2,
                              bottom: 2,
                              left: "50%",
                              width: 3,
                              transform: "translateX(-50%)",
                              background:
                                lane.key === "hh"
                                  ? "#00e5ff"
                                  : lane.key === "sd"
                                  ? "#ffffff"
                                  : "#ffd54f",
                              opacity: 0.9,
                              borderRadius: 2,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <span style={{ position: "relative" }}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}