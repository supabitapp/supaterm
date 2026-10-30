import {
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  VcsUnsupportedOperationError,
  WS_METHODS,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { request } from "../rpc/client.ts";
import { AsyncResult, Atom } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcQueryAtomFamily,
  type QueryAnswerHandler,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: {
    readonly onDiffPreviewAnswer?: QueryAnswerHandler<
      ReviewDiffPreviewInput,
      ReviewDiffPreviewResult
    >;
  } = {},
) {
  const patchReads = Semaphore.makeUnsafe(4);
  const diffFileScheduler = createAtomCommandScheduler();
  const diffPreview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:review:diff-preview",
    tag: WS_METHODS.reviewGetDiffPreview,
    staleTimeMs: 5_000,
    ...(options.onDiffPreviewAnswer === undefined ? {} : { onAnswer: options.onDiffPreviewAnswer }),
  });

  const previewRevisionFamily = Atom.family((key: string) => {
    const target = JSON.parse(key) as Parameters<typeof diffPreview>[0];
    return Atom.make((get) => {
      return Option.match(AsyncResult.value(get(diffPreview(target))), {
        onNone: () => null,
        onSome: (preview) => DateTime.formatIso(preview.generatedAt),
      });
    });
  });
  return {
    diffPreview,
    diffFilePatch: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:review:diff-file-patch",
      staleTimeMs: 5 * 60_000,
      refreshTrigger: ({ environmentId, input }) =>
        input.preview === undefined
          ? undefined
          : previewRevisionFamily(JSON.stringify({ environmentId, input: input.preview })),
      execute: (input: {
        request: ReviewDiffPreviewInput & { file: NonNullable<ReviewDiffPreviewInput["file"]> };
        cacheKey: string;

        preview?: ReviewDiffPreviewInput;
      }) =>
        request(WS_METHODS.reviewGetDiffPreview, input.request).pipe(
          patchReads.withPermit,
          Effect.flatMap((result) => {
            const source = result.sources.find(
              (source) => source.kind === input.request.file.sourceKind,
            );
            return source
              ? Effect.succeed(source)
              : Effect.fail(
                  new VcsUnsupportedOperationError({
                    operation: "review.diffFilePatch",
                    kind: "git",
                    detail: "Diff no longer available. Refresh the comparison.",
                  }),
                );
          }),
        ),
    }),
    diffFileContents: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:diff-file-contents",
      tag: WS_METHODS.reviewGetDiffFileContents,
      scheduler: diffFileScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([
            environmentId,
            input.cwd,
            input.sourceKind,
            input.baseRef,
            input.headRef,
            input.oldPath,
            input.newPath,
            input.changeType,
          ]),
      },
    }),
  };
}
