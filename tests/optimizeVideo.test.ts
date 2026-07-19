import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanupOptimizedVideo,
  formatMb,
  isVideoFile,
  optimizeVideoForWeb,
} from "../src/util/optimizeVideo.ts";

describe("isVideoFile", () => {
  test("accepts the supported video extensions, case-insensitive", () => {
    expect(isVideoFile("festumzug.mp4")).toBe(true);
    expect(isVideoFile("festumzug.MP4")).toBe(true);
    expect(isVideoFile("clip.mov")).toBe(true);
    expect(isVideoFile("clip.webm")).toBe(true);
    expect(isVideoFile("clip.mkv")).toBe(true);
    expect(isVideoFile("/abs/path/to/video.Mp4")).toBe(true);
  });

  test("rejects non-video extensions", () => {
    expect(isVideoFile("bild.jpg")).toBe(false);
    expect(isVideoFile("dokument.pdf")).toBe(false);
    expect(isVideoFile("ohne-endung")).toBe(false);
  });
});

describe("formatMb", () => {
  test("formats bytes as MB with 2 decimals", () => {
    expect(formatMb(1024 * 1024)).toBe("1.00");
    expect(formatMb(26 * 1024 * 1024)).toBe("26.00");
    expect(formatMb(3.14 * 1024 * 1024)).toBe("3.14");
    expect(formatMb(0)).toBe("0.00");
  });
});

describe("optimizeVideoForWeb", () => {
  test("throws a clear error when the input file does not exist", async () => {
    await expect(optimizeVideoForWeb("./does-not-exist.mp4")).rejects.toThrow(
      "Datei nicht gefunden",
    );
  });

  test("throws when the input file is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cvn-video-test-"));
    const emptyPath = join(dir, "empty.mp4");
    await Bun.write(emptyPath, "");
    try {
      await expect(optimizeVideoForWeb(emptyPath)).rejects.toThrow("Datei ist leer");
    } finally {
      cleanupOptimizedVideo(dir);
    }
  });

  // ffmpeg availability differs per machine/CI runner — this environment has no ffmpeg
  // installed (verified: `ffmpeg -version` -> "command not found"), so the guaranteed,
  // environment-independent assertion is: optimizing a non-empty, existing file either
  // fails because ffmpeg is missing ("ffmpeg nicht gefunden") or because ffmpeg rejects the
  // fixture content ("ffmpeg-Optimierung fehlgeschlagen") — both mention "ffmpeg" and both
  // are the documented, actionable error paths (Gotcha: never a silent/best-effort swallow).
  test("fails loudly (never silently) when ffmpeg cannot process the input", async () => {
    const fixturePath = join(import.meta.dir, "fixtures", "upload.txt");
    await expect(optimizeVideoForWeb(fixturePath)).rejects.toThrow(/ffmpeg/);
  });
});

describe("cleanupOptimizedVideo", () => {
  test("is a no-op (best effort) for a directory that does not exist", () => {
    expect(() => cleanupOptimizedVideo("./this-dir-does-not-exist-cvn")).not.toThrow();
  });
});
