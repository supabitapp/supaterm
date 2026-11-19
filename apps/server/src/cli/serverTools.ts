import { OrchestratorMcpFailure, ProjectId } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
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
import {
  mcpToolSession,
  type McpToolSession,
  type McpToolSessionOptions,
} from "../mcp/AcpMcpStdioBridge.ts";
import { expandHomePath } from "../os-jank.ts";
import * as ProcessRunner from "../processRunner.ts";
import { readLiveServerRuntimeState } from "../serverRuntimeState.ts";
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
  override get message() {
    const hint = this.inLinkedWorktree
      ? " In a linked worktree, pass --base-dir to reach a server outside it."
      : "";
    return `No running Supaterm server uses ${this.baseDir}. Start Supaterm, then retry.${hint}` satisfies string as string;
  }
}

export class CliServerUnreachableError extends Schema.TaggedError<CliServerUnreachableError>()(
  "CliServerUnreachableError",
  { origin: Schema.String, cause: Schema.Defect() },
) {
  override readonly [Runtime.errorReported] = false;
  override get message() {
    const reason = this.cause instanceof Error ? ` ${this.cause.message}` : "";
    return `Could not reach the Supaterm server at ${this.origin}.${reason}` satisfies string as string;
  }
}

export class CliToolFailedError extends Schema.TaggedError<CliToolFailedError>()(
  "CliToolFailedError",
  { tool: Schema.String, detail: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message() {
    return this.detail satisfies string as string;
  }
}

export class CliProjectNotFoundError extends Schema.TaggedError<CliProjectNotFoundError>()(
  "CliProjectNotFoundError",
  { identifier: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message() {
    return `No Supaterm project matches '${this.identifier}'. Pass a project id or a path inside a project.` satisfies string as string;
  }
}

export class CliProjectAmbiguousError extends Schema.TaggedError<CliProjectAmbiguousError>()(
  "CliProjectAmbiguousError",
  { identifier: Schema.String, projects: Schema.Array(Schema.String) },
) {
  override readonly [Runtime.errorReported] = false;
  override get message() {
    return `'${this.identifier}' is in a git worktree shared by several projects: ${this.projects.join(", ")}. Pass a project id instead.` satisfies string as string;
  }
}

export const ServerToolsErrors = [
  CliServerNotRunningError,
  CliServerVersionMismatchError,
  CliServerUnreachableError,
  CliToolFailedError,
  CliProjectNotFoundError,
  CliProjectAmbiguousError,
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
    ) {
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

export const CliMcpToolSession = Context.Reference<
  (options: McpToolSessionOptions) => ReturnType<typeof mcpToolSession>
>("supaterm/cli/CliMcpToolSession", { defaultValue: () => mcpToolSession });

/**
 * Signs in as a short-lived MCP client of the running server, the same way an
 * outside agent does, and revokes that session when the command ends.
 */
export const withServerTools = Effect.fn("cli.serverTools.withServerTools")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string>; readonly json?: boolean },
  client: { readonly label: string; readonly name: string },
  run: (tools: ServerTools) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const worktreeHome = yield* resolveCliWorktreeHome(flags.baseDir);
  const quietLogs = flags.json === true;
  const config = yield* resolveCliAuthConfig(
    { baseDir: worktreeHome === undefined ? flags.baseDir : Option.some(worktreeHome) },
    logLevel,
    { quietLogs },
  );
  const minimumLogLevel = quietLogs ? "Error" : config.logLevel;
  const runtimeState = yield* readLiveServerRuntimeState(config.serverRuntimeStatePath);
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
        label: client.label,
        access: "full-access",
        client: { deviceType: "bot" },
      }),
      (session) =>
        environmentAuth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
    const openSession = yield* CliMcpToolSession;
    const session = yield* openSession({
      endpoint: new URL("/mcp", origin).href,
      authorization: `Bearer ${issued.token}`,
      clientName: client.name,
    }).pipe(Effect.mapError((cause) => new CliServerUnreachableError({ origin, cause })));
    return yield* run(makeServerTools(session, origin));
  }).pipe(
    Effect.scoped,
    Effect.provideService(References.MinimumLogLevel, minimumLogLevel),
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
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

const listGitCheckouts = Effect.fn("cli.serverTools.listGitCheckouts")(function* (
  directory: string,
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const list = (args: ReadonlyArray<string>) =>
    processRunner
      .run({ command: "git", args: ["worktree", "list", "--porcelain", ...args], cwd: directory })
      .pipe(
        Effect.option,
        Effect.map((result) =>
          Option.isSome(result) && result.value.code === 0 ? result.value.stdout : undefined,
        ),
      );
  const stdout = (yield* list(["-z"])) ?? (yield* list([]))?.replaceAll("\n", "\0") ?? "";
  return stdout.split("\0\0").flatMap((record) => {
    const [first = "", ...attributes] = record.split("\0");
    return first.startsWith("worktree ") && !attributes.includes("bare")
      ? [first.slice("worktree ".length)]
      : [];
  });
});

/**
 * A project id, or a path inside a project's folder (deepest project wins).
 * A path inside a git worktree resolves as the same path in the repository's
 * other checkouts.
 */
export const resolveProject = Effect.fn("cli.serverTools.resolveProject")(function* (
  tools: ServerTools,
  identifier: string,
) {
  const projects = yield* listAllProjects(tools);
  const byId = projects.find((project) => project.id === identifier);
  if (byId !== undefined) return byId;

  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const realPath = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const target = yield* realPath(
    path.resolve(yield* HostProcess.WorkingDirectory, yield* expandHomePath(identifier)),
  );
  const roots = yield* Effect.forEach(projects, (project) =>
    Effect.map(realPath(project.workspaceRoot), (root) => ({ project, root })),
  );
  const contains = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  const deepestContaining = (candidate: string) =>
    roots
      .filter(({ root }) => contains(root, candidate))
      .toSorted((left, right) => right.root.length - left.root.length)[0]?.project;

  const containing = deepestContaining(target);
  if (containing !== undefined) return containing;
  const targetInfo = yield* fileSystem.stat(target).pipe(Effect.option);
  const gitDirectory =
    Option.isSome(targetInfo) && targetInfo.value.type === "File" ? path.dirname(target) : target;
  const listed = yield* listGitCheckouts(gitDirectory).pipe(
    Effect.flatMap((paths) => Effect.forEach(paths, realPath)),
    Effect.provide(ProcessRunner.layer),
  );
  const ownCheckout = listed
    .filter((checkout) => contains(checkout, target))
    .toSorted((left, right) => right.length - left.length)[0];
  if (ownCheckout === undefined) {
    return yield* new CliProjectNotFoundError({ identifier });
  }
  const relative = path.relative(ownCheckout, target);
  const matches = new Map<ProjectId, (typeof projects)[number]>();
  for (const checkout of listed) {
    if (checkout === ownCheckout) continue;
    const project = deepestContaining(path.join(checkout, relative));
    if (project !== undefined) matches.set(project.id, project);
  }
  const [match, ...others] = matches.values();
  if (match === undefined) {
    return yield* new CliProjectNotFoundError({ identifier });
  }
  if (others.length > 0) {
    return yield* new CliProjectAmbiguousError({
      identifier,
      projects: [match, ...others].map((project) => `${project.title} (${project.id})`),
    });
  }
  return match;
});
