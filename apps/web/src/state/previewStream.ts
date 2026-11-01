import { useAtomValue } from "@effect/atom-react";
import { PREVIEW_STREAM_BASE_PATH } from "@supaterm/client-runtime/preview/server-browser-stream";
import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
} from "@supaterm/client-runtime/state/deviceHubAccess";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSession } from "./session";

const ACCESS_RETRY_INTERVAL_MS = 10_000;

const previewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`preview-stream-access:${environmentId}`)),
);

// Only a surface the user is looking at retries a failed lookup; one-shot readers such as
// picture-in-picture see the failure at once.
const retryingPreviewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const access = previewStreamAccessAtom(environmentId);
    const result = get(access);
    if (AsyncResult.isFailure(result)) {
      const timer = setTimeout(() => get.refresh(access), ACCESS_RETRY_INTERVAL_MS);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return result;
  }),
);

export function usePreviewStreamAccess(
  environmentId: EnvironmentId,
  options?: { readonly retry: boolean },
): DeviceHubAccess | null {
  const result = useAtomValue(
    options?.retry
      ? retryingPreviewStreamAccessAtom(environmentId)
      : previewStreamAccessAtom(environmentId),
  );
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function refreshPreviewStreamAccess(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(previewStreamAccessAtom(environmentId));
}

export function readPreviewStreamAccess(
  environmentId: EnvironmentId,
  refresh: boolean,
): Promise<DeviceHubAccess | null> {
  const atom = previewStreamAccessAtom(environmentId);
  if (refresh) appAtomRegistry.refresh(atom);
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}

/** Resolves fresh access without refreshing the ticket held by an active viewer. */
export function readFreshPreviewStreamAccess(
  environmentId: EnvironmentId,
): Promise<DeviceHubAccess | null> {
  const prepared = Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
  );
  if (prepared === null) return Promise.resolve(null);
  const freshAccessAtom = connectionAtomRuntime
    .atom(resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH }))
    .pipe(Atom.withLabel(`preview-transfer-access:${environmentId}`));
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, freshAccessAtom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}
