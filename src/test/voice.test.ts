import { describe, expect, it } from "vitest";
import { audioExtensionFor, baseMime, formatDuration, pickRecorderMime, recorderSupport, recordingFileName, voiceErrorMessage } from "@/lib/voice";

describe("voice helpers", () => {
  it("prefere webm/opus e cai para mp4 no Safari", () => {
    expect(pickRecorderMime((m) => m === "audio/webm;codecs=opus" || m === "audio/mp4")).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(() => false)).toBeNull();
    expect(pickRecorderMime(() => { throw new Error("old"); })).toBeNull();
  });

  it("tira os parâmetros do mime e escolhe a extensão", () => {
    expect(baseMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(baseMime("")).toBe("application/octet-stream");
    expect(audioExtensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionFor("audio/ogg")).toBe("ogg");
    expect(audioExtensionFor("audio/mp4")).toBe("m4a");
    expect(audioExtensionFor("audio/x-foo")).toBe("bin");
  });

  it("nomeia o arquivo com data e hora locais", () => {
    expect(recordingFileName("audio/webm", new Date(2026, 10, 2, 14, 30, 5))).toBe("voz-20261102-143005.webm");
  });

  it("formata a duração", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7.9)).toBe("0:07");
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(-3)).toBe("0:00");
  });

  it("detecta falta de HTTPS e de MediaRecorder", () => {
    expect(recorderSupport({ isSecureContext: false, hasMediaDevices: true, hasMediaRecorder: true })).toBe("insecure");
    expect(recorderSupport({ isSecureContext: true, hasMediaDevices: false, hasMediaRecorder: true })).toBe("unsupported");
    expect(recorderSupport({ isSecureContext: true, hasMediaDevices: true, hasMediaRecorder: false })).toBe("unsupported");
    expect(recorderSupport({ isSecureContext: undefined, hasMediaDevices: true, hasMediaRecorder: true })).toBe("ok");
  });

  it("traduz os erros do microfone", () => {
    expect(voiceErrorMessage({ name: "NotAllowedError" })).toMatch(/Permita o uso do microfone/);
    expect(voiceErrorMessage({ name: "NotFoundError" })).toMatch(/Nenhum microfone/);
    expect(voiceErrorMessage({ name: "NotReadableError" })).toMatch(/em uso/);
    expect(voiceErrorMessage(new Error("boom"))).toBe("Não foi possível gravar: boom");
    expect(voiceErrorMessage(null)).toBe("Não foi possível gravar o áudio.");
  });
});
