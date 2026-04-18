export type ClipStatus = "queued" | "processing" | "ready" | "failed";

export interface Clip {
  id: string;
  filename: string;
  status: ClipStatus;
  progress: number;
  duration: number | null;
  media_type: "video" | "image";
  thumbnail: string | null;
  created_at: string;
  sort_order: number;
  error_msg: string | null;
}

export interface ClipStatusResponse {
  id: string;
  status: ClipStatus;
  progress: number;
  error_msg: string | null;
}

export interface StorageInfo {
  used_bytes: number;
  total_allocated_bytes: number;
  free_bytes: number;
}

export interface ClipOrderRequest {
  order: string[];
}

export interface DisplaySchedule {
  enabled: boolean;
  on_time: string;
  off_time: string;
}

export interface DisplayConfig {
  display_width: number;
  display_height: number;
  max_clip_duration: number;
}

export interface EditParams {
  trimStart?: number;
  trimEnd?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}
