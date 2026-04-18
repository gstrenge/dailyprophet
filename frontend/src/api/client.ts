const BASE = "/api";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface UploadParams {
  trimStart?: number;
  trimEnd?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}

export function uploadFile(
  file: File,
  params?: UploadParams,
  onProgress?: (pct: number) => void,
): Promise<{ id: string; status: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (params) {
      if (params.trimStart != null) form.append("trim_start", String(params.trimStart));
      if (params.trimEnd != null) form.append("trim_end", String(params.trimEnd));
      if (params.cropX != null) form.append("crop_x", String(params.cropX));
      if (params.cropY != null) form.append("crop_y", String(params.cropY));
      if (params.cropW != null) form.append("crop_w", String(params.cropW));
      if (params.cropH != null) form.append("crop_h", String(params.cropH));
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/clips`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed ${xhr.status}: ${xhr.responseText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(form);
  });
}
