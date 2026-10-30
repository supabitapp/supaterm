import type { OrchestrationV2ThreadDetailSnapshot, ThreadId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { PreparedConnection } from "../connection/model.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";

// Long enough for a slow but alive server to finish. On a cold open a timeout makes the socket
// ask the same server for the same snapshot again, and older turn pages have no fallback, so a
// short deadline only drops work. The socket fallback is for setups where /api fails but /ws
// works, such as a proxy that blocks /api.
const DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS = 20_000;

export type ThreadSnapshotHistoryMeta = {
  readonly historyCursor: string | null;
  readonly hasMoreHistory: boolean;
  readonly latestLocalTurnOrdinal?: number | null;
};

export type ThreadSnapshotLoadResult =
  | {
      readonly _tag: "present";
      readonly snapshot: OrchestrationV2ThreadDetailSnapshot;
      readonly history?: ThreadSnapshotHistoryMeta;
    }
  | { readonly _tag: "missing" }
  | { readonly _tag: "unavailable" };

export const fetchEnvironmentThreadSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly timeoutMs?: number;
}) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    url: (urls) => urls.threadSnapshot({ params: { threadId: input.threadId } }),
    timeoutMs: input.timeoutMs ?? DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.threadSnapshot({
        params: { threadId: input.threadId },
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
});

export type FetchEnvironmentThreadSnapshotError = RemoteEnvironmentRequestError;

export class ThreadSnapshotLoader extends Context.Service<
  ThreadSnapshotLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      threadId: ThreadId,
    ) => Effect.Effect<ThreadSnapshotLoadResult>;
  }
>()("@supaterm/client-runtime/state/threadSnapshotHttp/ThreadSnapshotLoader") {}
