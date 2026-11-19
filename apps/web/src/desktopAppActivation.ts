import type { ConnectionAttemptError } from "@supaterm/client-runtime/connection";
import type { ConnectionPersistenceError } from "@supaterm/client-runtime/platform";
import type { AtomCommandResult } from "@supaterm/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type {
  DesktopAppActivationFailure,
  DesktopAppActivationRequest,
  DesktopAppOpenWorkspaceRequest,
  DesktopAppAddConnectionRequest,
  DesktopAppActivationPlatform,
  DesktopAppActivationResponse,
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  ProjectId,
  ScopedProjectRef,
  ThreadId,
} from "@supaterm/contracts";

export interface DesktopAppActivationProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

export interface DesktopAppActivationTarget {
  readonly environmentId: EnvironmentId;
  readonly platform: ExecutionEnvironmentPlatformOs;
}

export interface DesktopAppActivationDependencies {
  readonly getTarget: () => DesktopAppActivationTarget | null;
  readonly findProject: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
  ) => DesktopAppActivationProject | null;
  readonly createProject: (
    environmentId: EnvironmentId,
    workspaceRoot: string,
  ) => Promise<ProjectId>;
  readonly waitForProject: (projectRef: ScopedProjectRef) => Promise<void>;
  readonly openThread: (
    projectRef: ScopedProjectRef,
  ) => Promise<{ readonly threadId: ThreadId } | null>;
}

function failure(requestId: string, code: DesktopAppActivationFailure["code"], message: string) {
  return { version: 1, requestId, ok: false, code, message } satisfies DesktopAppActivationFailure;
}

function desktopPlatformToEnvironmentOs(platform: DesktopAppActivationPlatform) {
  return platform === "win32" ? "windows" : platform;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export async function handleDesktopAppActivationRequest(
  request: DesktopAppOpenWorkspaceRequest,
  dependencies: DesktopAppActivationDependencies,
) {
  const target = dependencies.getTarget();
  if (target === null) {
    return failure(
      request.requestId,
      "environment-unavailable",
      "The desktop app's primary local environment is not connected.",
    ) satisfies DesktopAppActivationResponse;
  }

  const requestPlatform = desktopPlatformToEnvironmentOs(request.platform);
  if (requestPlatform !== target.platform) {
    return failure(
      request.requestId,
      "platform-mismatch",
      `The command path is for ${requestPlatform}, but the desktop app's primary environment uses ${target.platform}. Cross-platform path mapping is not supported.`,
    ) satisfies DesktopAppActivationResponse;
  }

  let projectId = dependencies.findProject(target.environmentId, request.workspaceRoot)?.id ?? null;
  if (projectId === null) {
    try {
      projectId = await dependencies.createProject(target.environmentId, request.workspaceRoot);
      await dependencies.waitForProject({ environmentId: target.environmentId, projectId });
    } catch (error) {
      return failure(
        request.requestId,
        "project-create-failed",
        errorMessage(error, "Supaterm could not add the project."),
      ) satisfies DesktopAppActivationResponse;
    }
  }

  try {
    const opened = await dependencies.openThread({
      environmentId: target.environmentId,
      projectId,
    });
    if (opened === null) {
      return failure(
        request.requestId,
        "thread-open-failed",
        "Supaterm could not open a new thread for the project.",
      ) satisfies DesktopAppActivationResponse;
    }
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId,
      threadId: opened.threadId,
    } satisfies DesktopAppActivationResponse;
  } catch (error) {
    return failure(
      request.requestId,
      "thread-open-failed",
      errorMessage(error, "Supaterm could not open a new thread for the project."),
    ) satisfies DesktopAppActivationResponse;
  }
}

export async function handleDesktopAppConnectionRequest(
  request: DesktopAppAddConnectionRequest,
  registerPairing: (input: {
    readonly pairingUrl: string;
  }) => Promise<
    AtomCommandResult<EnvironmentId, ConnectionAttemptError | ConnectionPersistenceError>
  >,
) {
  const result = await registerPairing({ pairingUrl: request.pairingUrl });
  if (result._tag === "Success") {
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      result: "connection-added",
      environmentId: result.value,
    } satisfies DesktopAppActivationResponse;
  }
  const error = Cause.findErrorOption(result.cause);
  if (Option.isNone(error)) {
    return failure(
      request.requestId,
      "internal-error",
      "Supaterm could not complete the connection request.",
    ) satisfies DesktopAppActivationResponse;
  }
  if (error.value._tag === "ConnectionPersistenceError") {
    return failure(
      request.requestId,
      "connection-save-failed",
      "Supaterm could not save the connection. Check secure storage and try pairing again.",
    ) satisfies DesktopAppActivationResponse;
  }
  return failure(
    request.requestId,
    "pairing-failed",
    "Supaterm could not pair with the environment. Check its address and use a fresh pairing link.",
  ) satisfies DesktopAppActivationResponse;
}

export function createDesktopAppActivationRunner() {
  let running = false;
  return async (
    request: DesktopAppActivationRequest,
    process: (request: DesktopAppActivationRequest) => Promise<DesktopAppActivationResponse>,
    complete: (response: DesktopAppActivationResponse) => Promise<void>,
  ) => {
    if (running) {
      await complete(
        failure(
          request.requestId,
          "request-busy",
          "The desktop app is handling another command. Try again after it finishes.",
        ),
      );
      return;
    }
    running = true;
    let response: DesktopAppActivationResponse;
    try {
      response = await process(request);
    } catch {
      response = failure(
        request.requestId,
        "internal-error",
        "Supaterm could not complete the desktop request.",
      );
    } finally {
      running = false;
    }
    await complete(response);
  };
}
