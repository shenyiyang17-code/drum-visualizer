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
  currentCol: number;
  grid: Record<string, string[]>;
  handleClick: (col: number) => void;
};

function getCellStyle(
  lane: string,
  isCurrent: boolean,
  isBarStart: boolean,
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
    border: isBarStart ? "2px solid #ffd166" : "1px solid #31384a",
    background: isCurrent ? "#ffd166" : isBarStart ? "#20283a" : "#1b2130",
    color: hasValue ? "#000" : "#5f6b85",
    fontWeight: hasValue ? 800 : 500,
    boxShadow: isCurrent
      ? "0 0 0 3px rgba(255,209,102,0.22), inset 0 0 0 1px rgba(255,255,255,0.16)"
      : "none",
    fontSize: 14,
    flex: "0 0 auto",
  };

  if (!hasValue) return base;

  if (lane === "hh") {
    base.background = isCurrent ? "#ffd166" : "#8ee7f2";
    base.color = "#000";
  } else if (lane === "sd") {
    base.background = isCurrent ? "#ffd166" : "#f3f4f6";
    base.color = "#111";
  } else if (lane === "bd") {
    base.background = isCurrent ? "#ffd166" : "#f6e58d";
    base.color = "#111";
  }

  return base;
}

export default function ScoreView({
  exportMode,
  lanes,
  totalCols,
  stepsPerBar,
  currentCol,
  grid,
  handleClick,
}: Props) {
  return (
    <div
      style={{
        background: exportMode ? "#ffffff" : "rgba(255,255,255,0.03)",
        border: exportMode ? "1px solid rgba(15,23,42,0.08)" : "1px solid #2c3344",
        borderRadius: 16,
        padding: 16,
        boxShadow: exportMode ? "none" : "0 10px 30px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          border: "1px solid #2c3344",
          background: exportMode ? "#ffffff" : "rgba(255,255,255,0.02)",
          borderRadius: 16,
          overflowX: "auto",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ width: 88, flex: "0 0 88px" }} />
          {Array.from({ length: totalCols }).map((_, i) => (
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
                border:
                  i % stepsPerBar === 0
                    ? "2px solid #ffd166"
                    : i % Math.max(1, stepsPerBar / 4) === 0
                    ? "1px solid #64748b"
                    : "1px solid #31384a",
                background:
                  i === currentCol
                    ? "#ffd166"
                    : i % Math.max(1, stepsPerBar / 4) === 0
                    ? "#1a2130"
                    : "#161b24",
                color: i === currentCol ? "#000" : "#8792ab",
                fontSize: 11,
                fontWeight: 700,
                flex: "0 0 auto",
              }}
            >
              {(i % stepsPerBar) + 1}
            </div>
          ))}
        </div>

        {["上层镲片", "中层鼓件", "底鼓"].map((group) => {
          const rows = lanes.filter((l) => l.group === group);
          return (
            <div key={group} style={{ marginBottom: 22 }}>
              <div
                style={{
                  color: exportMode ? "#cbd5e1" : "#dce6ff",
                  fontWeight: 800,
                  margin: "4px 0 10px 88px",
                  fontSize: 18,
                }}
              >
                {group}
              </div>

              {rows.map((lane) => (
                <div key={lane.key} style={{ display: "flex", marginBottom: 8, alignItems: "center" }}>
                  <div
                    style={{
                      width: 88,
                      flex: "0 0 88px",
                      fontSize: 18,
                      fontWeight: 800,
                      color: exportMode ? "#cbd5e1" : "#d4dcf0",
                      paddingLeft: 8,
                    }}
                  >
                    {lane.label}
                  </div>

                  {grid[lane.key]?.map((v, i) => (
                    <div
                      key={i}
                      onClick={() => handleClick(i)}
                      style={getCellStyle(lane.key, i === currentCol, i % stepsPerBar === 0, Boolean(v))}
                    >
                      {v}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            color: exportMode ? "#475569" : "#9aa4ba",
            fontSize: 14,
            marginTop: 8,
          }}
        >
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#8ee7f2", color: "#000", marginRight: 6 }}>× / ✦</span> 镲片</div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#f3f4f6", color: "#000", marginRight: 6 }}>●</span> 军鼓</div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#f6e58d", color: "#000", marginRight: 6 }}>■</span> 底鼓</div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#ffd166", color: "#000", marginRight: 6 }}>▌</span> 播放头</div>
        </div>
      </div>
    </div>
  );
}
