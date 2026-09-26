import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigIa } from "./config";
import { TranscripcionNoDisponibleError, type Transcriptor } from "./tipos";

const ejecutar = (bin: string, args: string[]) =>
  new Promise<void>((ok, mal) => execFile(bin, args, { timeout: 120_000 }, (e, _out, err) => (e ? mal(new Error(String(err || e.message).slice(0, 200))) : ok())));

/**
 * Notas de voz → texto con whisper.cpp (local, sin costo). Opcional: sin `WHISPER_BIN` y
 * `WHISPER_MODELO` el bot pide que escriban el gasto.
 */
export function crearTranscriptor(config: ConfigIa): Transcriptor {
  if (!config.whisperBin || !config.whisperModelo) {
    return {
      disponible: false,
      transcribir: async () => { throw new TranscripcionNoDisponibleError("Las notas de voz no están activadas en este dispositivo"); },
    };
  }
  return {
    disponible: true,
    async transcribir(audio) {
      const dir = await mkdtemp(join(tmpdir(), "voz-"));
      try {
        const entrada = join(dir, "entrada"), wav = join(dir, "audio.wav"), salida = join(dir, "texto");
        await writeFile(entrada, audio);
        // Telegram manda OGG/Opus: whisper.cpp pide WAV 16 kHz mono.
        await ejecutar(config.ffmpegBin, ["-y", "-i", entrada, "-ar", "16000", "-ac", "1", wav]);
        await ejecutar(config.whisperBin!, ["-m", config.whisperModelo!, "-l", "es", "-nt", "-otxt", "-of", salida, "-f", wav]);
        return (await readFile(`${salida}.txt`, "utf8")).trim();
      } catch (e) {
        throw new TranscripcionNoDisponibleError(`No se pudo transcribir la nota de voz: ${(e as Error).message}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
