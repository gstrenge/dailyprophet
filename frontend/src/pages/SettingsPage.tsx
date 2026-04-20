import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiFetch } from "../api/client";
import { DisplaySchedule } from "../api/types";
import { CLIP_MS, SCHEDULE_POLL_MS } from "./KioskViewPage";

/** Worst-case until the kiosk view picks up schedule / power changes (clip advance vs off-hours poll). */
const DISPLAY_APPLY_LAG_SECONDS = Math.ceil(Math.max(CLIP_MS, SCHEDULE_POLL_MS) / 1000);

export default function SettingsPage() {
  const qc = useQueryClient();

  // Wi-Fi form state
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [wifiMsg, setWifiMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Display schedule
  const { data: schedule } = useQuery<DisplaySchedule>({
    queryKey: ["schedule"],
    queryFn: () => apiFetch("/display/schedule"),
  });
  const [sched, setSched] = useState<DisplaySchedule>({ enabled: false, on_time: "08:00", off_time: "22:00", override: null });
  useEffect(() => { if (schedule) setSched(schedule); }, [schedule]);

  const schedMut = useMutation({
    mutationFn: (s: DisplaySchedule) =>
      apiFetch<DisplaySchedule>("/display/schedule", { method: "PUT", body: JSON.stringify(s) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  const overrideMut = useMutation({
    mutationFn: (value: string | null) =>
      apiFetch<DisplaySchedule>("/display/override", {
        method: "POST",
        body: JSON.stringify({ override: value }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  function handleWifi(e: React.FormEvent) {
    e.preventDefault();
    setWifiMsg(null);

    // On success the Pi tears down the setup AP before responding, so this
    // fetch will never resolve — only reject (bad password, agent down, etc.).
    // Start the countdown immediately; let a rejection override it if it comes.
    let remaining = 15;
    setCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        setCountdown(null);
        setWifiMsg("Reconnect your device to your home Wi-Fi, then visit dailyprophet.local");
      } else {
        setCountdown(remaining);
      }
    }, 1000);

    apiFetch("/wifi", { method: "POST", body: JSON.stringify({ ssid, password }) }).catch((err: any) => {
      clearInterval(timer);
      setCountdown(null);
      setWifiMsg(`Error: ${err.message}`);
    });
  }

  return (
    <div>
      <h2 className="section-heading" style={{ marginBottom: "0.5rem" }}>The Owl Post Office</h2>
      <hr className="rule" />

      {/* Wi-Fi */}
      <section className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ fontFamily: "var(--font-smallcaps)", marginBottom: "0.75rem" }}>Home Network</h3>
        <form onSubmit={handleWifi}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Network Name (SSID)</label>
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              style={inputStyle}
              required
            />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={countdown !== null}>Save Network Credentials</button>
          {countdown !== null && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", fontFamily: "var(--font-display)" }}>
              Connecting… reconnect to your home Wi-Fi in {countdown}s
            </p>
          )}
          {wifiMsg && countdown === null && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", fontFamily: "var(--font-display)" }}>{wifiMsg}</p>
          )}
        </form>
      </section>

      {/* Display Schedule */}
      <section className="card">
        <h3 style={{ fontFamily: "var(--font-smallcaps)", marginBottom: "0.75rem" }}>Display Schedule</h3>
        <p style={disclaimerStyle}>
          The kiosk display may take up to {DISPLAY_APPLY_LAG_SECONDS} seconds to reflect saved changes.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={sched.enabled}
            onChange={(e) => setSched((s) => ({ ...s, enabled: e.target.checked }))}
          />
          Enable scheduled on/off times
        </label>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>On at</label>
            <input type="time" value={sched.on_time} onChange={(e) => setSched((s) => ({ ...s, on_time: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Off at</label>
            <input type="time" value={sched.off_time} onChange={(e) => setSched((s) => ({ ...s, off_time: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => schedMut.mutate(sched)}>
          {schedMut.isPending ? "Saving…" : "Save Schedule"}
        </button>
        {schedMut.isSuccess && <span style={{ marginLeft: "0.75rem", fontSize: "0.85rem", color: "#155724" }}>Saved.</span>}
      </section>

      {/* Display Power Override — only when schedule is enabled */}
      {schedule?.enabled && (
        <section className="card">
          <h3 style={{ fontFamily: "var(--font-smallcaps)", marginBottom: "0.75rem" }}>Display Power</h3>
          <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem", opacity: 0.8 }}>
            {schedule.override === "on"
              ? "Display is manually turned ON. Will resume schedule at next off-time."
              : schedule.override === "off"
                ? "Display is manually turned OFF. Will resume schedule at next on-time."
                : "Following the schedule normally."}
          </p>
          <p style={disclaimerStyle}>
            The kiosk display may take up to {DISPLAY_APPLY_LAG_SECONDS} seconds to reflect these controls.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={schedule.override === "on" || overrideMut.isPending}
              onClick={() => overrideMut.mutate("on")}
            >
              Turn On Now
            </button>
            <button
              className="btn btn-primary"
              disabled={schedule.override === "off" || overrideMut.isPending}
              onClick={() => overrideMut.mutate("off")}
            >
              Turn Off Now
            </button>
            {schedule.override && (
              <button
                className="btn"
                disabled={overrideMut.isPending}
                onClick={() => overrideMut.mutate(null)}
                style={{ border: "1px solid var(--rule)" }}
              >
                Resume Schedule
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const disclaimerStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  fontStyle: "italic",
  opacity: 0.75,
  marginBottom: "0.75rem",
  lineHeight: 1.35,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "320px",
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--rule)",
  background: "var(--parchment)",
  fontFamily: "Georgia, serif",
  fontSize: "0.9rem",
  borderRadius: "2px",
  color: "var(--ink)",
};
