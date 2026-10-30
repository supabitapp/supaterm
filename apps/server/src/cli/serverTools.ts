import { OrchestratorMcpFailure, ProjectId } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { GlobalFlag } from "effect/cli";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { mcpToolSession, type McpToolSession } from "../mcp/AcpMcpStdioBridge.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  CliServerVersionMismatchError,
  requireMatchingServerVersion,
  resolveCliAuthConfig,
  resolveCliWorktreeHome,
} from "./config.ts";

export class CliServerNotRunningError extends Schema.TaggedError<CliServerNotRunningError>()(
  "CliServerNotRunningError",
  { baseDir: Schema.String, inLinkedWorktree: Schema.Boolean },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    const hint = this.inLinkedWorktree
      ? " In a linked worktree, pass --base-dir to reach a server outside it."
      : "";
    return `No running Supaterm server uses ${this.baseDir}. Start Supaterm, then retry.${hint}`;
  }
}

export class CliServerUnreachableError extends Schema.TaggedError<CliServerUnreachableError>()(
  "CliServerUnreachableError",
  { origin: Schema.String, cause: Schema.Defect() },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    const reason = this.cause instanceof Error ? ` ${this.cause.message}` : "";
    return `Could not reach the Supaterm server at ${this.origin}.${reason}`;
  }
}

export class CliToolFailedError extends Schema.TaggedError<CliToolFailedError>()(
  "CliToolFailedError",
  { tool: Schema.String, detail: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

export class CliProjectNotFoundError extends Schema.TaggedError<CliProjectNotFoundError>()(
  "CliProjectNotFoundError",
  { identifier: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No Supaterm project matches '${this.identifier}'. Pass a project id or a path inside a project.`;
  }
}

export const ServerToolsErrors = [
  CliServerNotRunningError,
  CliServerVersionMismatchError,
  CliServerUnreachableError,
  CliToolFailedError,
  CliProjectNotFoundError,
] as const;

/**
 * These errors are expected outcomes for a script, so they print as one line
 * on stderr instead of the runtime's logged stack trace.
 */
export const reportExpectedErrors =
  (isExpected: (error: unknown) => error is { readonly message: string }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((error) => (isExpected(error) ? Console.error(error.message) : Effect.void)),
    );

const decodeFailureText = Schema.decodeUnknownOption(Schema.fromJsonString(OrchestratorMcpFailure));

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Unknown),
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
});

const decodeToolResult = Schema.decodeUnknownEffect(ToolResult);

const toolFailureDetail = (result: typeof ToolResult.Type) => {
  const text = result.content?.find((part) => part.text !== undefined)?.text ?? "";
  return Option.match(decodeFailureText(text), {
    onNone: () => text || "The tool call failed.",
    onSome: (failure) => failure.message,
  });
};

export const makeServerTools = (session: McpToolSession, origin: string) => {
  const unexpected = (tool: string) =>
    new CliToolFailedError({
      tool,
      detail: `The server sent an unexpected ${tool} result. Update the supaterm CLI to match the server.`,
    });
  return {
    origin,
    call: Effect.fn("cli.serverTools.callTool")(function* <S extends Schema.Decoder<unknown>>(
      tool: string,
      args: Readonly<Record<string, unknown>>,
      schema: S,
    ): Effect.fn.Return<S["Type"], CliServerUnreachableError | CliToolFailedError> {
      const raw = yield* session
        .call(tool, args)
        .pipe(Effect.mapError((cause) => new CliServerUnreachableError({ origin, cause })));
      const result = yield* decodeToolResult(raw).pipe(Effect.mapError(() => unexpected(tool)));
      if (result.isError === true) {
        return yield* new CliToolFailedError({ tool, detail: toolFailureDetail(result) });
      }
      return yield* Schema.decodeUnknownEffect(schema)(result.structuredContent).pipe(
        Effect.mapError(() => unexpected(tool)),
      );
    }),
  };
};
export type ServerTools = ReturnType<typeof makeServerTools>;

/**
 * Signs in as a short-lived MCP client of the running server, the same way an
 * outside agent does, and revokes that session when the command ends.
 */
export const withServerTools = Effect.fn("cli.serverTools.withServerTools")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  client: { readonly label: string; readonly name: string },
  run: (tools: ServerTools) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const worktreeHome = yield* resolveCliWorktreeHome(flags.baseDir);
  const config = yield* resolveCliAuthConfig(
    { baseDir: worktreeHome === undefined ? flags.baseDir : Option.some(worktreeHome) },
    logLevel,
  );
  // Checked before the auth layer opens the database, so a home with no server
  // is left untouched.
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return yield* new CliServerNotRunningError({
      baseDir: config.baseDir,
      inLinkedWorktree: worktreeHome !== undefined,
    });
  }
  yield* requireMatchingServerVersion(runtimeState.value);
  const origin = runtimeState.value.origin;
  return yield* Effect.gen(function* () {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const issued = yield* Effect.acquireRelease(
      environmentAuth.issueMcpClientSession({
        peerLink: false,
        label: client.label,
        // The CLI runs as the machine's owner. A server from this build starts
        // new threads at the project's default mode, never at this ceiling.
        access: "full-access",
        client: { deviceType: "bot" },
      }),
      (session) =>
        environmentAuth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
    const session = yield* mcpToolSession({
      endpoint: new URL("/mcp", origin).href,
      authorization: `Bearer ${issued.token}`,
      clientName: client.name,
    }).pipe(Effect.mapError((cause) => new CliServerUnreachableError({ origin, cause })));
    return yield* run(makeServerTools(session, origin));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

const ProjectListResult = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({ id: ProjectId, title: Schema.String, workspaceRoot: Schema.String }),
  ),
  nextCursor: Schema.NullOr(Schema.Int),
});

const listAllProjects = Effect.fn("cli.serverTools.listAllProjects")(function* (
  tools: ServerTools,
) {
  const projects: Array<(typeof ProjectListResult.Type)["projects"][number]> = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page: typeof ProjectListResult.Type = yield* tools.call(
      "supaterm_project_list",
      { cursor, limit: 100 },
      ProjectListResult,
    );
    projects.push(...page.projects);
    cursor = page.nextCursor;
  }
  return projects;
});

/** A project id, or a path inside a project's folder (deepest project wins). */
export const resolveProject = Effect.fn("cli.serverTools.resolveProject")(function* (
  tools: ServerTools,
  identifier: string,
) {
  const projects = yield* listAllProjects(tools);
  const byId = projects.find((project) => project.id === identifier);
  if (byId !== undefined) return byId;

  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  // Stored roots keep the path the project was added with, which may pass
  // through a symlink (macOS /tmp), so both sides compare as real paths.
  const realPath = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const target = yield* realPath(path.resolve(yield* HostProcess.WorkingDirectory, identifier));
  const roots = yield* Effect.forEach(projects, (project) =>
    Effect.map(realPath(project.workspaceRoot), (root) => ({ project, root })),
  );
  const containing = roots
    .filter(({ root }) => {
      const relative = path.relative(root, target);
      return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    })
    .toSorted((left, right) => right.root.length - left.root.length)[0];
  if (containing === undefined) {
    return yield* new CliProjectNotFoundError({ identifier });
  }
  return containing.project;
});
