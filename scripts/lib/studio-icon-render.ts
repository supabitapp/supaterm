import * as NodeModule from "node:module";

import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";

export const ICON_CHANNELS = ["prod", "nightly", "dev"] as const;
export type IconChannel = (typeof ICON_CHANNELS)[number];

export const ICON_LAYER_SIZE = 1024;
export const SCREEN_ART_SIZE = 1536;

export interface StudioIconRender {
  readonly housing: Buffer;
  readonly screen: Buffer;
  readonly bezel: Buffer;
  /** The screen alone, `SCREEN_ART_SIZE` square, with the bolt centred. */
  readonly screenArt: Buffer;
}

const RenderedChannel = Schema.Struct({
  housing: Schema.String,
  screen: Schema.String,
  bezel: Schema.String,
  screenArt: Schema.String,
});
const decodeRendered = Schema.decodeUnknownEffect(
  Schema.Record(Schema.Literals(ICON_CHANNELS), RenderedChannel),
);

export class StudioIconRenderError extends Schema.TaggedError<StudioIconRenderError>()(
  "StudioIconRenderError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to render the app icon from the studio's bolt computer.";
  }
}

const ICON_MODULE = "apps/marketing/src/lib/boltComputer/icon.ts";

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new StudioIconRenderError({ cause }) });

const fromDataUrl = (url: string) =>
  attempt(() =>
    sharp(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer(),
  );

const toBuffers = (images: typeof RenderedChannel.Type) =>
  Effect.all({
    housing: fromDataUrl(images.housing),
    screen: fromDataUrl(images.screen),
    bezel: fromDataUrl(images.bezel),
    screenArt: fromDataUrl(images.screenArt),
  });

/** The studio's bolt computer, drawn in headless Chromium as each channel's icon artwork. */
export const renderStudioIcons = Effect.fn("renderStudioIcons")(function* (repositoryRoot: string) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const node = yield* HostProcess.ExecutablePath;
  const playwrightCli = path.join(
    path.dirname(NodeModule.createRequire(import.meta.url).resolve("playwright-core/package.json")),
    "cli.js",
  );
  const installed = yield* spawner
    .exitCode(ChildProcess.make(node, [playwrightCli, "install", "chromium"]))
    .pipe(Effect.mapError((cause) => new StudioIconRenderError({ cause })));
  if (installed !== 0) {
    return yield* new StudioIconRenderError({
      cause: `playwright install chromium exited with ${installed}`,
    });
  }
  const bundle = yield* attempt(() =>
    build({
      entryPoints: [path.join(repositoryRoot, ICON_MODULE)],
      bundle: true,
      format: "iife",
      globalName: "StudioIcon",
      write: false,
    }),
  );
  const browser = yield* Effect.acquireRelease(
    attempt(() => chromium.launch()),
    (browser) => Effect.promise(() => browser.close()),
  );
  const page = yield* attempt(() => browser.newPage());
  yield* attempt(() => page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" }));
  // A string because scripts compile without DOM types; this runs in the page.
  const rendered = yield* attempt(() =>
    page.evaluate(`StudioIcon.renderBrandIcons(${ICON_LAYER_SIZE}, ${SCREEN_ART_SIZE})`),
  ).pipe(
    Effect.flatMap(decodeRendered),
    Effect.mapError((cause) => new StudioIconRenderError({ cause })),
  );
  return yield* Effect.all({
    prod: toBuffers(rendered.prod),
    nightly: toBuffers(rendered.nightly),
    dev: toBuffers(rendered.dev),
  });
}, Effect.scoped);
