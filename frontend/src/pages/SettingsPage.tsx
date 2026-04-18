import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiFetch } from "../api/client";
import { DisplaySchedule } from "../api/types";

export default function SettingsPage() {
  const qc = useQueryClient();

  // Wi-Fi form state
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [wifiMsg, setWifiMsg] = useState<string | null>(null);

  // Display schedule
  const { data: schedule } = useQuery<DisplaySchedule>({
    queryKey: ["schedule"],
    queryFn: () => apiFetch("/display/schedule"),
  });
  const [sched, setSched] = useState<DisplaySchedule>({ enabled: false, on_time: "08:00", off_time: "22:00" });
  useEffect(() => { if (schedule) setSched(schedule); }, [schedule]);

  const schedMut = useMutation({
    mutationFn: (s: DisplaySchedule) =>
      apiFetch<DisplaySchedule>("/display/schedule", { method: "PUT", body: JSON.stringify(s) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  async function handleWifi(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/wifi", { method: "POST", body: JSON.stringify({ ssid, password }) });
      setWifiMsg("Credentials accepted — connecting…");
    } catch (err: any) {
      setWifiMsg(`Error: ${err.message}`);
    }
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
          <button className="btn btn-primary" type="submit">Save Network Credentials</button>
          {wifiMsg && <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", fontStyle: "italic" }}>{wifiMsg}</p>}
        </form>
      </section>

      {/* Display Schedule */}
      <section className="card">
        <h3 style={{ fontFamily: "var(--font-smallcaps)", marginBottom: "0.75rem" }}>Display Schedule</h3>
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
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "320px",
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--rule)",
  background: "var(--parchment)",
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  borderRadius: "2px",
  color: "var(--ink)",
};
