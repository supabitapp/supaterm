import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  ensureTailscaleServe,
  readTailscaleServeRootHolder,
  readTailscaleStatus,
  type TailscaleCommandError,
  type TailscaleServeHttpsDisabledError,
  type TailscaleStderrDiagnostic,
} from "@supaterm/tailscale";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DIAGNOSTIC_EXPLANATIONS: Record<TailscaleStderrDiagnostic, string | undefined> = {
  "no-existing-handler": "no mapping existed for that port",
  "not-logged-in": "this machine is not logged into a tailnet — run `tailscale up`",
  "permission-denied": "permission denied — `tailscale serve` may need elevated privileges",
  "unsupported-target": "this Tailscale install can only proxy to localhost",
  unknown: undefined,
};

const explainCommandFailure = (error: TailscaleCommandError | TailscaleServeHttpsDisabledError) =>
  error._tag === "TailscaleServeHttpsDisabledError"
    ? "HTTPS is not enabled on this tailnet — enable HTTPS certificates at https://login.tailscale.com/admin/dns"
    : error._tag === "TailscaleCommandExitError" && error.stderrDiagnostic !== undefined
      ? (DIAGNOSTIC_EXPLANATIONS[error.stderrDiagnostic] ?? "run the command by hand to see why")
      : undefined;

export class TailscaleUnavailableError extends Schema.TaggedError<TailscaleUnavailableError>()(
  "TailscaleUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "could not talk to tailscale";
  }

  get hint() {
    return "Is Tailscale installed and tailscaled running? Try `tailscale status` — or drop --share and open the printed localhost URL.";
  }
}

export class TailnetNameMissingError extends Schema.TaggedError<TailnetNameMissingError>()(
  "TailnetNameMissingError",
  {},
) {
  override get message() {
    return "this machine has no tailnet DNS name";
  }

  get hint() {
    return "Run `tailscale up` and make sure MagicDNS is enabled.";
  }
}

export class DevServeFailedError extends Schema.TaggedError<DevServeFailedError>()(
  "DevServeFailedError",
  {
    stage: Schema.Literals(["read-existing", "clear-existing", "serve"]),
    webPort: Schema.Number,
    explanation: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    const port = String(this.webPort);
    const base =
      this.stage === "read-existing"
        ? `could not read the existing mapping for port ${port}, so it was left alone`
        : this.stage === "clear-existing"
          ? `could not clear the existing mapping for port ${port}. Run \`tailscale serve --https=${port} off\` and retry`
          : `could not serve port ${port} on the tailnet (it is no longer served; any previous mapping for it was cleared before this attempt)`;
    return this.explanation ? `${base}: ${this.explanation}` : base;
  }

  get hint() {
    return undefined;
  }
}

export class DevServePortTakenError extends Schema.TaggedError<DevServePortTakenError>()(
  "DevServePortTakenError",
  { webPort: Schema.Number },
) {
  override get message() {
    return `tailnet port ${String(this.webPort)} already serves another running server, so it was left alone`;
  }

  get hint() {
    return `Pick another port with SUPATERM_PORT_OFFSET, or remove that mapping with \`tailscale serve --https=${String(this.webPort)} off\` if nothing needs it.`;
  }
}

export type DevShareError =
  | TailscaleUnavailableError
  | TailnetNameMissingError
  | DevServeFailedError
  | DevServePortTakenError;

/** Finalizer cleanup must be uninterruptible or cancellation can leave stale mappings. */
export const unshareDevServer = (webPort: number) =>
  disableTailscaleServe({ servePort: webPort }).pipe(
    Effect.as({ cleared: true } as const),
    Effect.catch((error: TailscaleCommandError) =>
      Effect.succeed(
        error._tag === "TailscaleCommandExitError" &&
          error.stderrDiagnostic === "no-existing-handler"
          ? ({ cleared: true } as const)
          : ({
              cleared: false,
              ...(explainCommandFailure(error) !== undefined
                ? { explanation: explainCommandFailure(error) }
                : {}),
              cause: error,
            } as const),
      ),
    ),
    Effect.uninterruptible,
  );

export interface DevShareResult {
  readonly url: string;
  readonly host: string;
}

/**
 * Publishes `webPort` on the tailnet. The tailnet port always matches the web
 * port so the URL is stable; `localTarget` points it at the backend instead
 * when the backend serves a built client (`--built`).
 */
export const shareDevServer = Effect.fn("devShare.shareDevServer")(function* (input: {
  readonly webPort: number;
  readonly localTarget?: { readonly port: number; readonly host: string };
}) {
  const status = yield* readTailscaleStatus.pipe(
    Effect.mapError((error) => new TailscaleUnavailableError({ cause: error })),
  );
  if (status.magicDnsName === null) {
    return yield* new TailnetNameMissingError();
  }

  const target = input.localTarget ?? { port: input.webPort, host: "localhost" };
  const holder = yield* readTailscaleServeRootHolder(input.webPort, {
    port: target.port,
    host: target.host.replace(/^\[|\]$/gu, ""),
  }).pipe(
    Effect.mapError((error) => {
      const explanation =
        error._tag === "TailscaleStatusParseError" ? undefined : explainCommandFailure(error);
      return new DevServeFailedError({
        stage: "read-existing",
        webPort: input.webPort,
        ...(explanation !== undefined ? { explanation } : {}),
        cause: error,
      });
    }),
  );
  if (holder === "other") {
    return yield* new DevServePortTakenError({ webPort: input.webPort });
  }

  const cleared = yield* unshareDevServer(input.webPort);
  if (!cleared.cleared) {
    return yield* new DevServeFailedError({
      stage: "clear-existing",
      webPort: input.webPort,
      ...(cleared.explanation !== undefined ? { explanation: cleared.explanation } : {}),
      ...(cleared.cause !== undefined ? { cause: cleared.cause } : {}),
    });
  }

  yield* ensureTailscaleServe({
    localPort: target.port,
    servePort: input.webPort,
    localHost: target.host,
  }).pipe(
    Effect.mapError((error) => {
      const explanation = explainCommandFailure(error);
      return new DevServeFailedError({
        stage: "serve",
        webPort: input.webPort,
        ...(explanation !== undefined ? { explanation } : {}),
        cause: error,
      });
    }),
  );

  return {
    url: buildTailscaleHttpsBaseUrl({
      magicDnsName: status.magicDnsName,
      servePort: input.webPort,
    }),
    host: status.magicDnsName,
  } satisfies DevShareResult;
});
