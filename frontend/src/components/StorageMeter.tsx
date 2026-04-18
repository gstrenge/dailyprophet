import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { StorageInfo } from "../api/types";

function fmt(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function StorageMeter() {
  const { data } = useQuery<StorageInfo>({
    queryKey: ["storage"],
    queryFn: () => apiFetch("/storage"),
    refetchInterval: 10_000,
  });

  if (!data) return null;
  const pct = Math.min(100, (data.used_bytes / data.total_allocated_bytes) * 100);
  const warn = pct > 85;

  return (
    <div style={{ textAlign: "right", minWidth: 140 }}>
      <p style={{ fontSize: "0.72rem", fontFamily: "var(--font-smallcaps)", color: warn ? "#721c24" : "var(--sepia)", letterSpacing: "0.05em" }}>
        {fmt(data.used_bytes)} / {fmt(data.total_allocated_bytes)}
      </p>
      <div className="progress-bar-outer" style={{ width: 140 }}>
        <div className="progress-bar-inner" style={{ width: `${pct}%`, background: warn ? "#721c24" : undefined }} />
      </div>
    </div>
  );
}
