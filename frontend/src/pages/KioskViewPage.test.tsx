import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KioskViewPage, { CLIP_MS } from "./KioskViewPage";

// --- helpers ---

const CLIP_A = { id: "aaa", filename: "a.mp4", status: "ready", progress: 100, duration: 10, media_type: "video", thumbnail: null, created_at: "", sort_order: 0, error_msg: null };
const CLIP_B = { id: "bbb", filename: "b.mp4", status: "ready", progress: 100, duration: 10, media_type: "video", thumbnail: null, created_at: "", sort_order: 1, error_msg: null };
const CLIP_IMG = { id: "img1", filename: "photo.jpg", status: "ready", progress: 100, duration: null, media_type: "image", thumbnail: null, created_at: "", sort_order: 2, error_msg: null };
const SCHEDULE_OFF = { enabled: false, on_time: "00:00", off_time: "00:00" };

function mockFetch(clips = [CLIP_A, CLIP_B], schedule = SCHEDULE_OFF) {
  return vi.fn((url: string) => {
    if (url.includes("/display/schedule")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(schedule) });
    }
    if (url.endsWith("/clips")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(clips) });
    }
    return Promise.resolve({ ok: true });
  });
}

function getVideo(): HTMLVideoElement {
  return document.querySelector("video")!;
}

function getImage(): HTMLImageElement {
  return document.querySelector("img")!;
}

// Stub HTMLMediaElement.play — jsdom doesn't implement it
beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

// --- tests ---

describe("KioskViewPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows idle screen when no clips", async () => {
    global.fetch = mockFetch([]) as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    expect(screen.getByText("No portraits on display.")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("loads manifest and plays first clip", async () => {
    global.fetch = mockFetch() as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    const video = getVideo();
    expect(video).toBeTruthy();
    expect(video.src).toContain(`/clips/${CLIP_A.id}/video`);
  });

  it("loops video when under threshold", async () => {
    global.fetch = mockFetch() as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    const video = getVideo();
    const srcBefore = video.src;

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      fireEvent.ended(video);
    });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(getVideo().src).toBe(srcBefore);
  });

  it("advances to next clip after threshold", async () => {
    global.fetch = mockFetch() as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    expect(getVideo().src).toContain(CLIP_A.id);

    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
      fireEvent.ended(getVideo());
    });

    expect(getVideo().src).toContain(CLIP_B.id);
  });

  it("skips erroring clip", async () => {
    const fetchMock = mockFetch() as any;
    global.fetch = fetchMock;

    await act(async () => {
      render(<KioskViewPage />);
    });

    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
      fireEvent.ended(getVideo());
    });

    expect(getVideo().src).toContain(CLIP_B.id);

    await act(async () => {
      fireEvent.error(getVideo());
      vi.advanceTimersByTime(1_000);
    });

    expect(getVideo().src).toContain(CLIP_A.id);
  });

  it("re-fetches manifest at end of cycle and resumes playback", async () => {
    const fetchMock = mockFetch() as any;
    global.fetch = fetchMock;

    await act(async () => {
      render(<KioskViewPage />);
    });

    const initialCalls = fetchMock.mock.calls.filter(
      (c: string[]) => c[0].endsWith("/clips"),
    ).length;

    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
      fireEvent.ended(getVideo());
    });

    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
      fireEvent.ended(getVideo());
    });

    const finalCalls = fetchMock.mock.calls.filter(
      (c: string[]) => c[0].endsWith("/clips"),
    ).length;
    expect(finalCalls).toBeGreaterThan(initialCalls);

    expect(getVideo()).toBeTruthy();
    expect(getVideo().src).toContain(CLIP_A.id);
  });

  it("single clip loops across cycles", async () => {
    global.fetch = mockFetch([CLIP_A]) as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    expect(getVideo().src).toContain(CLIP_A.id);

    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
      fireEvent.ended(getVideo());
    });

    const video = getVideo();
    expect(video).toBeTruthy();
    expect(video.src).toContain(CLIP_A.id);
  });

  it("shows black screen during off-hours", async () => {
    const now = new Date();
    const pastHour = (now.getHours() + 23) % 24;
    const sched = {
      enabled: true,
      on_time: `${String(pastHour).padStart(2, "0")}:00`,
      off_time: `${String(pastHour).padStart(2, "0")}:01`,
    };
    global.fetch = mockFetch([CLIP_A, CLIP_B], sched) as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByText("No portraits on display.")).toBeNull();
  });

  it("shows image clip as <img> and advances after timer", async () => {
    global.fetch = mockFetch([CLIP_IMG, CLIP_A]) as any;

    await act(async () => {
      render(<KioskViewPage />);
    });

    // Should render an <img>, not a <video>
    expect(document.querySelector("video")).toBeNull();
    const img = getImage();
    expect(img).toBeTruthy();
    expect(img.src).toContain(`/clips/${CLIP_IMG.id}/video`);

    // After CLIP_MS, the still timer advances to the next clip (video)
    await act(async () => {
      vi.advanceTimersByTime(CLIP_MS);
    });

    expect(document.querySelector("img")).toBeNull();
    expect(getVideo().src).toContain(CLIP_A.id);
  });
});
