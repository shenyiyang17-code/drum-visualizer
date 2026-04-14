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
};

const TRACKS: TrackName[] = ["HH", "SD", "BD"];

const LEFT_GUTTER = 72;
const STEP_WIDTH = 28;
const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 40;
const BAR_LABEL_HEIGHT = 30;

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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const stepsPerBar = beatsPerBar * stepsPerBeat;

  // Zoom factor for horizontal scaling (default 1)
  const zoom = 1;
  const baseStepWidth = STEP_WIDTH * zoom;

  // Paged view: 5 bars at a time, advancing by 4 bars
  const currentBar = Math.floor(currentStep / stepsPerBar);
  const pageStartBar = Math.floor(currentBar / 4) * 4;
  const pageStartStep = pageStartBar * stepsPerBar;
  const visibleStepCount = stepsPerBar * 5;
  const previewBarStartStep = pageStartStep + stepsPerBar * 4;
  const naturalPageWidth = LEFT_GUTTER + visibleStepCount * baseStepWidth;
  const pageWidth = containerWidth > 0 ? Math.min(containerWidth, naturalPageWidth) : naturalPageWidth;
  const availableGridWidth = Math.max(pageWidth - LEFT_GUTTER, 0);
  const fittedStepWidth =
    availableGridWidth > 0
      ? Math.min(baseStepWidth, availableGridWidth / visibleStepCount)
      : baseStepWidth;
  const stepWidth = fittedStepWidth;
  const barWidth = stepsPerBar * stepWidth;
  const visibleWidth = barWidth * 5;

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
              }}
            >
              小节
            </div>
            <div
              style={{
                position: "relative",
                width: visibleWidth,
                height: "100%",
              }}
            >
              {Array.from({ length: 5 }).map((_, barIndex) => {
                const barX = barIndex * barWidth;
                const isPreviewBar = barIndex === 4;
                const barNumber = pageStartBar + barIndex + 1;

                return (
                  <div
                    key={`bar-${barIndex}`}
                    style={{
                      position: "absolute",
                      left: barX,
                      top: 0,
                      width: barWidth,
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isPreviewBar ? "#9ca3af" : "#e5e7eb",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {isPreviewBar ? "预备" : barNumber}
                  </div>
                );
              })}
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
                  {Array.from({ length: 5 }).map((_, barIndex) => {
                    const barStep = (pageStartBar + barIndex) * stepsPerBar;
                    const barX = (barStep - pageStartStep) * stepWidth;
                    const isPreviewBar = barIndex === 4;
                    const isPageStart = barIndex === 0;

                    if (barX < 0 || barX > visibleStepCount * stepWidth) return null;

                    let lineWidth = 2;
                    let lineColor = "rgba(148, 163, 184, 0.5)"; // Normal bar line: visible but subdued

                    if (isPreviewBar) {
                      lineWidth = 4;
                      lineColor = "#3b82f6"; // Preview separator (bright blue, very thick)
                    }

                    return (
                      <div
                        key={`sep-${barIndex}`}
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