import React, { useEffect, useMemo, useRef, useState } from "react";

type TrackName = "HH" | "SD" | "BD";

type Props = {
  duration: number;
  bpm: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  currentTime: number;
  currentStep: number;
  loopStart: number | null;
  loopEnd: number | null;
  hasLoop: boolean;
  trackSteps: Record<TrackName, Set<number>>;
  onGridTimeAction: (time: number) => void;
  onSeek?: (time: number) => void;
  countInActive?: boolean;
  countInBeat?: number;
  onSetLoopStart?: (time: number) => void;
  onSetLoopEnd?: (time: number) => void;
  snapTime?: (time: number) => number;
  stepWidth?: number;
  zoom?: number;
  onMiniMapSeek?: (time: number) => void;
};

const TRACKS: TrackName[] = ["HH", "SD", "BD"];

const LEFT_GUTTER = 72;
const STEP_WIDTH = 28;
const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 40;
const BAR_LABEL_HEIGHT = 30;
const PRACTICE_BAR_COUNT = 4;
const VISIBLE_BAR_COUNT = 5;

export default function ScoreView({
  duration,
  bpm,
  beatsPerBar,
  stepsPerBeat,
  currentTime,
  currentStep,
  loopStart,
  loopEnd,
  hasLoop,
  trackSteps,
  onGridTimeAction,
  onSeek,
  countInActive = false,
  countInBeat = 1,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageStartBarOverride, setPageStartBarOverride] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      setContainerWidth(el.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      document.body.style.userSelect = "";
      if (el) el.style.cursor = "";
    };
  }, []);

  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const stepsPerBar = beatsPerBar * stepsPerBeat;

  // Zoom factor for horizontal scaling (default 1)
  const zoom = 1;
  const baseStepWidth = STEP_WIDTH * zoom;

  // Paged view: 5 bars at a time, advancing by 4 bars
  const currentBar = Math.floor(currentStep / stepsPerBar);
  const autoPageStartBar = Math.floor(currentBar / PRACTICE_BAR_COUNT) * PRACTICE_BAR_COUNT;
  const pageStartBar = pageStartBarOverride ?? autoPageStartBar;
  const pageStartStep = pageStartBar * stepsPerBar;
  const visibleStepCount = stepsPerBar * VISIBLE_BAR_COUNT;
  const previewBarStartStep = pageStartStep + stepsPerBar * PRACTICE_BAR_COUNT;
  const currentBeatIndexInBar = Math.floor((currentStep % stepsPerBar) / stepsPerBeat);
  const currentBeatNumber = currentBeatIndexInBar + 1;
  const currentBeatStartStep = Math.floor(currentStep / stepsPerBeat) * stepsPerBeat;
  const naturalPageWidth = LEFT_GUTTER + visibleStepCount * baseStepWidth;
  const pageWidth = containerWidth > 0 ? Math.min(containerWidth, naturalPageWidth) : naturalPageWidth;
  const availableGridWidth = Math.max(pageWidth - LEFT_GUTTER, 0);
  const fittedStepWidth =
    availableGridWidth > 0
      ? Math.min(baseStepWidth, availableGridWidth / visibleStepCount)
      : baseStepWidth;
  const stepWidth = fittedStepWidth;
  const barWidth = stepsPerBar * stepWidth;
  const beatWidth = stepsPerBeat * stepWidth;
  const visibleWidth = barWidth * VISIBLE_BAR_COUNT;
  const currentBeatLeft = (currentBeatStartStep - pageStartStep) * stepWidth;
  const isCurrentBeatVisible = currentBeatLeft >= 0 && currentBeatLeft + beatWidth <= visibleWidth;

  useEffect(() => {
    if (pageStartBarOverride === null) return;

    // Return to automatic paging once playback enters the selected page group.
    if (autoPageStartBar === pageStartBarOverride) {
      setPageStartBarOverride(null);
    }
  }, [autoPageStartBar, pageStartBarOverride]);

  return (
    <div
      ref={containerRef}
      style={{
        background: "#1a1f29",
        borderRadius: 12,
        overflow: "hidden",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "#0f141c",
          position: "relative",
          width: pageWidth,
          minWidth: pageWidth,
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: pageWidth,
            height: BAR_LABEL_HEIGHT + HEADER_HEIGHT + TRACKS.length * ROW_HEIGHT,
            position: "relative",
          }}
        >
          {/* Bar labels */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: BAR_LABEL_HEIGHT,
              display: "flex",
              borderBottom: "1px solid #1f2937",
            }}
          >
            <div
              style={{
                width: LEFT_GUTTER,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#101722",
                color: "#e5e7eb",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              当前页
            </div>
            <div
              style={{
                position: "relative",
                width: visibleWidth,
                height: "100%",
                background: "#0f141c",
                overflow: "hidden",
              }}
            >
              {countInActive ? (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 3,
                    width: barWidth,
                    height: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-evenly",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                >
                  {Array.from({ length: beatsPerBar }).map((_, beatIndex) => {
                    const beatNumber = beatIndex + 1;
                    const isActiveBeat = beatNumber === countInBeat;

                    return (
                      <span
                        key={`count-in-${beatNumber}`}
                        style={{
                          minWidth: 12,
                          textAlign: "center",
                          fontSize: 10,
                          lineHeight: 1,
                          color: isActiveBeat ? "#f8fafc" : "rgba(203, 213, 225, 0.55)",
                          fontWeight: isActiveBeat ? 800 : 600,
                          transform: isActiveBeat ? "scale(1.08)" : "scale(1)",
                          transition: "color 120ms ease, transform 120ms ease",
                        }}
                      >
                        {beatNumber}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              {Array.from({ length: VISIBLE_BAR_COUNT }).map((_, barIndex) => {
                const isPreviewBar = barIndex === 4;
                const isActivePageBar = barIndex < PRACTICE_BAR_COUNT;
                const barNumber = pageStartBar + barIndex + 1;
                const targetPageStartBar = Math.floor((barNumber - 1) / 4) * 4;
                const barLeft = barIndex * barWidth;
                const targetBarTime = (barNumber - 1) * secondsPerBar;

                return (
                  <button
                    key={`bar-${barIndex}`}
                    onClick={() => {
                      setPageStartBarOverride(targetPageStartBar);
                      onSeek?.(targetBarTime);
                    }}
                    style={{
                      position: "absolute",
                      left: barLeft,
                      top: 0,
                      width: barWidth,
                      height: "100%",
                      border: "none",
                      borderLeft:
                        barIndex === PRACTICE_BAR_COUNT
                          ? "2px solid #60a5fa"
                          : isActivePageBar
                            ? "1px solid rgba(96, 165, 250, 0.28)"
                            : "1px solid rgba(148, 163, 184, 0.22)",
                      borderRight:
                        barIndex === VISIBLE_BAR_COUNT - 1
                          ? isPreviewBar
                            ? "1px solid rgba(148, 163, 184, 0.22)"
                            : "1px solid rgba(96, 165, 250, 0.28)"
                          : "none",
                      background: isPreviewBar
                        ? "rgba(15, 23, 34, 0.9)"
                        : isActivePageBar
                          ? "rgba(20, 25, 35, 0.94)"
                          : "rgba(20, 25, 35, 0.92)",
                      color: isPreviewBar ? "#94a3b8" : isActivePageBar ? "#e2e8f0" : "#cbd5e1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: 0,
                      margin: 0,
                      fontWeight: isPreviewBar ? 700 : isActivePageBar ? 700 : 600,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    <span>{barNumber}</span>
                    {isPreviewBar ? <span style={{ fontSize: 12, color: "#64748b" }}>预备</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              top: BAR_LABEL_HEIGHT,
              left: 0,
              width: "100%",
              height: HEADER_HEIGHT,
              display: "flex",
              borderBottom: "1px solid #1f2937",
            }}
          >
            <div
              style={{
                width: LEFT_GUTTER,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#101722",
                color: "#94a3b8",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.6,
              }}
            >
              BEAT
            </div>
            <div
              style={{
                position: "relative",
                width: visibleWidth,
                height: "100%",
                background: "#0f141c",
              }}
            >
              {isCurrentBeatVisible ? (
                <div
                  style={{
                    position: "absolute",
                    left: currentBeatLeft,
                    top: 6,
                    width: beatWidth,
                    height: HEADER_HEIGHT - 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    background:
                      currentBeatNumber === 1
                        ? "rgba(248, 250, 252, 0.16)"
                        : "rgba(148, 163, 184, 0.12)",
                    border:
                      currentBeatNumber === 1
                        ? "1px solid rgba(248, 250, 252, 0.4)"
                        : "1px solid rgba(148, 163, 184, 0.28)",
                    color: currentBeatNumber === 1 ? "#f8fafc" : "#cbd5e1",
                    fontSize: currentBeatNumber === 1 ? 18 : 16,
                    fontWeight: currentBeatNumber === 1 ? 800 : 700,
                    boxSizing: "border-box",
                  }}
                >
                  {currentBeatNumber}
                </div>
              ) : null}
            </div>
          </div>

          {/* Rows */}
          {TRACKS.map((track, rowIndex) => {
            const top = BAR_LABEL_HEIGHT + HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
            const activeSteps = trackSteps[track];

            return (
              <div
                key={track}
                style={{
                  position: "absolute",
                  top,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  display: "flex",
                  borderBottom: "1px solid #1f2937",
                }}
              >
                <div
                  style={{
                    width: LEFT_GUTTER,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#101722",
                    color: "#e5e7eb",
                    fontWeight: 700,
                  }}
                >
                  {track}
                </div>

                <div
                  style={{
                    position: "relative",
                    width: visibleWidth,
                    height: "100%",
                  }}
                >
                  {/* Preview bar background (5th bar greyed out) */}
                  <div
                    style={{
                      position: "absolute",
                      left: (previewBarStartStep - pageStartStep) * stepWidth,
                      top: 0,
                      width: barWidth,
                      height: "100%",
                      background: "rgba(0, 0, 0, 0.8)",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  />

                  {/* Step cells */}
                  {Array.from({ length: visibleStepCount }).map((_, relativeStep) => {
                    const step = pageStartStep + relativeStep;
                    const isActive = activeSteps.has(step);
                    const isCurrent = step === currentStep;
                    const isInPreview = step >= previewBarStartStep;

                    return (
                      <div
                        key={step}
                        onClick={() =>
                          onGridTimeAction(step * stepDuration)
                        }
                        style={{
                          position: "absolute",
                          left: relativeStep * stepWidth,
                          width: stepWidth,
                          height: "100%",
                          borderRight: "none",
                          background: isCurrent ? "rgba(59,130,246,0.2)" : "#0f1722",
                        }}
                      >
                        {isActive && (
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: "50%",
                              transform: "translate(-50%, -50%)",
                              fontSize: 16,
                              color: "#fff",
                              opacity: isInPreview ? 0.5 : 1,
                            }}
                          >
                            {track === "HH" && "×"}
                            {track === "SD" && "●"}
                            {track === "BD" && "■"}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Explicit bar separator lines */}
                  {Array.from({ length: VISIBLE_BAR_COUNT + 1 }).map((_, separatorIndex) => {
                    const barStep = (pageStartBar + separatorIndex) * stepsPerBar;
                    const barX = (barStep - pageStartStep) * stepWidth;
                    const isPreviewBoundary = separatorIndex === PRACTICE_BAR_COUNT;

                    if (barX < 0 || barX > visibleStepCount * stepWidth) return null;

                    let lineWidth = 2;
                    let lineColor = "rgba(148, 163, 184, 0.5)";

                    if (isPreviewBoundary) {
                      lineWidth = 4;
                      lineColor = "#3b82f6";
                    }

                    return (
                      <div
                        key={`sep-${separatorIndex}`}
                        style={{
                          position: "absolute",
                          left: barX - lineWidth / 2,
                          top: 0,
                          width: lineWidth,
                          height: "100%",
                          background: lineColor,
                          pointerEvents: "none",
                          zIndex: 3,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Playhead removed: current-step column highlight is the sole indicator */}
        </div>
      </div>
    </div>
  );
}