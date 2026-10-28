// @effect-diagnostics nodeBuiltinImport:off - Host-side video analysis shells out to ffmpeg.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";

import { check, type Check, type Rect } from "./checks.ts";
import { run } from "./process.ts";

async function videoSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    path,
  ]);
  const { streams } = JSON.parse(stdout) as { streams: Array<{ width: number; height: number }> };
  const size = streams[0];
  if (!size?.width || !size.height) throw new Error(`Could not read video dimensions: ${path}`);
  return size;
}

async function grayFrames(
  input: string,
  region: Rect,
  scale: number,
  offset: { x: number; y: number },
): Promise<Uint8Array[]> {
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  const [x, y, width, height] = [
    Math.round(region.x * scale + offset.x),
    Math.round(region.y * scale + offset.y),
    even(region.width * scale),
    even(region.height * scale),
  ];
  const [outWidth, outHeight] = [even(region.width / 3), even(region.height / 3)];
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        input,
        "-fps_mode",
        "passthrough",
        "-vf",
        `crop=${width}:${height}:${x}:${y},scale=${outWidth}:${outHeight},format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed: ${stderr}`)),
    );
  });
  const size = outWidth * outHeight;
  return Array.from({ length: Math.floor(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  );
}

const distance = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += Math.abs(a[index]! - b[index]!);
  return sum / a.length;
};

interface FrameProgress {
  readonly nav: number;
  readonly chrome: number;
}

const chromeLags = (frame: FrameProgress) => frame.nav > 0.3 && frame.chrome < 0.4;
const LAG_FRAME_LIMIT = 2;

const progress = (origin: number, destination: number) =>
  origin + destination === 0 ? 0 : origin / (origin + destination);

export async function lagCheck(
  name: string,
  input: {
    readonly video: string;
    readonly nav: Rect;
    readonly chrome: Rect;
    readonly viewport: { readonly width: number; readonly height: number };
  },
  evidence: string,
): Promise<{ check: Check; frame?: string }> {
  if (!(await NodeFSP.stat(input.video).catch(() => null)))
    return { check: check(name, false, "the transition recording is missing") };
  const size = await videoSize(input.video);
  const scale = Math.min(size.width / input.viewport.width, size.height / input.viewport.height);
  const offset = {
    x: (size.width - input.viewport.width * scale) / 2,
    y: (size.height - input.viewport.height * scale) / 2,
  };
  const [navFrames, chromeFrames] = await Promise.all([
    grayFrames(input.video, input.nav, scale, offset),
    grayFrames(input.video, input.chrome, scale, offset),
  ]);
  const [navOrigin, navDestination] = [navFrames[0], navFrames.at(-1)];
  const [chromeOrigin, chromeDestination] = [chromeFrames[0], chromeFrames.at(-1)];
  if (!navOrigin || !navDestination || !chromeOrigin || !chromeDestination)
    throw new Error(`Could not read frames of ${input.video}.`);
  const lagging = navFrames.flatMap((nav, index) => {
    const frame = {
      nav: progress(distance(nav, navOrigin), distance(nav, navDestination)),
      chrome: progress(
        distance(chromeFrames[index]!, chromeOrigin),
        distance(chromeFrames[index]!, chromeDestination),
      ),
    };
    return chromeLags(frame) ? [index] : [];
  });
  if (lagging.length < LAG_FRAME_LIMIT)
    return { check: check(name, true, `${lagging.length} lagging video frames`) };
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    input.video,
    "-vf",
    `select=eq(n\\,${lagging[0]})`,
    "-frames:v",
    "1",
    evidence,
  ]);
  return {
    check: check(name, false, `${lagging.length} video frames (first #${lagging[0]})`),
    frame: evidence,
  };
}
