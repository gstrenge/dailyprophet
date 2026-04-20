import { useEffect, useRef, useState } from "react";

const BASE = "/api";
export const CLIP_MS = 10_000; // TODO: restore to 60_000 after debugging
export const IDLE_POLL_MS = 10_000;
export const SCHEDULE_POLL_MS = 30_000;

const log = (...args: unknown[]) => console.log("[Kiosk]", ...args);

interface Schedule {
  enabled: boolean;
  on_time: string;
  off_time: string;
  override: string | null;
}

interface ManifestEntry {
  id: string;
  media_type: "video" | "image";
}

type Phase = "loading" | "playing" | "idle" | "off";

export default function KioskViewPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manifest = useRef<ManifestEntry[]>([]);
  const idx = useRef(0);
  const clipStart = useRef(0);
  const schedule = useRef<Schedule | null>(null);
  const advanceLock = useRef(false);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [current, setCurrent] = useState<ManifestEntry | null>(null);
  const [playKey, setPlayKey] = useState(0);

  // --- data fetching ---

  async function fetchSchedule() {
    try {
      const res = await fetch(`${BASE}/display/schedule`);
      if (res.ok) schedule.current = await res.json();
    } catch {
      /* keep stale */
    }
  }

  function isOn(): boolean {
    const s = schedule.current;
    if (!s || !s.enabled) return true;
    if (s.override === "on") return true;
    if (s.override === "off") return false;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [oH, oM] = s.on_time.split(":").map(Number);
    const [fH, fM] = s.off_time.split(":").map(Number);
    const onMin = oH * 60 + oM;
    const offMin = fH * 60 + fM;
    return onMin <= offMin
      ? nowMin >= onMin && nowMin < offMin
      : nowMin >= onMin || nowMin < offMin;
  }

  async function fetchManifest(): Promise<ManifestEntry[]> {
    try {
      const res = await fetch(`${BASE}/clips`);
      if (!res.ok) {
        log("fetchManifest: HTTP", res.status, "— keeping stale");
        return manifest.current;
      }
      const clips: { id: string; status: string; media_type: string }[] =
        await res.json();
      const entries: ManifestEntry[] = clips
        .filter((c) => c.status === "ready")
        .map((c) => ({ id: c.id, media_type: c.media_type as "video" | "image" }));
      manifest.current = entries;
      log("fetchManifest:", entries.length, "ready clips", entries.map((e) => `${e.id}(${e.media_type})`));
      return entries;
    } catch (e) {
      log("fetchManifest: error", e, "— keeping stale");
      return manifest.current;
    }
  }

  function play(entry: ManifestEntry) {
    if (stillTimer.current) {
      clearTimeout(stillTimer.current);
      stillTimer.current = null;
    }
    clipStart.current = Date.now();
    log("play:", entry.id, entry.media_type, "| idx:", idx.current, "| manifest len:", manifest.current.length);
    setCurrent(entry);
    setPlayKey((k) => k + 1);
    setPhase("playing");
  }

  // Stable ref so event handlers always call the latest version.
  const advance = useRef<() => Promise<void>>();
  advance.current = async () => {
    if (advanceLock.current) {
      log("advance: LOCKED, skipping");
      return;
    }
    advanceLock.current = true;
    log("advance: start | idx:", idx.current, "| manifest len:", manifest.current.length);
    try {
      await fetchSchedule();
      if (!isOn()) {
        log("advance: outside schedule → off");
        setPhase("off");
        return;
      }

      let next = idx.current + 1;
      if (next >= manifest.current.length) {
        log("advance: end of manifest, re-fetching...");
        const entries = await fetchManifest();
        if (entries.length === 0) {
          log("advance: no clips after re-fetch → idle");
          setPhase("idle");
          return;
        }
        next = 0;
      }
      idx.current = next;
      const entry = manifest.current[next];
      log("advance: → clip", entry.id, entry.media_type, "at idx", next);
      play(entry);
    } finally {
      advanceLock.current = false;
    }
  };

  // --- video events ---

  function onLoadedData() {
    log("onLoadedData: video ready, ensuring playback");
    const v = videoRef.current;
    if (v && v.paused) {
      log("onLoadedData: video was paused, calling play()");
      v.play().catch((e) => log("onLoadedData: play() rejected:", e));
    }
  }

  function onEnded() {
    const elapsed = Date.now() - clipStart.current;
    log("onEnded: elapsed", (elapsed / 1000).toFixed(1) + "s", "| threshold:", (CLIP_MS / 1000) + "s");
    if (elapsed >= CLIP_MS) {
      log("onEnded: >= threshold → advancing");
      advance.current?.();
    } else {
      log("onEnded: < threshold → replaying");
      const v = videoRef.current;
      if (v) {
        v.currentTime = 0;
        v.play().catch((e) => {
          log("onEnded: play() rejected:", e, "→ advancing");
          advance.current?.();
        });
      } else {
        log("onEnded: videoRef is NULL — cannot replay");
      }
    }
  }

  function onVideoError() {
    log("onVideoError — skipping in 1s");
    setTimeout(() => advance.current?.(), 1000);
  }

  // --- still-image timer: show for CLIP_MS then advance ---

  useEffect(() => {
    if (phase !== "playing" || !current || current.media_type !== "image") return;
    log("still timer: starting", CLIP_MS / 1000, "s for image", current.id);
    stillTimer.current = setTimeout(() => {
      log("still timer: elapsed → advancing");
      advance.current?.();
    }, CLIP_MS);
    return () => {
      if (stillTimer.current) {
        clearTimeout(stillTimer.current);
        stillTimer.current = null;
      }
    };
  }, [phase, playKey]);

  // --- lifecycle ---

  useEffect(() => {
    let cancelled = false;
    log("init: starting up");
    (async () => {
      await fetchSchedule();
      if (cancelled) return;
      if (!isOn()) {
        log("init: outside schedule → off");
        setPhase("off");
        return;
      }
      const entries = await fetchManifest();
      if (cancelled) return;
      if (entries.length === 0) {
        log("init: no clips → idle");
        setPhase("idle");
        return;
      }
      log("init: starting playback with", entries.length, "clips");
      idx.current = 0;
      play(entries[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Idle: poll for new clips
  useEffect(() => {
    if (phase !== "idle") return;
    const t = setInterval(async () => {
      await fetchSchedule();
      if (!isOn()) {
        setPhase("off");
        return;
      }
      const entries = await fetchManifest();
      if (entries.length > 0) {
        idx.current = 0;
        play(entries[0]);
      }
    }, IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [phase]);

  // Off-hours: poll for schedule change
  useEffect(() => {
    if (phase !== "off") return;
    const t = setInterval(async () => {
      await fetchSchedule();
      if (isOn()) {
        const entries = await fetchManifest();
        if (entries.length > 0) {
          idx.current = 0;
          play(entries[0]);
        } else {
          setPhase("idle");
        }
      }
    }, SCHEDULE_POLL_MS);
    return () => clearInterval(t);
  }, [phase]);

  // --- render ---

  if (phase === "off") {
    return <div style={fullscreen} />;
  }

  if (phase === "loading" || phase === "idle") {
    return (
      <div style={{ ...fullscreen, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "0.5rem" }}>
        {phase === "idle" && (
          <>
            <p style={{ fontFamily: "var(--font-masthead)", fontSize: "2rem", color: "#c9a84c" }}>
              The Daily Prophet
            </p>
            <p style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "#8b6914", fontSize: "0.9rem" }}>
              No portraits on display.
            </p>
            <p style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "#8b6914", fontSize: "0.75rem" }}>
              Upload a clip to begin.
            </p>
          </>
        )}
      </div>
    );
  }

  if (current?.media_type === "image") {
    return (
      <div style={fullscreen}>
        <img
          key={playKey}
          src={`${BASE}/clips/${current.id}/video`}
          alt=""
          onError={onVideoError}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }

  return (
    <div style={fullscreen}>
      <video
        ref={videoRef}
        key={playKey}
        src={`${BASE}/clips/${current!.id}/video`}
        autoPlay
        muted
        playsInline
        onLoadedData={onLoadedData}
        onEnded={onEnded}
        onError={onVideoError}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

const fullscreen: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#000",
  overflow: "hidden",
  cursor: "none",
};
