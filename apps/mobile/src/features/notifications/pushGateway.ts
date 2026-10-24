import type { PushApnsEnvironment } from "@supaterm/mobile-push";

const REQUEST_TIMEOUT_MS = 10_000;

export class PushGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | null;

  constructor(input: {
    readonly status: number;
    readonly code: string;
    readonly message?: string;
    readonly retryAfterMs?: number | null;
  }) {
    super(input.message ?? `Push gateway request failed (${input.code}).`);
    this.name = "PushGatewayError";
    this.status = input.status;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }

  /** The installation or owner token is no longer valid; the device must enroll again. */
  get installationLost(): boolean {
    return this.status === 401 || this.status === 404;
  }

  /** Network failures, rate limits, and gateway or APNs outages are worth retrying later. */
  get unreachable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface PushOwner {
  readonly installationId: string;
  readonly ownerToken: string;
}

export interface PushEnrollmentRequest {
  readonly token: string;
  readonly topic: string;
  readonly environment: PushApnsEnvironment;
}

export interface PushGatewayClient {
  readonly origin: string;
  readonly enroll: (
    request: PushEnrollmentRequest,
    owner?: PushOwner,
  ) => Promise<{ readonly enrollmentId: string; readonly expiresAt: number }>;
  readonly confirm: (
    enrollmentId: string,
    code: string,
  ) => Promise<{ readonly installationId: string; readonly ownerToken?: string }>;
  readonly getInstallation: (owner: PushOwner) => Promise<{ readonly handles: number }>;
  readonly deleteInstallation: (owner: PushOwner) => Promise<void>;
  readonly createHandle: (owner: PushOwner, hostKey: string) => Promise<string>;
  readonly deleteHandle: (owner: PushOwner, handle: string) => Promise<void>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const segment = encodeURIComponent;

function parseJson(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function retryAfterMs(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value * 1000 : null;
}

export function createPushGatewayClient(
  origin: string,
  fetchImpl: Fetch = fetch,
): PushGatewayClient {
  const send = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: { readonly body?: unknown; readonly owner?: PushOwner; readonly allow404?: boolean },
  ): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.owner ? { authorization: `Bearer ${options.owner.ownerToken}` } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new PushGatewayError({
        status: 0,
        code: "network",
        message: cause instanceof Error ? cause.message : "Could not reach the push gateway.",
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404 && options.allow404) return null;
    const json = parseJson(await response.text().catch(() => ""));
    if (!response.ok) {
      const error =
        json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
      throw new PushGatewayError({
        status: response.status,
        code: typeof error.error === "string" ? error.error : `http_${response.status}`,
        ...(typeof error.message === "string" ? { message: error.message } : {}),
        retryAfterMs: retryAfterMs(response),
      });
    }
    return json;
  };

  const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  const requireString = (value: unknown, key: string): string => {
    const result = field(value, key);
    if (typeof result !== "string" || result === "") {
      throw new PushGatewayError({ status: 502, code: "invalid_response" });
    }
    return result;
  };
  const installationPath = (owner: PushOwner) =>
    `/v1/installations/${segment(owner.installationId)}`;

  return {
    origin,
    enroll: async (request, owner) => {
      const body = await send("POST", "/v1/enrollments", {
        body: { ...request, ...(owner ? { installationId: owner.installationId } : {}) },
        ...(owner ? { owner } : {}),
      });
      const expiresAt = field(body, "expiresAt");
      return {
        enrollmentId: requireString(body, "enrollmentId"),
        expiresAt: typeof expiresAt === "number" ? expiresAt : Date.now() + 10 * 60_000,
      };
    },
    confirm: async (enrollmentId, code) => {
      const body = await send("POST", `/v1/enrollments/${segment(enrollmentId)}/confirm`, {
        body: { code },
      });
      const ownerToken = field(body, "ownerToken");
      return {
        installationId: requireString(body, "installationId"),
        ...(typeof ownerToken === "string" && ownerToken !== "" ? { ownerToken } : {}),
      };
    },
    getInstallation: async (owner) => {
      const body = await send("GET", installationPath(owner), { owner });
      const handles = field(body, "handles");
      return { handles: typeof handles === "number" ? handles : 0 };
    },
    deleteInstallation: async (owner) => {
      await send("DELETE", installationPath(owner), { owner, allow404: true });
    },
    createHandle: async (owner, hostKey) =>
      requireString(
        await send("POST", `${installationPath(owner)}/handles`, { owner, body: { hostKey } }),
        "handle",
      ),
    deleteHandle: async (owner, handle) => {
      await send("DELETE", `${installationPath(owner)}/handles/${segment(handle)}`, {
        owner,
        allow404: true,
      });
    },
  };
}
