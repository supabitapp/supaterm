export type Method<Input, Output> = { readonly input: Input; readonly output: Output };

export type Methods = { readonly [name: string]: Method<unknown, unknown> };

type Request = {
  readonly id: number;
  readonly method: string;
  readonly key?: string | undefined;
  readonly input: unknown;
};

type Cancel = { readonly cancel: number };

type Response =
  | {
      readonly id: number;
      readonly ok: true;
      readonly value: unknown;
      readonly transferred: readonly Transferable[];
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly superseded: boolean;
      readonly message: string;
    };

export class Transfer<T> {
  constructor(
    readonly value: T,
    readonly transfer: readonly Transferable[],
  ) {}
}

export class SupersededError extends Error {}

class WorkerClosedError extends Error {}

type CallOptions = {
  readonly key?: string;

  readonly transfer?: readonly Transferable[];

  readonly signal?: AbortSignal;
};

type Pending = {
  readonly settle: (response: Response) => void;
  readonly reject: (error: Error) => void;
};

type ClientState = { next: number; failure: Error | undefined };

export function createWorkerClient<M extends Methods>(worker: Worker) {
  const pending = new Map<number, Pending>();
  const state: ClientState = { next: 0, failure: undefined };

  const fail = (error: Error) => {
    state.failure ??= error;
    pending.forEach((call) => call.reject(error));
    pending.clear();
    worker.terminate();
  };

  worker.addEventListener("message", (event: MessageEvent<Response>) => {
    const call = pending.get(event.data.id);

    if (!call) {
      if (event.data.ok) closeBitmaps(event.data.transferred);

      return;
    }

    pending.delete(event.data.id);
    call.settle(event.data);
  });

  worker.addEventListener("error", (event) =>
    fail(new WorkerClosedError(event.message || "The Office engine stopped")),
  );
  worker.addEventListener("messageerror", () =>
    fail(new WorkerClosedError("The Office engine sent an unreadable reply")),
  );

  return {
    call<K extends keyof M & string>(
      method: K,
      input: M[K]["input"],
      options: CallOptions = {},
    ): Promise<M[K]["output"]> {
      if (state.failure) return Promise.reject(state.failure);

      if (options.signal?.aborted)
        return Promise.reject(new WorkerClosedError("The call was aborted"));

      const id = ++state.next;

      return new Promise<M[K]["output"]>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            fail(
              new WorkerClosedError(
                "This document took too long to preview. Open it in another app.",
              ),
            ),
          30_000,
        );
        const abort = () => {
          clearTimeout(timeout);
          pending.delete(id);
          reject(new WorkerClosedError("The call was aborted"));
          worker.postMessage({ cancel: id } satisfies Cancel, []);
        };

        options.signal?.addEventListener("abort", abort, { once: true });
        pending.set(id, {
          settle: (response) => {
            clearTimeout(timeout);
            options.signal?.removeEventListener("abort", abort);

            if (!response.ok)
              return reject(
                response.superseded
                  ? new SupersededError(response.message)
                  : new Error(response.message),
              );

            resolve(response.value as M[K]["output"]);
          },
          reject: (error) => {
            clearTimeout(timeout);
            options.signal?.removeEventListener("abort", abort);
            reject(error);
          },
        });
        worker.postMessage({ id, method, key: options.key, input } satisfies Request, [
          ...(options.transfer ?? []),
        ]);
      });
    },

    close() {
      fail(new WorkerClosedError("The Office engine was closed"));
    },
  };
}

type ServerState = {
  running: boolean;
  current: { readonly id: number; readonly controller: AbortController } | undefined;
};

export function serveWorker<M extends Methods>(handlers: {
  readonly [K in keyof M]: (
    input: M[K]["input"],
    signal: AbortSignal,
  ) =>
    | M[K]["output"]
    | Transfer<M[K]["output"]>
    | Promise<M[K]["output"] | Transfer<M[K]["output"]>>;
}) {
  const queue: Request[] = [];

  const state: ServerState = { running: false, current: undefined };

  const reply = (response: Response, transfer: readonly Transferable[] = []) =>
    self.postMessage(response, { transfer: [...transfer] });

  const run = async () => {
    if (state.running) return;

    state.running = true;

    while (queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve));

      const request = queue.shift();

      if (!request) break;

      const handler = handlers[request.method];
      const controller = new AbortController();

      state.current = { id: request.id, controller };

      if (!handler) {
        reply({
          id: request.id,
          ok: false,
          superseded: false,
          message: `Unknown method ${request.method}`,
        });
        continue;
      }

      const input = request.input as never;

      await Promise.resolve()
        .then(() => handler(input, controller.signal))
        .then(
          (result) => {
            const transfer = result instanceof Transfer ? result.transfer : [];

            if (controller.signal.aborted) return closeBitmaps(transfer);

            reply(
              {
                id: request.id,
                ok: true,
                value: result instanceof Transfer ? result.value : result,
                transferred: transfer,
              },
              transfer,
            );
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return;

            reply({
              id: request.id,
              ok: false,
              superseded: false,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          },
        );
    }

    state.running = false;
    state.current = undefined;
  };

  self.addEventListener("message", (event: MessageEvent<Request | Cancel>) => {
    if ("cancel" in event.data) {
      const id = event.data.cancel;
      const queued = queue.findIndex((request) => request.id === id);

      if (queued !== -1) queue.splice(queued, 1);

      if (state.current?.id === id) state.current.controller.abort();

      return;
    }

    const key = event.data.key;
    const replaced = key === undefined ? -1 : queue.findIndex((request) => request.key === key);

    if (replaced !== -1) {
      const [old] = queue.splice(replaced, 1);

      if (old)
        reply({ id: old.id, ok: false, superseded: true, message: "Replaced by a newer call" });
    }

    queue.push(event.data);
    void run();
  });
}

function closeBitmaps(transfer: readonly Transferable[]) {
  transfer.forEach((item) => {
    if (item instanceof ImageBitmap) item.close();
  });
}
