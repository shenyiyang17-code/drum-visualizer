import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import ControlsPanel from "./components/ControlsPanel";
import ScoreView from "./components/ScoreView";

const LANES = [
  { key: "hh", label: "HH", group: "上层镲片" },
  { key: "sd", label: "SD", group: "中层鼓件" },
  { key: "bd", label: "BD", group: "底鼓" },
];

function getSymbol(lane: string) {
  if (lane === "hh") return "×";
  if (lane === "sd") return "●";
  if (lane === "bd") return "■";
  return "";
}

export default function App() {
  const EXPORT_MODE =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("export") === "1";

  const [events, setEvents] = useState<any[]>([]);
  const [time, setTime] = useState(0);

  const [secondsPerPage, setSecondsPerPage] = useState(8);
  const [stepsPerBar, setStepsPerBar] = useState(16);
  const [barsPerPage, setBarsPerPage] = useState(4);

  const [manualPage, setManualPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  const [audioDuration, setAudioDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/drum_events.json")
      .then((r) => r.json())
      .then((data) => {
        const list = data.events || data.drum_events || data;
        setEvents(list);
      });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setAudioDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setAudioReady(true);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    let raf = 0;
    const loop = () => {
      setTime(audio.currentTime || 0);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const maxEventTime = useMemo(() => {
    return events.reduce((m, ev) => {
      if (typeof ev.time === "number") return Math.max(m, ev.time);
      return m;
    }, 0);
  }, [events]);

  const bpm = 120;
const secondsPerBeat = 60 / bpm;
const totalCols = stepsPerBar * barsPerPage;
const colsPerSecond = (stepsPerBar / 4) / secondsPerBeat;
const totalPages = Math.max(1, Math.ceil((Math.max(maxEventTime, audioDuration) || 0.001) / secondsPerPage));

  const audioPage = Math.floor(time / secondsPerPage) + 1;
  const currentPage = Math.min(Math.max(manualPage, 1), totalPages);
  const pageStart = (currentPage - 1) * secondsPerPage;
  const pageEnd = pageStart + secondsPerPage;

  const isAudioInsideCurrentPage = time >= pageStart && time < pageEnd;
  const currentCol = isAudioInsideCurrentPage
    ? Math.max(0, Math.min(totalCols - 1, Math.floor((time - pageStart) * colsPerSecond)))
    : -1;

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (audioPage !== currentPage && time >= 0) {
      setManualPage(audioPage > totalPages ? totalPages : audioPage);
    }
  }, [audioPage, currentPage, totalPages, time]);

  const grid = useMemo(() => {
    const map: Record<string, string[]> = {};
    LANES.forEach((l) => (map[l.key] = Array(totalCols).fill("")));

    events.forEach((ev) => {
      if (!ev.lane || typeof ev.time !== "number") return;
      if (ev.time < pageStart || ev.time >= pageEnd) return;

      const idx = Math.floor((ev.time - pageStart) * colsPerSecond);
      if (map[ev.lane] && idx >= 0 && idx < totalCols) {
        map[ev.lane][idx] = getSymbol(ev.lane);
      }
    });

    return map;
  }, [events, pageStart, pageEnd, colsPerSecond, totalCols]);

  const currentBar = currentCol >= 0 ? Math.floor(currentCol / stepsPerBar) + 1 : 1;
  const currentBeat =
    currentCol >= 0
      ? Math.floor((currentCol % stepsPerBar) / (stepsPerBar / 4)) + 1
      : 1;

  const handleClick = (col: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const t = pageStart + col / colsPerSecond;
    audio.currentTime = t;
    setTime(t);
    setManualPage(currentPage);
  };

  const jumpToPage = (nextPage: number) => {
    const safe = Math.min(Math.max(nextPage, 1), totalPages);
    setManualPage(safe);

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = (safe - 1) * secondsPerPage;
      setTime(audio.currentTime);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: EXPORT_MODE ? "#f8fafc" : "linear-gradient(180deg, #0d1016 0%, #11151d 100%)",
        color: "#f3f6ff",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <Header
          exportMode={EXPORT_MODE}
          currentPage={currentPage}
          totalPages={totalPages}
          currentBar={currentBar}
          currentBeat={currentBeat}
          stepsPerBar={stepsPerBar}
          pageStart={pageStart}
          pageEnd={pageEnd}
        />

        {!EXPORT_MODE && (
          <ControlsPanel
            secondsPerPage={secondsPerPage}
            setSecondsPerPage={setSecondsPerPage}
            stepsPerBar={stepsPerBar}
            setStepsPerBar={setStepsPerBar}
            barsPerPage={barsPerPage}
            setBarsPerPage={setBarsPerPage}
            currentPage={currentPage}
            totalPages={totalPages}
            pageInput={pageInput}
            setPageInput={setPageInput}
            jumpToPage={jumpToPage}
            isPlaying={isPlaying}
            time={time}
            audioDuration={audioDuration}
            audioReady={audioReady}
            eventCount={events.length}
            audioRef={audioRef}
          />
        )}

        <ScoreView
          exportMode={EXPORT_MODE}
          lanes={LANES}
          totalCols={totalCols}
          stepsPerBar={stepsPerBar}
          currentCol={currentCol}
          grid={grid}
          handleClick={handleClick}
        />
      </div>
    </div>
  );
}
