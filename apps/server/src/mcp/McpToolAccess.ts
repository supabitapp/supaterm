import {
  type OrchestrationV2LinkOrigin,
  OrchestratorMcpFailure,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Struct from "effect/Struct";
import type * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { McpSchema } from "effect/ai";
import type { Tool, Toolkit } from "effect/ai";

import {
  DispatchModeLimit,
  type DispatchModeRefusal,
} from "../orchestration-v2/DispatchModeLimit.ts";
import { assertNotLinked, assertSameLink, callerLinkOrigin } from "./linkOrigin.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { resolveInteractionMode, resolveRuntimeMode } from "./delegatedTaskModes.ts";
import {
  assertFullAccess,
  assertLiveCaller,
  assertTargetWithinLimits,
  type Caller,
  loadCaller,
  readCaller,
  unavailable,
} from "./threadAccess.ts";

/** Private constructors only enforce types; the token also blocks runtime construction. */
const builtHere: unique symbol = Symbol("supaterm/mcp/McpToolAccess/builtHere");

const refuseOutsideConstruction = (token: symbol) => {
  if (token !== builtHere) {
    throw new TypeError("Only McpToolAccess builds MCP tool declarations and handler layers.");
  }
};

let declare: <P, A, E, R>(
  handle: (params: P) => Effect.Effect<A, E, R>,
  remote: RemoteCheck<P> | undefined,
) => Declaration<(params: P) => Effect.Effect<A, E, R>>;

/**
 * What a call bound for a linked environment checks here before it goes: the
 * caller, not the thread or project it names, which live there and are
 * checked there. `undefined` for tools that act as the calling thread itself.
 */
type RemoteCheck<P> = (
  params: P,
) => Effect.Effect<unknown, OrchestratorMcpFailure, Effect.Services<typeof writingCaller>>;
let remoteCheckOf: <Handler>(declaration: Declaration<Handler>) => RemoteCheck<never> | undefined;

type CheckedHandlerOf<D> = D extends Declaration<infer Handler> ? Handler : never;

interface CheckedHandler extends Struct.Lambda {
  <Handler>(declaration: Declaration<Handler>): Handler;
  readonly "~lambda.out": CheckedHandlerOf<this["~lambda.in"]>;
}
let checkedHandler: CheckedHandler;

let handlersLayer: <Tools extends Record<string, Tool.Any>, EX, RX>(
  layer: Layer.Layer<Tool.HandlersFor<Tools>, EX, RX>,
) => HandlersLayer<Tools, EX, RX>;

/** supaterm/no-raw-mcp-registration confines Effect's unchecked registration API to McpHttpServer. */
export class Declaration<out Handler> {
  readonly #handle: Handler;
  readonly #remote: RemoteCheck<never> | undefined;
  private constructor(
    token: typeof builtHere,
    handle: Handler,
    remote: RemoteCheck<never> | undefined,
  ) {
    refuseOutsideConstruction(token);
    this.#handle = handle;
    this.#remote = remote;
  }
  static {
    declare = (handle, remote) => new Declaration(builtHere, handle, remote);
    checkedHandler = Struct.lambda<CheckedHandler>((declaration) => declaration.#handle);
    remoteCheckOf = (declaration) => declaration.#remote;
  }
}

const refuseReadOnlyClient = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) =>
    scope.client?.access === "read-only"
      ? Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              "This tool changes the environment, and this MCP client was approved for read-only access.",
          }),
        )
      : Effect.void,
  ),
);

const writingCaller = refuseReadOnlyClient.pipe(
  Effect.andThen(loadCaller()),
  Effect.tap(assertLiveCaller),
);

/** A side chat is the user's aside: it reads the main thread, but steers and starts nothing. */
const sideChatDenied = new OrchestratorMcpFailure({
  code: "capability_denied",
  message:
    "A side chat can read threads and work in itself, but cannot start, steer, or change other threads.",
});

const refuseSideChat = (caller: Caller) =>
  caller.caller?.lineage.sideChat === true ? Effect.fail(sideChatDenied) : Effect.void;

const orchestratingCaller = refuseReadOnlyClient.pipe(
  Effect.andThen(readCaller()),
  Effect.tap(assertLiveCaller),
  Effect.tap(refuseSideChat),
);

const requireThreadCaller = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This tool")),
);

/** A side chat reaches a linked environment only to read, as it does here. */
const writingCallerOutsideSideChat = writingCaller.pipe(Effect.tap(refuseSideChat));

export const reads = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
  declare(
    (params: P) => handle(params),
    () => Effect.void,
  );

export const readsAsCaller = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
  declare((params: P) => requireThreadCaller.pipe(Effect.flatMap(() => handle(params))), undefined);

export const actsAsCaller = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
  declare(
    (params: P) =>
      requireThreadCaller.pipe(
        Effect.andThen(writingCaller),
        Effect.flatMap(() => handle(params)),
      ),
    undefined,
  );

/**
 * Acts as the calling thread in ways a side chat may not: starting threads it owns, or moving the
 * checkout it shares with its parent.
 */
export const actsAsFullThread = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
  declare(
    (params: P) =>
      requireThreadCaller.pipe(
        Effect.andThen(writingCaller),
        Effect.tap(refuseSideChat),
        Effect.flatMap(() => handle(params)),
      ),
    undefined,
  );

/**
 * Changes something that belongs to no thread, such as a pending upload or a
 * scheduled task. Work a linked environment started may not: none of it
 * carries the link's origin, so none of it is that link's.
 */
export const writes = <P, A, E, R>(
  handle: (params: P) => Effect.Effect<A, E, R>,
  options?: {
    /** Whether a linked caller may make it, as for uploads its own sends need. */
    readonly linkedCallers?: "allowed" | { readonly refused: string };
  },
) =>
  declare(
    (params: P) =>
      orchestratingCaller.pipe(
        Effect.tap((caller) =>
          options?.linkedCallers === "allowed"
            ? Effect.void
            : assertNotLinked(
                caller,
                options?.linkedCallers?.refused ?? "change this environment's scheduled tasks",
              ),
        ),
        Effect.flatMap(() => handle(params)),
      ),
    () => orchestratingCaller,
  );

/** Requires handler capability checks, not thread control; linked work is refused the same way. */
export const writesWithCapability = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
  declare(
    (params: P) =>
      writingCaller.pipe(
        Effect.tap((caller) => assertNotLinked(caller, "start work here that is not its link's")),
        Effect.flatMap(() => handle(params)),
      ),
    () => writingCallerOutsideSideChat,
  );

const writeThreads = Effect.fn("mcp.writeThreads")(function* <A, E, R>(
  caller: Caller,
  threadIds: ReadonlyArray<ThreadId | undefined>,
  handle: Effect.Effect<A, E, R>,
) {
  for (const threadId of threadIds) {
    if (threadId === undefined || threadId === caller.scope.thread?.threadId) continue;
    yield* refuseSideChat(caller);
    const target = yield* caller.threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(unavailable));
    if (target !== null && target.deletedAt === null) {
      yield* assertTargetWithinLimits(caller.limits, target);
      yield* assertSameLink(caller, target);
    }
  }
  // Modes can rise after this check; the orchestrator rechecks under lock and records refusal before handlers wrap errors.
  const refused = yield* Ref.make<DispatchModeRefusal | undefined>(undefined);
  return yield* handle.pipe(
    Effect.provideService(DispatchModeLimit, { ...caller.limits, refused }),
    Effect.catch((error) =>
      Effect.flatMap(Ref.get(refused), (refusal) =>
        Effect.fail<E | OrchestratorMcpFailure>(
          refusal === undefined ? error : escalationDenied(refusal),
        ),
      ),
    ),
  );
});

export const writesThreads = <P, A, E, R>(
  threads: (params: P) => ReadonlyArray<ThreadId | undefined>,
  handle: (params: P) => Effect.Effect<A, E, R>,
) =>
  declare(
    (params: P) =>
      writingCaller.pipe(
        Effect.flatMap((caller) =>
          writeThreads(
            caller,
            threads(params),
            Effect.suspend(() => handle(params)),
          ),
        ),
      ),
    () => writingCallerOutsideSideChat,
  );

/** A fork is a new thread, so side chats are refused even when forking themselves. */
export const forksThreads = <P, A, E, R>(
  threads: (params: P) => ReadonlyArray<ThreadId | undefined>,
  handle: (params: P) => Effect.Effect<A, E, R>,
) =>
  declare(
    (params: P) =>
      writingCaller.pipe(
        Effect.tap(refuseSideChat),
        Effect.flatMap((caller) =>
          writeThreads(
            caller,
            threads(params),
            Effect.suspend(() => handle(params)),
          ),
        ),
      ),
    () => writingCallerOutsideSideChat,
  );

/** One tool with two access rules, picked per call, such as create versus update. */
export const either = <P, A, E, R, A2, E2, R2>(
  useFirst: (params: P) => boolean,
  first: Declaration<(params: P) => Effect.Effect<A, E, R>>,
  second: Declaration<(params: P) => Effect.Effect<A2, E2, R2>>,
) => {
  const remotes = [remoteCheckOf(first), remoteCheckOf(second)] as ReadonlyArray<
    RemoteCheck<P> | undefined
  >;
  return declare(
    (params: P): Effect.Effect<A | A2, E | E2, R | R2> =>
      useFirst(params) ? checkedHandler(first)(params) : checkedHandler(second)(params),
    (params) =>
      remotes[useFirst(params) ? 0 : 1]?.(params) ??
      Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "This action acts as the calling thread, which is here. Omit environmentId.",
        }),
      ),
  );
};

const escalationDenied = (refusal: DispatchModeRefusal) =>
  new OrchestratorMcpFailure({
    code:
      refusal.mode === "runtime"
        ? "runtime_mode_escalation_denied"
        : "interaction_mode_escalation_denied",
    message: `Thread ${refusal.threadId} now runs in ${refusal.runtimeMode}/${refusal.interactionMode} mode, above this caller's. Its user changed it while this call ran.`,
  });

export interface StartedModes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /** The linked environment the caller acts for. The thread must carry it. */
  readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
}

/**
 * Starts threads with the modes `modes` requests, which may not be broader
 * than the caller's. `linked` says what a linked caller gets: threads stamped
 * with its `linkOrigin`, or a refusal where the tool cannot carry one.
 */
export const startsThreads = <P, A, E, R>(
  modes: (params: P) => {
    readonly runtimeMode?: RuntimeMode | undefined;
    readonly interactionMode?: ProviderInteractionMode | undefined;
  },
  handle: (params: P, modes: StartedModes) => Effect.Effect<A, E, R>,
  linked: "stamped" | { readonly refused: string },
) => {
  const started = Effect.fn("McpToolAccess.started")(function* (caller: Caller, params: P) {
    const requested = modes(params);
    return {
      runtimeMode: yield* resolveRuntimeMode(caller.limits.runtimeMode, requested.runtimeMode),
      interactionMode: yield* resolveInteractionMode(
        caller.limits.interactionMode,
        requested.interactionMode,
      ),
      linkOrigin: callerLinkOrigin(caller),
    } satisfies StartedModes;
  });
  return declare(
    (params: P) =>
      Effect.gen(function* () {
        const caller = yield* writingCallerOutsideSideChat;
        if (linked !== "stamped") yield* assertNotLinked(caller, linked.refused);
        return yield* handle(params, yield* started(caller, params));
      }),
    (params: P) =>
      Effect.flatMap(writingCallerOutsideSideChat, (caller) => started(caller, params)),
  );
};

const fullAccessRequired =
  "Changing projects or environment settings needs a live full-access/default calling thread or a full-access client.";

/** Recheck after waits before writing; caller modes may have changed. */
export const writesEnvironment = <P, A, E, R>(
  handle: (
    params: P,
    check: Effect.Effect<Caller, OrchestratorMcpFailure, CheckServices>,
  ) => Effect.Effect<A, E, R>,
  options?: {
    /**
     * Whether a linked caller may make it, as for adding a project: it leaves
     * everything already here as it was.
     */
    readonly linkedCallers?: "allowed";
  },
) => {
  const check = orchestratingCaller.pipe(
    Effect.tap((caller) =>
      options?.linkedCallers === "allowed"
        ? Effect.void
        : assertNotLinked(caller, "change projects or environment settings"),
    ),
    Effect.tap((caller) => assertFullAccess(caller, fullAccessRequired)),
  );
  return declare(
    (params: P) => check.pipe(Effect.flatMap(() => handle(params, check))),
    // Linked work never reaches a link at all; that is checked as the call goes.
    () =>
      orchestratingCaller.pipe(
        Effect.tap((caller) => assertFullAccess(caller, fullAccessRequired)),
      ),
  );
};

type CheckServices = Effect.Services<typeof orchestratingCaller>;

type Declarations<Handlers> = {
  readonly [Name in keyof Handlers]: Declaration<Handlers[Name]> & NotCallable;
};

type NotCallable = { readonly call?: never } & { readonly apply?: never };

export type Handlers<Tools extends Record<string, Tool.Any>> = Declarations<
  Toolkit.HandlersFrom<Tools>
>;

export class HandlersLayer<Tools extends Record<string, Tool.Any>, EX = never, RX = never> {
  readonly #layer: Layer.Layer<Tool.HandlersFor<Tools>, EX, RX>;
  private constructor(
    token: typeof builtHere,
    layer: Layer.Layer<Tool.HandlersFor<Tools>, EX, RX>,
  ) {
    refuseOutsideConstruction(token);
    this.#layer = layer;
  }
  static {
    handlersLayer = (layer) => new HandlersLayer(builtHere, layer);
  }
  static layer<Tools extends Record<string, Tool.Any>, EX, RX>(
    handlers: HandlersLayer<Tools, EX, RX>,
  ) {
    return handlers.#layer;
  }
}

const checkedHandlers = <Handlers>(declarations: Declarations<Handlers>): Handlers =>
  Struct.map(declarations, checkedHandler);

const hiddenFromOutsideClientsWhenThreadBound = Effect.fn(
  "McpToolAccess.hiddenFromOutsideClientsWhenThreadBound",
)(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  declarations: Handlers<Tools>,
  checked: Toolkit.HandlersFrom<Tools>,
) {
  for (const [name, declaration] of Object.entries<Declaration<unknown>>(declarations)) {
    const tool = toolkit.tools[name];
    if (
      tool !== undefined &&
      remoteCheckOf(declaration) === undefined &&
      Context.getOrUndefined(tool.annotations, McpSchema.EnabledWhen) !==
        McpInvocationContext.hiddenFromOutsideClients
    )
      return yield* Effect.die(
        `${name} acts as its calling thread, so outside clients must not be offered it.`,
      );
  }
  return checked;
});

export const toLayer = <Tools extends Record<string, Tool.Any>, EX = never, RX = never>(
  toolkit: Toolkit.Toolkit<Tools>,
  build: Handlers<Tools> | Effect.Effect<Handlers<Tools>, EX, RX>,
): HandlersLayer<Tools, EX, Exclude<RX, Scope.Scope>> => {
  // Checked as soon as they are given, so a forged declaration fails here.
  const withDeclarations = (declarations: Handlers<Tools>) =>
    hiddenFromOutsideClientsWhenThreadBound(toolkit, declarations, checkedHandlers(declarations));
  return handlersLayer(
    toolkit.toLayer(
      Effect.isEffect(build) ? Effect.flatMap(build, withDeclarations) : withDeclarations(build),
    ),
  );
};
