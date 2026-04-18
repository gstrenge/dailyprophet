import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadFile } from "../api/client";
import StorageMeter from "../components/StorageMeter";

const MAX_DURATION_S = 15;
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-msvideo,image/jpeg,image/png";

export default function UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<{ name: string; id?: string; error?: string }[]>([]);
  const qc = useQueryClient();

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFiles(Array.from(e.target.files));
    setResults([]);
  }

  async function handleSubmit() {
    if (!files.length) return;
    setUploading(true);
    const out: typeof results = [];
    for (const file of files) {
      try {
        const { id } = await uploadFile(file);
        out.push({ name: file.name, id });
      } catch (err: any) {
        out.push({ name: file.name, error: err.message });
      }
    }
    setResults(out);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["clips"] });
    qc.invalidateQueries({ queryKey: ["storage"] });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.5rem" }}>
        <h2 className="section-heading">Write Your Story</h2>
        <StorageMeter />
      </div>
      <hr className="rule" />

      <div className="card" style={{ marginTop: "1rem" }}>
        <p style={{ fontStyle: "italic", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Submit a moving portrait — a photograph or a short moving picture (up to {MAX_DURATION_S} seconds) — to be rendered in the Daily Prophet's distinctive animated style and displayed upon your enchanted frame.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <label className="btn" style={{ cursor: "pointer" }}>
            Choose Files
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              multiple
              onChange={handleFilePick}
              style={{ display: "none" }}
            />
          </label>
          {files.length > 0 && (
            <span style={{ marginLeft: "0.75rem", fontStyle: "italic", fontSize: "0.85rem" }}>
              {files.length} file{files.length > 1 ? "s" : ""} selected
            </span>
          )}
        </div>

        {files.length > 0 && (
          <ul style={{ marginBottom: "1rem", fontSize: "0.85rem", paddingLeft: "1.2rem" }}>
            {files.map((f) => (
              <li key={f.name}>{f.name} — {(f.size / 1024 / 1024).toFixed(1)} MB</li>
            ))}
          </ul>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={files.length === 0 || uploading}
        >
          {uploading ? "Submitting…" : "Submit to the Prophet"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="card">
          <h3 style={{ fontFamily: "var(--font-smallcaps)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>Submission Results</h3>
          {results.map((r) => (
            <p key={r.name} style={{ fontSize: "0.85rem", color: r.error ? "#721c24" : "#155724" }}>
              {r.error ? `✗ ${r.name}: ${r.error}` : `✓ ${r.name} — queued for processing`}
            </p>
          ))}
          <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", fontStyle: "italic" }}>
            Track progress in <a href="/queue">My Clips</a>.
          </p>
        </div>
      )}
    </div>
  );
}
