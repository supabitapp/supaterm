import type {
  EnvironmentId,
  PreviewAppearancePreference,
  PreviewOpenInput,
  PreviewRuntime,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
  PreviewZoomFactor,
  ScopedThreadRef,
} from "@supaterm/contracts";
import type { AtomCommandResult } from "@supaterm/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { resolveBrowserDefaults } from "~/browser/browserDefaults";
import { BrowserSettingsReadError } from "~/browser/openFileInPreview";
import { previewRuntimeFor } from "~/browser/previewRuntime";
import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
  viewport?: PreviewViewportSetting;
  profileId?: string;
  zoomFactor?: PreviewZoomFactor;
  colorScheme?: PreviewAppearancePreference;
  runtime?: PreviewRuntime;
}

export function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E | BrowserSettingsReadError>>;
export async function openPreviewSession<E>(input: OpenPreviewSessionInput<E>) {
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults)) satisfies AtomCommandResult<
      PreviewSessionSnapshot,
      E | BrowserSettingsReadError
    >;
  }
  const runtime = input.runtime ?? previewRuntimeFor(input.threadRef.environmentId);
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      ...(input.url === undefined ? {} : { url: input.url }),
      viewport: input.viewport ?? defaults.viewport,
      profileId: input.profileId ?? defaults.profileId,
      ...(runtime === undefined || runtime === "desktop"
        ? {}
        : {
            runtime,
            zoomFactor: input.zoomFactor ?? defaults.zoomFactor,
            colorScheme: input.colorScheme ?? defaults.appearance,
          }),
    },
  });
  if (result._tag === "Failure") {
    return result satisfies AtomCommandResult<PreviewSessionSnapshot, E | BrowserSettingsReadError>;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result satisfies AtomCommandResult<PreviewSessionSnapshot, E | BrowserSettingsReadError>;
}
