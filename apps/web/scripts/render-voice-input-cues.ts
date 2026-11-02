// @effect-diagnostics nodeBuiltinImport:off - plain Node script run by hand after a cue change.
/**
 * React Native has no Web Audio, so mobile plays WAV renders of the web dictation cues.
 * Math.random is seeded, so a rerun only changes the files when cuelume or a cue does.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { chromium } from "playwright";

import { VOICE_INPUT_CUE_SOUNDS } from "../src/voice/voiceInputCues.ts";

const SAMPLE_RATE = 44_100;
const RENDER_SECONDS = 3;
const SILENCE = 1e-4;
const FADE_SECONDS = 0.005;
const ORIGIN = "https://cuelume.invalid";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const outputDirectory = NodePath.join(webRoot, "../mobile/assets/sounds");
const cuelumeDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.resolve("cuelume")));

function trim(samples: Float32Array): Float32Array {
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1] ?? 0) < SILENCE) end -= 1;
  const trimmed = samples.slice(0, end);
  const fade = Math.min(trimmed.length, Math.round(FADE_SECONDS * SAMPLE_RATE));
  for (let index = 0; index < fade; index += 1) {
    trimmed[trimmed.length - 1 - index] =
      (trimmed[trimmed.length - 1 - index] ?? 0) * (index / fade);
  }
  return trimmed;
}

function encodeWav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), index * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const browser = await chromium.launch();
try {
  await NodeFSP.mkdir(outputDirectory, { recursive: true });
  for (const [cue, [sound, options]] of Object.entries(VOICE_INPUT_CUE_SOUNDS)) {
    // cuelume keeps one AudioContext per page, so each cue gets a fresh one.
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/")
        return route.fulfill({ body: "<!doctype html>", contentType: "text/html" });
      return route.fulfill({
        body: await NodeFSP.readFile(NodePath.join(cuelumeDirectory, pathname)),
        contentType: "text/javascript",
      });
    });
    await page.goto(`${ORIGIN}/`);
    const rendered = await page.evaluate(
      async ({ origin, sound, options, sampleRate, seconds }) => {
        let seed = 1;
        Math.random = () => {
          seed = (seed * 16_807) % 2_147_483_647;
          return (seed - 1) / 2_147_483_646;
        };
        Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true } });
        const contexts: OfflineAudioContext[] = [];
        // cuelume only renders into a running context; an offline one runs once rendering starts.
        window.AudioContext = function RenderingContext() {
          const context = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
          Object.defineProperty(context, "state", { get: () => "running" });
          contexts.push(context);
          return context;
        } as unknown as typeof AudioContext;
        const cuelume = await import(`${origin}/index.js`);
        cuelume.play(sound, options);
        const [context] = contexts;
        if (!context) throw new Error(`cuelume did not render ${sound}`);
        return Array.from((await context.startRendering()).getChannelData(0));
      },
      { origin: ORIGIN, sound, options, sampleRate: SAMPLE_RATE, seconds: RENDER_SECONDS },
    );
    await page.close();
    const samples = trim(Float32Array.from(rendered));
    const file = NodePath.join(outputDirectory, `voice-input-${cue}.wav`);
    await NodeFSP.writeFile(file, encodeWav(samples));
    console.log(
      `${NodePath.relative(process.cwd(), file)}  ${(samples.length / SAMPLE_RATE).toFixed(3)}s`,
    );
  }
} finally {
  await browser.close();
}
