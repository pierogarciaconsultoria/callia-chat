import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import { VoiceRecorder } from "@/components/inbox/VoiceRecorder";

class FakeTrack {
  stop = vi.fn();
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (m: string) => m === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: FakeStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "";
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["abc"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn(async () => new FakeStream());

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 2, 14, 30, 0));
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  mocks.toast.error.mockClear();
  getUserMedia.mockClear();
  FakeRecorder.last = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VoiceRecorder", () => {
  it("grava, mostra o tempo e devolve o arquivo ao concluir", async () => {
    const onRecorded = vi.fn();
    const onCancel = vi.fn();
    render(<VoiceRecorder onRecorded={onRecorded} onCancel={onCancel} />);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText("Gravando")).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.last?.mimeType).toBe("audio/webm;codecs=opus");

    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId("recording-time").textContent).toBe("0:02");

    fireEvent.click(screen.getByRole("button", { name: "Concluir gravação" }));
    expect(onRecorded).toHaveBeenCalledTimes(1);
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toBe("voz-20261102-143002.webm");
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe(3);
    expect(FakeRecorder.last?.stream.tracks[0].stop).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("descarta gravação curta demais e ao cancelar", async () => {
    const onRecorded = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(<VoiceRecorder onRecorded={onRecorded} onCancel={onCancel} />);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText("Gravando")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Concluir gravação" }));
    expect(onRecorded).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/muito curta/));
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();

    render(<VoiceRecorder onRecorded={onRecorded} onCancel={onCancel} />);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText("Gravando")).toBeTruthy());
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar gravação" }));
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(FakeRecorder.last?.stream.tracks[0].stop).toHaveBeenCalled();
  });

  it("avisa quando o microfone é negado", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const onCancel = vi.fn();
    render(<VoiceRecorder onRecorded={vi.fn()} onCancel={onCancel} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/Permita o uso do microfone/));
  });

  it("avisa quando o navegador não grava", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const onCancel = vi.fn();
    render(<VoiceRecorder onRecorded={vi.fn()} onCancel={onCancel} />);
    expect(onCancel).toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/não grava áudio/));
  });
});
