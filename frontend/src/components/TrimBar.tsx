import { useCallback, useRef } from "react";

interface Props {
  duration: number;
  trimStart: number;
  trimEnd: number;
  maxDuration: number;
  onChange: (start: number, end: number) => void;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
}

export default function TrimBar({ duration, trimStart, trimEnd, maxDuration, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const toFrac = (val: number) => (duration > 0 ? val / duration : 0);
  const leftPct = toFrac(trimStart) * 100;
  const widthPct = toFrac(trimEnd - trimStart) * 100;

  const trimLen = trimEnd - trimStart;
  const overLimit = trimLen > maxDuration;

  const posToTime = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(frac * duration * 10) / 10;
    },
    [duration],
  );

  const onPointerDown = (handle: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = handle;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const t = posToTime(e.clientX);
    if (dragging.current === "start") {
      onChange(Math.min(t, trimEnd - 0.1), trimEnd);
    } else {
      onChange(trimStart, Math.max(t, trimStart + 0.1));
    }
  };

  const onPointerUp = () => {
    dragging.current = null;
  };

  return (
    <div style={{ userSelect: "none", padding: "0.5rem 0" }}>
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "relative",
          height: 32,
          background: "var(--parchment-dark)",
          borderRadius: 3,
          cursor: "default",
        }}
      >
        {/* Inactive regions */}
        <div style={{ ...regionStyle, left: 0, width: `${leftPct}%`, background: "rgba(0,0,0,0.25)" }} />
        <div style={{ ...regionStyle, left: `${leftPct + widthPct}%`, right: 0, background: "rgba(0,0,0,0.25)" }} />

        {/* Active region */}
        <div style={{ ...regionStyle, left: `${leftPct}%`, width: `${widthPct}%`, background: overLimit ? "rgba(139,26,26,0.3)" : "rgba(201,168,76,0.35)", borderTop: `2px solid ${overLimit ? "#8b1a1a" : "var(--sepia-light)"}`, borderBottom: `2px solid ${overLimit ? "#8b1a1a" : "var(--sepia-light)"}` }} />

        {/* Start handle */}
        <div
          onPointerDown={onPointerDown("start")}
          style={{ ...handleStyle, left: `${leftPct}%`, borderColor: overLimit ? "#8b1a1a" : "var(--sepia)" }}
        />

        {/* End handle */}
        <div
          onPointerDown={onPointerDown("end")}
          style={{ ...handleStyle, left: `${leftPct + widthPct}%`, borderColor: overLimit ? "#8b1a1a" : "var(--sepia)" }}
        />
      </div>

      {/* Labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: "0.75rem", fontFamily: "var(--font-smallcaps)", color: "var(--sepia)" }}>
        <span>{fmt(trimStart)}</span>
        <span style={{ color: overLimit ? "#8b1a1a" : "var(--ink)", fontWeight: overLimit ? "bold" : "normal" }}>
          {fmt(trimLen)} {overLimit && `(max ${fmt(maxDuration)})`}
        </span>
        <span>{fmt(trimEnd)}</span>
      </div>
    </div>
  );
}

const regionStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  height: "100%",
  borderRadius: 3,
  pointerEvents: "none",
};

const handleStyle: React.CSSProperties = {
  position: "absolute",
  top: -2,
  width: 10,
  height: 36,
  marginLeft: -5,
  background: "var(--parchment)",
  border: "2px solid var(--sepia)",
  borderRadius: 3,
  cursor: "ew-resize",
  zIndex: 2,
  touchAction: "none",
};
