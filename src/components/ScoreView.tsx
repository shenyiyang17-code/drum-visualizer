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
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const scrollStartRef = useRef(0);

  // Mouse handlers for horizontal drag-to-scroll
  const onMouseDown = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    scrollStartRef.current = el.scrollLeft;
    el.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !el) return;
      const dx = ev.clientX - dragStartXRef.current;
      el.scrollLeft = scrollStartRef.current - dx;
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      if (el) el.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Touch handlers for horizontal drag on touch devices
  const onTouchStart = (e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const t = e.touches[0];
    isDraggingRef.current = true;
    dragStartXRef.current = t.clientX;
    scrollStartRef.current = el.scrollLeft;
    el.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onTouchMove = (ev: TouchEvent) => {
      if (!isDraggingRef.current || !el) return;
      ev.preventDefault();
      const tt = ev.touches[0];
      const dx = tt.clientX - dragStartXRef.current;
      el.scrollLeft = scrollStartRef.current - dx;
    };

    const onTouchEnd = () => {
      isDraggingRef.current = false;
      if (el) el.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("touchmove", onTouchMove as EventListener);
      window.removeEventListener("touchend", onTouchEnd as EventListener);
    };

    window.addEventListener("touchmove", onTouchMove as EventListener, { passive: false });
    window.addEventListener("touchend", onTouchEnd as EventListener);
  };

  // Cleanup if component unmounts while dragging
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      const el = containerRef.current;
      if (el) el.style.cursor = "";
    };
  }, []);

  const secondsPerBeat = 60 / bpm;
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const totalSteps = Math.ceil(duration / stepDuration);
  const barSteps = beatsPerBar * stepsPerBeat;

  // Zoom factor for horizontal scaling (default 1)
  const zoom = 1;
  const stepWidth = STEP_WIDTH * zoom;

  const playheadLeft = LEFT_GUTTER + (currentTime / stepDuration) * stepWidth;

  // Auto-scroll to keep playhead near center when time updates (but don't while user is dragging)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isDraggingRef.current) return;

    const containerWidth = el.clientWidth;
    const target = Math.max(0, playheadLeft - containerWidth / 2 + 1);

    try {
      el.scrollTo({ left: target, behavior: "smooth" });
    } catch (e) {
      // Fallback if smooth not supported
      el.scrollLeft = target;
    }
  }, [currentTime, playheadLeft, stepWidth, stepDuration]);

  return (
    <div
      style={{
        background: "#1a1f29",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        style={{
          overflowX: "auto",
          background: "#0f141c",
          position: "relative",
        }}
      >
        <div
          style={{
            width: LEFT_GUTTER + totalSteps * stepWidth,
            height: HEADER_HEIGHT + TRACKS.length * ROW_HEIGHT,
            position: "relative",
          }}
        >
          {/* Rows */}
          {TRACKS.map((track, rowIndex) => {
            const top = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
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
                    width: totalSteps * stepWidth,
                    height: "100%",
                  }}
                >
                  {Array.from({ length: totalSteps }).map((_, step) => {
                    const isActive = activeSteps.has(step);
                    const isCurrent = step === currentStep;

                      return (
                      <div
                        key={step}
                        onClick={() =>
                          onGridTimeAction(step * stepDuration)
                        }
                        style={{
                          position: "absolute",
                          left: step * stepWidth,
                          width: stepWidth,
                          height: "100%",
                          borderRight: "1px solid #1e293b",
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