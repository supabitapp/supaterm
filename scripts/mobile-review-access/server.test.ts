// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - These tests exercise the standalone review access service over HTTP.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createReviewAccessServer } from "./server.ts";

const servers: NodeHttp.Server[] = [];
const publicUrl = "https://review.example.test";
const invitation = "test-review-invitation";
const reviewCode = "test-review-code";

async function listen(server: NodeHttp.Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a port.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function setup(backendResponse?: string) {
  const requests: Array<{ authorization: string | undefined; body: unknown }> = [];
  const exchanges: Array<{
    method: string | undefined;
    forwardedProto: string | string[] | undefined;
    subjectToken: string | null;
  }> = [];
  const backend = NodeHttp.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    if (request.url === "/oauth/token") {
      exchanges.push({
        method: request.method,
        forwardedProto: request.headers["x-forwarded-proto"],
        subjectToken: new URLSearchParams(body).get("subject_token"),
      });
      response.writeHead(request.method === "OPTIONS" ? 204 : 200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://app.example.test",
      });
      response.end(
        request.method === "OPTIONS" ? undefined : JSON.stringify({ access_token: "SESSION" }),
      );
      return;
    }
    requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      backendResponse ??
        JSON.stringify({
          credential: `PAIRING-EXAMPLE-${requests.length}`,
          expiresAt: "2030-01-01T12:05:00Z",
        }),
    );
  });
  const backendUrl = await listen(backend);
  const access = await createReviewAccessServer({
    publicUrl,
    backendUrl,
    adminToken: "private-admin-token",
    invitationSha256: NodeCrypto.createHash("sha256").update(invitation).digest("hex"),
    reviewCodeSha256: NodeCrypto.createHash("sha256").update(reviewCode).digest("hex"),
  });
  const accessUrl = await listen(access);
  const pair = (accessInvitation = invitation, origin = publicUrl, body: unknown = {}) =>
    fetch(`${accessUrl}/review/pairing`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(accessInvitation ? { Authorization: `Bearer ${accessInvitation}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const exchange = (subjectToken: string) =>
    fetch(`${accessUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Forwarded-Proto": "https",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: subjectToken,
        subject_token_type: "urn:supaterm:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      }),
    });
  const checkCode = (code: string) =>
    fetch(`${accessUrl}/review/code-check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${code}` },
    });
  return { accessUrl, requests, exchanges, pair, exchange, checkCode };
}

describe("mobile review access", () => {
  it("keeps invitations and connection tokens out of the public page", async () => {
    const { accessUrl, requests } = await setup();
    const response = await fetch(`${accessUrl}/review`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const page = await response.text();
    expect(page).not.toContain("private-admin-token");
    expect(page).not.toContain(invitation);
    expect(page).not.toContain("PAIRING-EXAMPLE");
    expect(requests).toHaveLength(0);
  });

  it("refuses missing and incorrect invitations without creating a pairing grant", async () => {
    const { requests, pair } = await setup();
    expect((await pair("")).status).toBe(401);
    expect((await pair("incorrect")).status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it("refuses requests from another origin even with a valid invitation", async () => {
    const { requests, pair } = await setup();
    expect((await pair(invitation, "https://another.example.test")).status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("creates a connection link and QR code with review permissions", async () => {
    const { requests, pair } = await setup();
    const response = await pair();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.pairingUrl).toBe(`${publicUrl}/pair#token=PAIRING-EXAMPLE-1`);
    expect(result.expiresAt).toBe("2030-01-01T12:05:00Z");
    expect(result.qrImage).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(JSON.stringify(result)).not.toContain("private-admin-token");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe("Bearer private-admin-token");
    expect(requests[0]?.body).toMatchObject({
      label: "App review",
      scopes: expect.arrayContaining(["orchestration:operate", "filesystem:write"]),
    });
    const body = requests[0]?.body as { scopes: string[] };
    expect(body.scopes).not.toContain("access:write");
    expect(body.scopes).not.toContain("providers:manage");
  });

  it("rejects oversized requests before creating a pairing grant", async () => {
    const { requests, pair } = await setup();
    expect((await pair(invitation, publicUrl, { extra: "x".repeat(5000) })).status).toBe(413);
    expect(requests).toHaveLength(0);
  });

  it("reports an unavailable environment when its pairing response is invalid", async () => {
    const { pair } = await setup("invalid JSON");
    const response = await pair();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The review environment is unavailable. Please try again.",
    });
  });

  it("lets the same invitation connect another device with a fresh pairing grant", async () => {
    const { pair, requests } = await setup();
    const first = await (await pair()).json();
    const second = await (await pair()).json();
    expect(first.pairingUrl).not.toBe(second.pairingUrl);
    expect(requests).toHaveLength(2);
  });

  it("exchanges the reusable review code for a fresh pairing grant on every scan", async () => {
    const { requests, exchanges, exchange } = await setup();
    expect((await exchange(reviewCode)).status).toBe(200);
    expect((await exchange(reviewCode)).status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(exchanges.map((entry) => entry.subjectToken)).toEqual([
      "PAIRING-EXAMPLE-1",
      "PAIRING-EXAMPLE-2",
    ]);
  });

  it("forwards other pairing codes and preflights unchanged without creating a grant", async () => {
    const { accessUrl, requests, exchanges, exchange } = await setup();
    const response = await exchange("ordinary-code");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(await response.json()).toEqual({ access_token: "SESSION" });
    const preflight = await fetch(`${accessUrl}/oauth/token`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(requests).toHaveLength(0);
    expect(exchanges).toEqual([
      { method: "POST", forwardedProto: "https", subjectToken: "ordinary-code" },
      { method: "OPTIONS", forwardedProto: undefined, subjectToken: null },
    ]);
  });

  it("confirms the review code before a submission without exposing a grant", async () => {
    const { checkCode } = await setup();
    expect((await checkCode("ordinary-code")).status).toBe(401);
    const response = await checkCode(reviewCode);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
