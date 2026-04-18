import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { Clip, DisplaySchedule } from "../api/types";

const CLIP_DURATION_MS = 60_000;

export default function KioskPage() {
  const { data: clips = [] } = useQuery<Clip[]>({
    queryKey: ["clips"],
    queryFn: () => apiFetch("/clips"),
    refetchInterval: 5_000,
    select: (data) => data.filter((c) => c.status === "ready"),
  });

  const { data: schedule } = useQuery<DisplaySchedule>({
    queryKey: ["schedule"],
    queryFn: () => apiFetch("/display/schedule"),
    refetchInterval: 30_000,
  });

  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDisplayOn = schedule
    ? !schedule.enabled || isWithinSchedule(schedule.on_time, schedule.off_time)
    : true;

  const currentClip: Clip | undefined = clips[index % Math.max(clips.length, 1)];

  function advanceAfterMinute() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIndex((i) => i + 1);
    }, CLIP_DURATION_MS);
  }

  useEffect(() => {
    if (clips.length > 0 && isDisplayOn) advanceAfterMinute();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [index, clips.length, isDisplayOn]);

  // Kiosk is meant to be opened fullscreen — show a small notice in the management UI
  return (
    <div style={{ position: "relative" }}>
      <h2 className="section-heading" style={{ marginBottom: "0.5rem" }}>Kiosk Preview</h2>
      <hr className="rule" />
      <p style={{ fontSize: "0.85rem", fontStyle: "italic", margin: "0.75rem 0" }}>
        On the Pi, Chromium launches this page fullscreen. Open{" "}
        <a href="/kiosk-view" target="_blank">/kiosk-view</a> in a separate window and press F11 to simulate kiosk mode.
      </p>
      <KioskDisplay clip={currentClip} isOn={isDisplayOn} clipCount={clips.length} />
    </div>
  );
}

function KioskDisplay({ clip, isOn, clipCount }: { clip?: Clip; isOn: boolean; clipCount: number }) {
  if (!isOn) {
    return (
      <div style={kioskFrameStyle}>
        <div style={{ color: "#111" }} />
      </div>
    );
  }

  if (clipCount === 0 || !clip) {
    return (
      <div style={{ ...kioskFrameStyle, background: "#1a1208", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "0.5rem" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "2rem", color: "#c9a84c" }}>The Daily Prophet</p>
        <p style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "#8b6914", fontSize: "0.9rem" }}>No portraits on display.</p>
        <p style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "#8b6914", fontSize: "0.75rem" }}>Upload a clip to begin.</p>
      </div>
    );
  }

  return (
    <div style={kioskFrameStyle}>
      <video
        key={clip.id}
        src={`/api/clips/${clip.id}/video`}
        autoPlay
        loop
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}

const kioskFrameStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "16/9",
  background: "#000",
  borderRadius: "2px",
  overflow: "hidden",
  border: "2px solid var(--rule)",
};

function isWithinSchedule(onTime: string, offTime: string): boolean {
  const now = new Date();
  const [onH, onM] = onTime.split(":").map(Number);
  const [offH, offM] = offTime.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const onMins = onH * 60 + onM;
  const offMins = offH * 60 + offM;
  if (onMins <= offMins) return nowMins >= onMins && nowMins < offMins;
  return nowMins >= onMins || nowMins < offMins;
}
