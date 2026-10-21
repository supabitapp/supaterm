// @effect-diagnostics globalTimers:off -- This protocol broker owns cancellable request deadlines outside the Effect runtime.
import {
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  DESKTOP_APP_ACTIVATION_TIMEOUT_MS,
  type DesktopAppActivationFailure,
  type DesktopAppActivationRequest,
  type DesktopAppActivationResponse,
} from "@supaterm/contracts";

interface PendingActivation {
  readonly request: DesktopAppActivationRequest;
  readonly resolve: (response: DesktopAppActivationResponse) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  dispatched: boolean;
}

type RendererSender = (request: DesktopAppActivationRequest) => void;

function failure(
  requestId: string,
  code: DesktopAppActivationFailure["code"],
  message: string,
): DesktopAppActivationFailure {
  return {
    version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
    requestId,
    ok: false,
    code,
    message,
  };
}

export class DesktopAppActivationBroker {
  #pending: PendingActivation | null = null;
  readonly #activate: () => void;
  #renderer: RendererSender | null = null;
  #closed = false;

  constructor(input: { readonly activate: () => void }) {
    this.#activate = input.activate;
  }

  request(request: DesktopAppActivationRequest): Promise<DesktopAppActivationResponse> {
    if (this.#closed) {
      return Promise.resolve(
        failure(request.requestId, "renderer-unavailable", "Supaterm is shutting down."),
      );
    }
    if (this.#pending !== null) {
      return Promise.resolve(
        failure(
          request.requestId,
          "request-busy",
          "The desktop app is handling another command. Try again after it finishes.",
        ),
      );
    }

    const response = new Promise<DesktopAppActivationResponse>((resolve) => {
      const pending: PendingActivation = {
        request,
        resolve,
        dispatched: false,
        timeout: setTimeout(() => {
          this.#settle(
            failure(
              request.requestId,
              pending.dispatched ? "request-timeout" : "renderer-unavailable",
              pending.dispatched
                ? "The desktop app did not complete the request in time."
                : "The desktop window was not ready to process the request.",
            ),
          );
        }, DESKTOP_APP_ACTIVATION_TIMEOUT_MS[request.type]),
      };
      this.#pending = pending;
    });

    this.#activate();
    this.#flush();
    return response;
  }

  registerRenderer(send: RendererSender): void {
    this.#renderer = send;
    this.#flush();
  }

  clearRenderer(): void {
    this.#renderer = null;
    const pending = this.#pending;
    if (pending?.dispatched) {
      this.#settle(
        failure(
          pending.request.requestId,
          "request-timeout",
          "The Supaterm window closed before it completed the request.",
        ),
      );
    }
  }

  complete(response: DesktopAppActivationResponse): void {
    this.#settle(response);
  }

  cancel(requestId: string): void {
    this.#settle(
      failure(requestId, "renderer-unavailable", "The command closed before Supaterm was ready."),
    );
  }

  close(): void {
    this.#closed = true;
    this.#renderer = null;
    const pending = this.#pending;
    if (pending !== null) {
      this.#settle(
        failure(
          pending.request.requestId,
          pending.dispatched ? "request-timeout" : "renderer-unavailable",
          "Supaterm is shutting down.",
        ),
      );
    }
  }

  #flush(): void {
    const renderer = this.#renderer;
    if (renderer === null) return;
    const pending = this.#pending;
    if (pending === null || pending.dispatched) return;
    try {
      pending.dispatched = true;
      renderer(pending.request);
    } catch {
      pending.dispatched = false;
      this.#renderer = null;
    }
  }

  #settle(response: DesktopAppActivationResponse): void {
    const pending = this.#pending;
    if (pending === null || pending.request.requestId !== response.requestId) return;
    clearTimeout(pending.timeout);
    this.#pending = null;
    pending.resolve(response);
  }
}
