import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Cropper, { Area } from "react-easy-crop";
import { apiFetch, uploadFile } from "../api/client";
import { ClipStatusResponse, DisplayConfig, StorageInfo } from "../api/types";
import StorageMeter from "../components/StorageMeter";
import TrimBar from "../components/TrimBar";

const ACCEPTED =
  "video/mp4,video/quicktime,video/webm,video/x-msvideo,image/jpeg,image/png,image/heic,image/heif";
const LS_KEY = "dailyprophet_pending_upload";

type Step = "pick" | "edit" | "upload";

export default function UploadPage() {
  const qc = useQueryClient();

  // --- config ---
  const { data: config } = useQuery<DisplayConfig>({
    queryKey: ["config"],
    queryFn: () => apiFetch("/config"),
    staleTime: Infinity,
  });
  const maxDur = config?.max_clip_duration ?? 15;
  const aspect = config ? config.display_width / config.display_height : 16 / 9;

  // --- storage ---
  const { data: storage } = useQuery<StorageInfo>({
    queryKey: ["storage"],
    queryFn: () => apiFetch("/storage"),
    refetchInterval: 10_000,
  });

  // --- step state ---
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);

  // --- trim state ---
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // --- crop state ---
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  // --- upload state ---
  const [uploadPct, setUploadPct] = useState(0);
  const [clipId, setClipId] = useState<string | null>(null);
  const [clipStatus, setClipStatus] = useState<ClipStatusResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- video preview ---
  const editorRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // --- looping preview: clamp video to trim region ---
  const loopingRef = useRef(true);
  useEffect(() => {
    if (step !== "edit" || !isVideo) return;
    loopingRef.current = true;
    const tick = () => {
      const v = editorRef.current?.querySelector("video");
      if (v && loopingRef.current) {
        if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
          v.currentTime = trimStart;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      loopingRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [step, isVideo, trimStart, trimEnd]);

  // --- cleanup object URLs ---
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // --- refresh resilience: check localStorage on mount ---
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
      const { clipId: id, fileName } = JSON.parse(raw);
      if (id) {
        setClipId(id);
        setStep("upload");
        startPolling(id);
      }
    } catch { /* ignore corrupt data */ }
  }, []);

  // --- handlers ---

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(f);
    const video = f.type.startsWith("video/") || f.type === "video/quicktime";

    setFile(f);
    setObjectUrl(url);
    setIsVideo(video);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setTrimStart(0);
    setTrimEnd(0);
    setDuration(0);
    setUploadError(null);
    setClipId(null);
    setClipStatus(null);

    if (video) {
      const tmp = document.createElement("video");
      tmp.preload = "metadata";
      tmp.src = url;
      tmp.onloadedmetadata = () => {
        const d = tmp.duration;
        setDuration(d);
        setTrimEnd(Math.min(d, maxDur));
      };
    }

    setStep("edit");
  }

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  function handleTrimChange(start: number, end: number) {
    setTrimStart(start);
    setTrimEnd(end);
  }

  function quotaBlocked(): boolean {
    if (!storage || !file) return false;
    return file.size > storage.free_bytes;
  }

  function trimOverLimit(): boolean {
    return isVideo && (trimEnd - trimStart) > maxDur;
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await apiFetch<ClipStatusResponse>(`/clips/${id}/status`);
        setClipStatus(status);
        if (status.status === "ready" || status.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          localStorage.removeItem(LS_KEY);
          qc.invalidateQueries({ queryKey: ["clips"] });
          qc.invalidateQueries({ queryKey: ["storage"] });
        }
      } catch { /* keep polling */ }
    }, 2000);
  }

  async function handleUpload() {
    if (!file) return;
    setStep("upload");
    setUploadPct(0);
    setUploadError(null);
    setClipStatus(null);

    const params: Record<string, number> = {};
    if (isVideo) {
      params.trimStart = trimStart;
      params.trimEnd = trimEnd;
    }
    if (croppedArea) {
      params.cropX = croppedArea.x;
      params.cropY = croppedArea.y;
      params.cropW = croppedArea.width;
      params.cropH = croppedArea.height;
    }

    try {
      const result = await uploadFile(file, params, setUploadPct);
      setClipId(result.id);
      localStorage.setItem(LS_KEY, JSON.stringify({ clipId: result.id, fileName: file.name }));
      startPolling(result.id);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    }
  }

  function handleReset() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    localStorage.removeItem(LS_KEY);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setFile(null);
    setObjectUrl(null);
    setStep("pick");
    setClipId(null);
    setClipStatus(null);
    setUploadError(null);
  }

  // --- cleanup polling on unmount ---
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // --- render ---

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.5rem" }}>
        <h2 className="section-heading">Write Your Story</h2>
        <StorageMeter />
      </div>
      <hr className="rule" />

      {step === "pick" && renderPick()}
      {step === "edit" && renderEdit()}
      {step === "upload" && renderUpload()}
    </div>
  );

  // --------------------------------------------------

  function renderPick() {
    return (
      <div className="card" style={{ marginTop: "1rem" }}>
        <p style={{ fontStyle: "italic", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Submit a moving portrait — a photograph or a short moving picture (up
          to {maxDur}s) — to be rendered in the Daily Prophet's distinctive
          animated style and displayed upon your enchanted frame.
        </p>

        <label className="btn" style={{ cursor: "pointer" }}>
          Choose File
          <input
            type="file"
            accept={ACCEPTED}
            onChange={handleFilePick}
            style={{ display: "none" }}
          />
        </label>
      </div>
    );
  }

  // --------------------------------------------------

  function renderEdit() {
    if (!objectUrl || !file) return null;

    const blocked = quotaBlocked();
    const overLimit = trimOverLimit();

    return (
      <>
        <div className="card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <span style={{ fontFamily: "var(--font-smallcaps)", fontSize: "0.85rem" }}>
              {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button className="btn" onClick={handleReset}>Choose Different File</button>
          </div>

          {/* Preview with crop overlay */}
          <div ref={editorRef} style={{ position: "relative", width: "100%", aspectRatio: String(aspect), background: "#000", borderRadius: 2, overflow: "hidden" }}>
            {isVideo ? (
              <Cropper
                video={objectUrl}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                mediaProps={{ autoPlay: true, loop: true, muted: true, playsInline: true }}
              />
            ) : (
              <Cropper
                image={objectUrl}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>

          <p style={{ fontSize: "0.72rem", color: "var(--sepia)", marginTop: "0.4rem", fontStyle: "italic" }}>
            Drag to reposition. Scroll or pinch to zoom. The highlighted area will be cropped to fit the display.
          </p>

          {/* Trim bar (video only) */}
          {isVideo && duration > 0 && (
            <TrimBar
              duration={duration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              maxDuration={maxDur}
              onChange={handleTrimChange}
            />
          )}
        </div>

        {/* Submit */}
        <div className="card">
          {blocked && (
            <p style={{ color: "#721c24", fontSize: "0.85rem", marginBottom: "0.75rem", fontWeight: "bold" }}>
              Not enough storage — free up space by deleting clips before submitting.
            </p>
          )}
          {overLimit && (
            <p style={{ color: "#721c24", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              Trim selection exceeds {maxDur}s maximum. Adjust the trim handles above.
            </p>
          )}

          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={blocked || overLimit}
          >
            Submit to the Prophet
          </button>
        </div>
      </>
    );
  }

  // --------------------------------------------------

  function renderUpload() {
    const processing = clipStatus && (clipStatus.status === "processing" || clipStatus.status === "queued");
    const ready = clipStatus?.status === "ready";
    const failed = clipStatus?.status === "failed";

    return (
      <div className="card" style={{ marginTop: "1rem" }}>
        {/* Upload progress */}
        {!clipId && !uploadError && (
          <>
            <p style={{ fontFamily: "var(--font-smallcaps)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              Uploading {file?.name}…
            </p>
            <div className="progress-bar-outer" style={{ height: 10 }}>
              <div className="progress-bar-inner" style={{ width: `${uploadPct}%` }} />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--sepia)", marginTop: "0.3rem" }}>
              {uploadPct}%
            </p>
          </>
        )}

        {/* Upload error */}
        {uploadError && (
          <>
            <p style={{ color: "#721c24", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              Upload failed: {uploadError}
            </p>
            <button className="btn" onClick={() => { setStep("edit"); setUploadError(null); }}>
              Try Again
            </button>
          </>
        )}

        {/* Processing progress */}
        {clipId && processing && (
          <>
            <p style={{ fontFamily: "var(--font-smallcaps)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              Processing your portrait…
            </p>
            <div className="progress-bar-outer" style={{ height: 10 }}>
              <div className="progress-bar-inner" style={{ width: `${clipStatus?.progress ?? 0}%` }} />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--sepia)", marginTop: "0.3rem" }}>
              {clipStatus?.progress ?? 0}%
            </p>
          </>
        )}

        {/* Ready */}
        {ready && (
          <>
            <p style={{ color: "#155724", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              Your portrait has been enchanted and added to the gallery.
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button className="btn btn-primary" onClick={handleReset}>
                Upload Another
              </button>
              <a href="/queue" className="btn">
                View Gallery
              </a>
            </div>
          </>
        )}

        {/* Failed */}
        {failed && (
          <>
            <p style={{ color: "#721c24", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              Processing failed{clipStatus?.error_msg ? `: ${clipStatus.error_msg}` : "."}
            </p>
            <button className="btn" onClick={handleReset}>
              Try Again
            </button>
          </>
        )}
      </div>
    );
  }
}
