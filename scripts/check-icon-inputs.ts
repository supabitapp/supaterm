#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ICON_INPUTS_STAMP, iconInputsDigest } from "./lib/studio-icon-render.ts";

class IconInputsStaleError extends Schema.TaggedError<IconInputsStaleError>()(
  "IconInputsStaleError",
  {},
) {
  override get message(): string {
    return `The bolt computer or the icon's appearance changed since the icons were last rendered. Run \`vp run icons:export\` on macOS and commit the result (${ICON_INPUTS_STAMP}).`;
  }
}

/** Fails when the icons' sources no longer match the digest `icons:export` last wrote. */
const checkIconInputs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const recorded = yield* fs
    .readFileString(path.join(repositoryRoot, ICON_INPUTS_STAMP))
    .pipe(Effect.orElseSucceed(() => ""));
  if (recorded !== (yield* iconInputsDigest(repositoryRoot))) {
    return yield* new IconInputsStaleError();
  }
  yield* Console.log("The rendered icons match their sources.");
});

if (import.meta.main) {
  checkIconInputs.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
