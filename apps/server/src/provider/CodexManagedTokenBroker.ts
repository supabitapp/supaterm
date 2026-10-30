// @effect-diagnostics nodeBuiltinImport:off - Server-owned private pipe/Unix socket, never a public listener.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { makeCodexChatGptAuth } from "./CodexChatGptAuth.ts";
import * as Protocol from "./CodexManagedTokenProtocol.ts";

const MAX_CONNECTIONS = 32;
const MAX_JOBS = 16;

const UNIX_SOCKET_PATH_BYTES = 100;
const encodeResponse = Schema.encodeSync(Schema.fromJsonString(Protocol.Response));
class BrokerStartError extends Schema.TaggedError<BrokerStartError>()(
  "ManagedTokenBrokerStartError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return "Could not start the private managed token listener.";
  }
}
export class CodexManagedTokenBroker extends Context.Service<
  CodexManagedTokenBroker,
  {
    readonly endpoint: Effect.Effect<string, BrokerStartError>;
    readonly awaitIdle: Effect.Effect<void>;
  }
>()("supaterm/provider/CodexManagedTokenBroker") {}

const io = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new BrokerStartError({ cause }) });
const acquireListener = Effect.gen(function* () {
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const platform = yield* HostProcess.Platform;
  const uid = yield* HostProcess.UserId;
  const owned = yield* Effect.acquireRelease(
    io(async () => {
      if (platform === "win32")
        return { endpoint: `\\\\.\\pipe\\supaterm-token-${NodeCrypto.randomUUID()}` };
      if (uid === undefined) throw new Error("Missing IPC owner");
      const acquireDirectory = async (candidate: string) => {
        const parent = await NodeFSP.realpath(candidate);
        const stat = await NodeFSP.lstat(parent);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          !(
            (stat.uid === uid && (stat.mode & 0o022) === 0) ||
            (stat.uid === 0 && ((stat.mode & 0o022) === 0 || (stat.mode & 0o1000) !== 0))
          )
        )
          throw new Error("Untrusted IPC parent");
        const directory = await NodeFSP.mkdtemp(NodePath.join(parent, "supaterm-token-"));
        try {
          await NodeFSP.chmod(directory, 0o700);
          const created = await NodeFSP.lstat(directory);
          if (
            !created.isDirectory() ||
            created.isSymbolicLink() ||
            created.uid !== uid ||
            (created.mode & 0o777) !== 0o700
          )
            throw new Error("Unprotected IPC directory");
          const endpoint = NodePath.join(directory, "s");
          if (Buffer.byteLength(endpoint) > UNIX_SOCKET_PATH_BYTES)
            throw new Error("IPC path too long");
          return { endpoint, directory, created };
        } catch (error) {
          await NodeFSP.rmdir(directory);
          throw error;
        }
      };
      return acquireDirectory(NodeOS.tmpdir()).catch(() => acquireDirectory("/tmp"));
    }),
    (owned) =>
      Effect.promise(async () => {
        if (!("directory" in owned)) return;
        
        const current = await NodeFSP.lstat(owned.directory).catch(() => undefined);
        if (
          current &&
          current.dev === owned.created.dev &&
          current.ino === owned.created.ino &&
          !current.isSymbolicLink()
        )
          await NodeFSP.rmdir(owned.directory).catch(() => undefined);
      }),
  );
  const jobs = yield* FiberSet.make<void>();
  const runJob =
    yield* FiberSet.runtime(jobs)<
      Exclude<
        Effect.Services<ReturnType<typeof makeCodexChatGptAuth>>,
        import("effect/Scope").Scope
      >
    >();
  const connections = yield* FiberSet.make<void>();
  const runConnection = yield* FiberSet.runtime(connections)();
  const sockets = new Set<NodeNet.Socket>();
  let closing = false;
  let admitted = 0;
  
  const decode = Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        ...Protocol.Request.fields,
        instanceId: ProviderInstanceId,
        environmentId: EnvironmentId,
      }),
    ),
    {
      onExcessProperty: "error",
    },
  );
  const server = NodeNet.createServer((socket) => {
    socket.on("error", () => {});
    if (closing || sockets.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let transferred = false;
    runConnection(
      Effect.gen(function* () {
        
        const request = yield* Protocol.readFrame(
          socket,
          Protocol.REQUEST_BYTES,
          Protocol.SOCKET_IDLE_MS,
        ).pipe(Effect.flatMap(decode));
        if (closing || admitted >= MAX_JOBS || request.environmentId !== environmentId) return;
        admitted++;
        transferred = true;
        runJob(
          Effect.scoped(
            Effect.gen(function* () {
              const auth = yield* makeCodexChatGptAuth({
                instanceId: request.instanceId,
                expectedProfileKey: request.profileKey,
              });
              
              const credentials = yield* auth.access.pipe(
                Effect.timeout(Protocol.COMMAND_TIMEOUT_MS),
              );
              yield* Protocol.writeFrame(
                socket,
                encodeResponse({ token: credentials.accessToken }),
                Protocol.RESPONSE_BYTES,
              );
            }),
          ).pipe(
            Effect.ignoreCause,
            Effect.ensuring(
              Effect.sync(() => {
                admitted--;
                socket.destroy();
              }),
            ),
          ),
        );
      }).pipe(
        Effect.ignoreCause,
        Effect.ensuring(
          Effect.sync(() => {
            if (!transferred) socket.destroy();
          }),
        ),
      ),
    );
  });
  server.on("error", () => {});
  
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closing = true;
      for (const socket of sockets) socket.destroy();
      yield* Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())));
      yield* FiberSet.awaitEmpty(connections);
      yield* FiberSet.awaitEmpty(jobs);
    }),
  );
  yield* Effect.callback<void, BrokerStartError>((resume) => {
    const onError = (cause: Error) => resume(Effect.fail(new BrokerStartError({ cause })));
    server.once("error", onError);
    try {
      server.listen(owned.endpoint, () => resume(Effect.void));
    } catch (cause) {
      resume(Effect.fail(new BrokerStartError({ cause })));
    }
    return Effect.sync(() => server.off("error", onError));
  });
  if (platform !== "win32") yield* io(() => NodeFSP.chmod(owned.endpoint, 0o600));
  return { endpoint: owned.endpoint, awaitIdle: FiberSet.awaitEmpty(jobs) };
});
const make = Effect.gen(function* () {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const acquired = yield* acquireListener.pipe(Scope.provide(scope), Effect.result);
  if (acquired._tag === "Failure") {
    yield* Scope.close(scope, Exit.fail(acquired.failure));
    return CodexManagedTokenBroker.of({
      endpoint: Effect.fail(acquired.failure),
      awaitIdle: Effect.void,
    });
  }
  return CodexManagedTokenBroker.of({
    endpoint: Effect.succeed(acquired.success.endpoint),
    awaitIdle: acquired.success.awaitIdle,
  });
});
export const layer = Layer.effect(CodexManagedTokenBroker, make);
