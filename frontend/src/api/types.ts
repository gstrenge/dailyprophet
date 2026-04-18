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
