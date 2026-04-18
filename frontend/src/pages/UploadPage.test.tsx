import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import UploadPage from "./UploadPage";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mockFetch() {
  return vi.fn((url: string) => {
    if (url.includes("/config")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            display_width: 1920,
            display_height: 1080,
            max_clip_duration: 15,
          }),
      });
    }
    if (url.includes("/storage")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            used_bytes: 1000,
            total_allocated_bytes: 10_000_000_000,
            free_bytes: 9_999_999_000,
          }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("UploadPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = mockFetch() as any;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the pick step initially", async () => {
    await act(async () => {
      render(<UploadPage />, { wrapper: Wrapper });
    });

    expect(screen.getByText(/Write Your Story/)).toBeInTheDocument();
    expect(screen.getByText(/Choose File/)).toBeInTheDocument();
  });

  it("shows file info and editor after picking a file", async () => {
    await act(async () => {
      render(<UploadPage />, { wrapper: Wrapper });
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });

    await act(async () => {
      fireEvent.change(input);
    });

    expect(screen.getByText(/test\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/Submit to the Prophet/)).toBeInTheDocument();
  });

  it("shows letterbox toggle in edit step", async () => {
    await act(async () => {
      render(<UploadPage />, { wrapper: Wrapper });
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });

    await act(async () => {
      fireEvent.change(input);
    });

    const toggle = screen.getByLabelText(/Show full image/);
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toBeChecked();
  });

  it("returns to pick step after reset", async () => {
    await act(async () => {
      render(<UploadPage />, { wrapper: Wrapper });
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });

    await act(async () => {
      fireEvent.change(input);
    });

    expect(screen.getByText(/test\.jpg/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/Choose Different File/));
    });

    expect(screen.getByText(/Choose File/)).toBeInTheDocument();
  });
});
