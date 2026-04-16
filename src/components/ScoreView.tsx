import { useEffect, useRef, useState } from "react";

type TrackName = "HH" | "SD" | "BD";

type MidiDebugEvent = {
  time: number;
  instrument: string;
  articulation: string;
  velocity: number;
};

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
  metronomeActive?: boolean;
  metronomeBeat?: number;
  midiDebugEvents?: MidiDebugEvent[];
  onSetLoopStart?: (time: number) => void;
  onSetLoopEnd?: (time: number) => void;
  snapTime?: (time: number) => number;
  onMiniMapSeek?: (time: number) => void;
};

const TRACKS: TrackName[] = ["HH", "SD", "BD"];
const MIDI_ONLY_LANES = ["CR", "RD", "TM_HIGH", "TM_MID", "TM_FLOOR"] as const;

const LEFT_GUTTER = 72;
const STEP_WIDTH = 28;
const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 40;
const BAR_LABEL_HEIGHT = 30;
const PRACTICE_BAR_COUNT = 4;
const VISIBLE_BAR_COUNT = 5;

export default function ScoreView({
  bpm,
  beatsPerBar,
  stepsPerBeat,
  currentStep,
  trackSteps,
  onGridTimeAction,
  onSeek,
  countInActive = false,
  countInBeat = 1,
  metronomeActive = false,
  metronomeBeat = 1,
  midiDebugEvents,
}: Props) {
  console.log("[V3] ScoreView midiDebugEvents", midiDebugEvents);

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

  const baseStepWidth = STEP_WIDTH;

  // Paged view: 5 bars at a time, advancing by 4 bars
  const currentBar = Math.floor(currentStep / stepsPerBar);
  const autoPageStartBar = Math.floor(currentBar / PRACTICE_BAR_COUNT) * PRACTICE_BAR_COUNT;
  const pageStartBar = pageStartBarOverride ?? autoPageStartBar;
  const pageStartStep = pageStartBar * stepsPerBar;
  const visibleStepCount = stepsPerBar * VISIBLE_BAR_COUNT;
  const previewBarStartStep = pageStartStep + stepsPerBar * PRACTICE_BAR_COUNT;
  const naturalPageWidth = LEFT_GUTTER + visibleStepCount * baseStepWidth;
  const pageWidth = containerWidth > 0 ? Math.min(containerWidth, naturalPageWidth) : naturalPageWidth;
  const availableGridWidth = Math.max(pageWidth - LEFT_GUTTER, 0);
  const fittedStepWidth =
    availableGridWidth > 0
      ? Math.min(baseStepWidth, availableGridWidth / visibleStepCount)
      : baseStepWidth;
  const stepWidth = fittedStepWidth;
  const barWidth = stepsPerBar * stepWidth;
  const visibleWidth = barWidth * VISIBLE_BAR_COUNT;
  const scoreContentOpacity = countInActive ? 0.72 : 1;
  const totalLaneCount = MIDI_ONLY_LANES.length + TRACKS.length;
  const scoreAreaHeight = BAR_LABEL_HEIGHT + HEADER_HEIGHT + totalLaneCount * ROW_HEIGHT;
  const visibleStartTime = pageStartBar * secondsPerBar;
  const visibleEndTime = visibleStartTime + VISIBLE_BAR_COUNT * secondsPerBar;
  const hasMidiDebugEvents = (midiDebugEvents?.length ?? 0) > 0;
  const visibleMidiDebugEvents = (midiDebugEvents ?? []).filter(
    (event) => event.time >= visibleStartTime && event.time < visibleEndTime
  );

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
            height: scoreAreaHeight,
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
              当前节
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
              {countInActive || metronomeActive ? (
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 10,
                    pointerEvents: "none",
                    transform: "translateY(-50%)",
                  }}
                >
                  {Array.from({ length: beatsPerBar }).map((_, beatIndex) => {
                    const beatNumber = beatIndex + 1;
                    const visibleDotCount = beatsPerBar - countInBeat + 1;
                    const isCountInVisibleBeat = beatNumber <= visibleDotCount;
                    const isMetronomeCurrentBeat = metronomeBeat === beatNumber;
                    const isVisibleBeat = countInActive ? isCountInVisibleBeat : true;
                    const dotBackground = countInActive
                      ? "rgba(248, 250, 252, 0.88)"
                      : isMetronomeCurrentBeat
                        ? "#2dd4bf"
                        : "rgba(148, 163, 184, 0.34)";
                    const dotBoxShadow = countInActive
                      ? "0 0 0 1px rgba(248, 250, 252, 0.14)"
                      : isMetronomeCurrentBeat
                        ? "0 0 0 1px rgba(94, 234, 212, 0.3), 0 0 14px rgba(45, 212, 191, 0.32)"
                        : "0 0 0 1px rgba(148, 163, 184, 0.12)";

                    return (
                      <span
                        key={`beat-dot-${beatNumber}`}
                        style={{
                          display: "inline-block",
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: dotBackground,
                          boxShadow: dotBoxShadow,
                          opacity: isVisibleBeat ? 1 : countInActive ? 0 : 0.42,
                          transform:
                            !countInActive && isMetronomeCurrentBeat ? "scale(1.05)" : "scale(1)",
                          transition: "opacity 120ms ease, transform 120ms ease, background 120ms ease",
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* MIDI-only lanes (CR / RD) */}
          {MIDI_ONLY_LANES.map((lane, laneIndex) => {
            const top = BAR_LABEL_HEIGHT + HEADER_HEIGHT + laneIndex * ROW_HEIGHT;

            return (
              <div
                key={lane}
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
                  {lane}
                </div>

                <div
                  style={{
                    position: "relative",
                    width: visibleWidth,
                    height: "100%",
                    opacity: scoreContentOpacity,
                    transition: "opacity 140ms ease-out",
                  }}
                >
                  {/* Preview bar background */}
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

                  {/* Empty step cell backgrounds */}
                  {Array.from({ length: visibleStepCount }).map((_, relativeStep) => {
                    const step = pageStartStep + relativeStep;
                    const isCurrent = step === currentStep;

                    return (
                      <div
                        key={step}
                        style={{
                          position: "absolute",
                          left: relativeStep * stepWidth,
                          width: stepWidth,
                          height: "100%",
                          background: isCurrent ? "rgba(59,130,246,0.2)" : "#0f1722",
                        }}
                      />
                    );
                  })}

                  {/* Bar separator lines */}
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

                  {/* MIDI events */}
                  {visibleMidiDebugEvents
                    .filter((event) => event.instrument === lane)
                    .map((event, index) => {
                      const left =
                        ((event.time - visibleStartTime) / (visibleEndTime - visibleStartTime)) *
                        visibleWidth;
                      const isTom = lane === "TM_HIGH" || lane === "TM_MID" || lane === "TM_FLOOR";
                      const symbol = isTom ? "●" : "x";

                      return (
                        <div
                          key={`midi-${lane}-${event.time}-${index}`}
                          style={{
                            position: "absolute",
                            left,
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            opacity: 0.95,
                            pointerEvents: "none",
                            zIndex: 4,
                            color: "#f59e0b",
                            fontSize: 16,
                            fontWeight: 700,
                            lineHeight: 1,
                            textShadow: "0 0 8px rgba(245, 158, 11, 0.3)",
                          }}
                        >
                          {symbol}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}

          {/* Rows (HH / SD / BD) */}
          {TRACKS.map((track, rowIndex) => {
            const top = BAR_LABEL_HEIGHT + HEADER_HEIGHT + (MIDI_ONLY_LANES.length + rowIndex) * ROW_HEIGHT;
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
                    opacity: scoreContentOpacity,
                    transition: "opacity 140ms ease-out",
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
                        {isActive && !hasMidiDebugEvents && (
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

                  {(() => {
                    let trackEvents = visibleMidiDebugEvents.filter(
                      (event) => event.instrument === track
                    );

                    // Deduplicate HH: when multiple notes land on the same grid
                    // step, keep only the highest-priority articulation so a
                    // single symbol renders (pedal > open > default).
                    if (track === "HH") {
                      const hhPriority: Record<string, number> = { pedal: 2, open: 1 };
                      const byStep = new Map<number, MidiDebugEvent>();
                      for (const ev of trackEvents) {
                        const key = Math.round(ev.time / stepDuration);
                        const prev = byStep.get(key);
                        if (
                          !prev ||
                          (hhPriority[ev.articulation] ?? 0) >
                            (hhPriority[prev.articulation] ?? 0)
                        ) {
                          byStep.set(key, ev);
                        }
                      }
                      trackEvents = Array.from(byStep.values());
                    }

                    return trackEvents.map((event, index) => {
                      const left =
                        ((event.time - visibleStartTime) / (visibleEndTime - visibleStartTime)) *
                        visibleWidth;
                      const midiDebugSymbol =
                        track === "HH"
                          ? event.articulation === "pedal"
                            ? "+"
                            : event.articulation === "open"
                              ? "o"
                              : "x"
                          : "●";

                      return (
                        <div
                          key={`midi-debug-${track}-${event.time}-${index}`}
                          style={{
                            position: "absolute",
                            left,
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            opacity: 0.95,
                            pointerEvents: "none",
                            zIndex: 4,
                            color: "#f59e0b",
                            fontSize: 16,
                            fontWeight: 700,
                            lineHeight: 1,
                            textShadow: "0 0 8px rgba(245, 158, 11, 0.3)",
                          }}
                        >
                          {midiDebugSymbol}
                        </div>
                      );
                    });
                  })()}
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