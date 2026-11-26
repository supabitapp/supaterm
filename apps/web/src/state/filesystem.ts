import {
  createFilesystemEnvironmentAtoms,
  resolveFilesystemReadAccess,
} from "@supaterm/client-runtime/state/filesystem";
import type { EnvironmentId } from "@supaterm/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentPresentation } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { environmentSession } from "./session";
import { m } from "../i18n/messages";
import { type MessageResolver } from "../i18n/messages";

export const filesystemEnvironment = createFilesystemEnvironmentAtoms(connectionAtomRuntime);

export function useFilesystemReadAccess(
  environmentId: EnvironmentId | null,
  resolve: MessageResolver = m,
) {
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
    resolve,
  );
  const environment = useEnvironmentPresentation(environmentId);
  return resolveFilesystemReadAccess(
    {
      isCatalogReady: environment.isReady,
      connection: environment.presentation?.connection ?? null,
      session: session.data,
      sessionError: session.error,
    },
    resolve,
  );
}
