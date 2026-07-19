// src/util/optimizeVideo.ts
// Automatische Video-Optimierung fuers mobile Autoplay (comvenio data upload --optimize-video).
//
// Hintergrund: mobile Chrome autoplayt grosse Videos (z.B. 26 MB) im Public Hub nicht — eine
// kleine, audio-freie faststart-MP4 (~3 MB) laeuft dagegen zuverlaessig inline/muted an. ffmpeg
// re-encodiert daher zu H.264 (Profile main, Level 4.0, yuv420p), skaliert auf max. 1280px Breite,
// entfernt die Audiospur (-an — Pflicht fuer muted Autoplay auf iOS/Android) und setzt +faststart
// (moov-Atom vorne, damit die Wiedergabe waehrend des progressiven Ladens starten kann).
//
// ffmpeg wird als externer Prozess aus dem PATH gespawnt (Bun.spawn, Vorbild: util/render.ts).
// Kein npm-ffmpeg-Wrapper — hält die kompilierte Binary schlank und die Parameter explizit.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv"]);

/** True wenn der Pfad eine der von `--optimize-video` unterstuetzten Video-Endungen hat. */
export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase());
}

export type OptimizeVideoResult = {
  /** Pfad der optimierten Datei (im temp-Verzeichnis, gleicher Dateiname wie das Original). */
  path: string;
  /** Temp-Verzeichnis, das per `cleanupOptimizedVideo` wieder geloescht werden muss. */
  dir: string;
  inputSizeBytes: number;
  outputSizeBytes: number;
};

// Bun.spawn throws synchronously (ENOENT-artig) wenn das Binary nicht im PATH liegt (Vorbild:
// util/render.ts::hasPlaywrightCli). Eigene Funktion statt `let proc: ReturnType<typeof Bun.spawn>`
// + Zuweisung im try-Block — sonst verliert TS die genaue Subprocess<...>-Generic-Inferenz
// (stdout/stderr wuerden auf `number | ReadableStream | undefined` verbreitert).
function spawnFfmpeg(args: string[], cleanupDir: string) {
  try {
    return Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    rmSync(cleanupDir, { recursive: true, force: true });
    throw new Error(
      `ffmpeg nicht gefunden — bitte installieren (winget install Gyan.FFmpeg) und sicherstellen, dass es im PATH liegt. (${(err as Error).message})`,
    );
  }
}

/**
 * Optimiert ein Video fuer mobiles Autoplay via ffmpeg: H.264 main/4.0, yuv420p, max. 1280px
 * Breite, kein Audio, +faststart. Schreibt in ein frisches temp-Verzeichnis (os.tmpdir) unter
 * dem UNVERAENDERTEN Dateinamen (damit der Upload weiterhin den echten Originalnamen traegt) und
 * gibt Pfad + Verzeichnis zurueck. Der Aufrufer MUSS `cleanupOptimizedVideo(dir)` nach dem Upload
 * aufrufen.
 *
 * Wirft eine klare Fehlermeldung wenn ffmpeg nicht im PATH gefunden wird, sowie bei einem
 * Nicht-Null-Exit-Code (inkl. stderr-Auszug).
 */
export async function optimizeVideoForWeb(inputPath: string): Promise<OptimizeVideoResult> {
  const input = Bun.file(inputPath);
  if (!(await input.exists())) throw new Error(`Datei nicht gefunden: ${inputPath}`);
  const inputSizeBytes = input.size;
  if (inputSizeBytes <= 0) throw new Error(`Datei ist leer: ${inputPath}`);

  const dir = mkdtempSync(join(tmpdir(), "cvn-video-"));
  const outPath = join(dir, basename(inputPath));

  const args = [
    "ffmpeg",
    "-y",
    "-i", inputPath,
    "-c:v", "libx264",
    "-profile:v", "main",
    "-level", "4.0",
    "-pix_fmt", "yuv420p",
    "-vf", "scale='min(1280,iw)':-2",
    "-crf", "26",
    "-preset", "medium",
    "-an",
    "-movflags", "+faststart",
    outPath,
  ];

  const proc = spawnFfmpeg(args, dir);
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`ffmpeg-Optimierung fehlgeschlagen (Exit ${code}): ${stderr.trim().slice(0, 400)}`);
  }

  const output = Bun.file(outPath);
  if (!(await output.exists())) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`ffmpeg-Output fehlt: ${outPath}`);
  }

  return { path: outPath, dir, inputSizeBytes, outputSizeBytes: output.size };
}

/** Loescht das von `optimizeVideoForWeb` angelegte temp-Verzeichnis (best effort). */
export function cleanupOptimizedVideo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
}

/** Formatiert Bytes als MB-String mit 2 Nachkommastellen (fuer Log-/Output-Zeilen). */
export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}
