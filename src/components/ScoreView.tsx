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

  const secondsPerBeat = 60 / bpm;
  const stepDuration = secondsPerBeat / stepsPerBeat;
  const totalSteps = Math.ceil(duration / stepDuration);
  const barSteps = beatsPerBar * stepsPerBeat;

  // Zoom factor for horizontal scaling (default 1)
  const zoom = 1;
  const stepWidth = STEP_WIDTH * zoom;

  const playheadLeft = LEFT_GUTTER + (currentTime / stepDuration) * stepWidth;

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
                          background: isCurrent
                            ? "rgba(59,130,246,0.2)"
                            : step % 2 === 0
                            ? "#0f1722"
                            : "#0c131c",
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

          {/* Playhead */}
          <div
            style={{
              position: "absolute",
              left: playheadLeft,
              top: HEADER_HEIGHT,
              width: 2,
              height: TRACKS.length * ROW_HEIGHT,
              background: "red",
            }}
          />
        </div>
      </div>
    </div>
  );
}