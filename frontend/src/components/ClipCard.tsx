import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clip } from "../api/types";

interface Props {
  clip: Clip;
  onDelete: () => void;
}

export default function ClipCard({ clip, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="card" {...attributes}>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        {/* Drag handle */}
        <span
          {...listeners}
          style={{ cursor: "grab", fontSize: "1.1rem", color: "var(--sepia-light)", userSelect: "none", flexShrink: 0 }}
          title="Drag to reorder"
        >
          ⠿
        </span>

        {/* Thumbnail */}
        {clip.thumbnail ? (
          <img
            src={`/api${clip.thumbnail}`}
            alt=""
            style={{ width: 72, height: 48, objectFit: "cover", borderRadius: "2px", flexShrink: 0, border: "1px solid var(--parchment-dark)" }}
          />
        ) : (
          <div style={{ width: 72, height: 48, background: "var(--parchment-dark)", borderRadius: "2px", flexShrink: 0 }} />
        )}

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-smallcaps)", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {clip.filename}
            </span>
            <span className={`status-badge ${clip.status}`}>{clip.status}</span>
          </div>
          {clip.duration && (
            <span style={{ fontSize: "0.75rem", color: "var(--sepia)" }}>{clip.duration.toFixed(1)}s</span>
          )}
          {(clip.status === "processing" || clip.status === "queued") && (
            <div className="progress-bar-outer">
              <div className="progress-bar-inner" style={{ width: `${clip.progress}%` }} />
            </div>
          )}
          {clip.error_msg && (
            <p style={{ fontSize: "0.75rem", color: "#721c24", marginTop: "0.2rem" }}>{clip.error_msg}</p>
          )}
        </div>

        {/* Delete */}
        <button className="btn btn-danger" onClick={onDelete} style={{ flexShrink: 0 }}>
          Delete
        </button>
      </div>
    </div>
  );
}
