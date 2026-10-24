import { describe, expect, it, vi } from "vite-plus/test";

import { PushGatewayError, createPushGatewayClient } from "./pushGateway";

const ORIGIN = "https://push.example.test";
const owner = { installationId: "inst/1", ownerToken: "owner-token" };

function respond(status: number, body?: unknown, headers?: Record<string, string>) {
  return vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
  );
}

describe("push gateway client", () => {
  it("enrolls a new device without owner auth", async () => {
    const fetch = respond(201, { enrollmentId: "enrollment-1", expiresAt: 1234 });
    const client = createPushGatewayClient(ORIGIN, fetch);

    await expect(
      client.enroll({ token: "ab12", topic: "com.supaterm.mobile", environment: "sandbox" }),
    ).resolves.toEqual({ enrollmentId: "enrollment-1", expiresAt: 1234 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/v1/enrollments`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      token: "ab12",
      topic: "com.supaterm.mobile",
      environment: "sandbox",
    });
  });

  it("rotates an existing installation's token with owner auth", async () => {
    const fetch = respond(201, { enrollmentId: "enrollment-2", expiresAt: 1 });
    const client = createPushGatewayClient(ORIGIN, fetch);

    await client.enroll(
      { token: "cd34", topic: "com.supaterm.mobile", environment: "production" },
      owner,
    );

    const [, init] = fetch.mock.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer owner-token" });
    expect(JSON.parse(String(init.body))).toMatchObject({ installationId: "inst/1" });
  });

  it("returns the owner token only for new installations", async () => {
    const created = createPushGatewayClient(
      ORIGIN,
      respond(200, { installationId: "inst-1", ownerToken: "secret" }),
    );
    await expect(created.confirm("e", "code")).resolves.toEqual({
      installationId: "inst-1",
      ownerToken: "secret",
    });
    const rotated = createPushGatewayClient(ORIGIN, respond(200, { installationId: "inst-1" }));
    await expect(rotated.confirm("e", "code")).resolves.toEqual({ installationId: "inst-1" });
  });

  it("mints handles under the installation path", async () => {
    const fetch = respond(201, { handle: "h".repeat(22) });
    const client = createPushGatewayClient(ORIGIN, fetch);

    await expect(client.createHandle(owner, "host-key")).resolves.toBe("h".repeat(22));
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/v1/installations/inst%2F1/handles`);
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({ hostKey: "host-key" });
  });

  it("treats deleting something already gone as done", async () => {
    const client = createPushGatewayClient(ORIGIN, respond(404, { error: "not_found" }));
    await expect(client.deleteHandle(owner, "handle")).resolves.toBeUndefined();
    await expect(client.deleteInstallation(owner)).resolves.toBeUndefined();
  });

  it("maps gateway errors", async () => {
    const limited = createPushGatewayClient(
      ORIGIN,
      respond(429, { error: "rate_limited", message: "Slow down" }, { "retry-after": "30" }),
    );
    const error = await limited
      .enroll({ token: "ab", topic: "t", environment: "sandbox" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PushGatewayError);
    expect(error).toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Slow down",
      retryAfterMs: 30_000,
      unreachable: true,
      installationLost: false,
    });

    const lost = await createPushGatewayClient(ORIGIN, respond(401, { error: "unauthorized" }))
      .createHandle(owner, "key")
      .catch((cause: unknown) => cause);
    expect(lost).toMatchObject({ installationLost: true, unreachable: false });
  });

  it("reports network failures as unreachable", async () => {
    const client = createPushGatewayClient(ORIGIN, async () => {
      throw new TypeError("Network request failed");
    });
    await expect(client.getInstallation(owner)).rejects.toMatchObject({
      status: 0,
      code: "network",
      unreachable: true,
    });
  });
});
