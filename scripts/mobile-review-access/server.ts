// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - This standalone service runs beside the isolated mobile review environment.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import { QrCode } from "@supaterm/shared/qrCode";

const REVIEW_SCOPES = [
  "orchestration:read",
  "orchestration:operate",
  "preview:operate",
  "diagnostics:read",
  "terminal:read",
  "terminal:operate",
  "source-control:write",
  "filesystem:read",
  "filesystem:write",
];

interface ReviewAccessConfig {
  publicUrl: string;
  backendUrl: string;
  adminToken: string;
  invitationSha256: string;
  reviewCodeSha256?: string | undefined;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

const sha256 = (value: string) => NodeCrypto.createHash("sha256").update(value).digest();

function matchesDigest(value: string, digest: Buffer) {
  return value.length > 0 && NodeCrypto.timingSafeEqual(sha256(value), digest);
}

function bearer(request: NodeHttp.IncomingMessage) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

async function readBody(request: NodeHttp.IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) return undefined;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function endToEndHeaders(headers: NodeHttp.IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name)),
  );
}

function forward(
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  backendUrl: string,
  body: string,
) {
  const upstream = NodeHttp.request(
    new URL(request.url ?? "/", backendUrl),
    {
      method: request.method,
      headers: { ...endToEndHeaders(request.headers), "content-length": Buffer.byteLength(body) },
      timeout: 10_000,
    },
    (backendResponse) => {
      response.writeHead(
        backendResponse.statusCode ?? 502,
        endToEndHeaders(backendResponse.headers),
      );
      backendResponse.on("aborted", () => response.destroy());
      backendResponse.on("error", () => response.destroy());
      backendResponse.pipe(response);
    },
  );
  response.on("close", () => {
    if (!response.writableFinished) upstream.destroy();
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (response.headersSent) return response.destroy();
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "The review environment is unavailable." }));
  });
  upstream.end(body);
}

function qrImage(value: string) {
  const qr = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const size = qr.size + 8;
  const squares: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) squares.push(`M${x + 4},${y + 4}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path fill="white" d="M0 0h${size}v${size}H0z"/><path fill="black" d="${squares.join("")}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function createReviewAccessServer(config: ReviewAccessConfig) {
  const origin = new URL(config.publicUrl).origin;
  if (!SHA256_HEX.test(config.invitationSha256) || !config.adminToken.trim()) {
    throw new Error("Review access requires an invitation digest and an administrative token.");
  }
  if (config.reviewCodeSha256 !== undefined && !SHA256_HEX.test(config.reviewCodeSha256)) {
    throw new Error("The review code digest must be a SHA-256 hex digest.");
  }
  const digest = Buffer.from(config.invitationSha256, "hex");
  const reviewCodeDigest = config.reviewCodeSha256
    ? Buffer.from(config.reviewCodeSha256, "hex")
    : undefined;
  const matchesReviewCode = (code: string) =>
    reviewCodeDigest !== undefined && matchesDigest(code, reviewCodeDigest);
  const issuePairingCredential = async () => {
    const grantResponse = await fetch(new URL("/api/auth/pairing-token", config.backendUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "App review", scopes: REVIEW_SCOPES }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!grantResponse.ok) return undefined;
    const grant: unknown = await grantResponse.json();
    if (
      !grant ||
      typeof grant !== "object" ||
      !("credential" in grant) ||
      !("expiresAt" in grant) ||
      typeof grant.credential !== "string" ||
      typeof grant.expiresAt !== "string"
    ) {
      return undefined;
    }
    return { credential: grant.credential, expiresAt: grant.expiresAt };
  };
  const assets = import.meta.dirname;
  const [page, script] = await Promise.all([
    NodeFSP.readFile(NodePath.join(assets, "page.html"), "utf8"),
    NodeFSP.readFile(NodePath.join(assets, "page.js"), "utf8"),
  ]);
  const server = NodeHttp.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const respond = (status: number, body: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const pathname = (request.url ?? "/").split("?", 1)[0];
    if (request.method === "GET" && (pathname === "/review" || pathname === "/review/")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    if (request.method === "GET" && pathname === "/review/page.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (pathname === "/oauth/token") {
      try {
        const body = await readBody(request, 16_384);
        if (body === undefined) {
          respond(413, { error: "Request is too large." });
          return;
        }
        const form = new URLSearchParams(body);
        const subject = form.get("subject_token") ?? "";
        if (request.method !== "POST" || !matchesReviewCode(subject)) {
          forward(request, response, config.backendUrl, body);
          return;
        }
        const grant = await issuePairingCredential();
        if (!grant) {
          respond(503, { error: "The review environment is unavailable. Please try again." });
          return;
        }
        form.set("subject_token", grant.credential);
        forward(request, response, config.backendUrl, form.toString());
      } catch {
        respond(503, { error: "The review environment is unavailable. Please try again." });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/review/code-check") {
      if (!matchesReviewCode(bearer(request))) {
        respond(401, { error: "The review code does not match this environment." });
        return;
      }
      try {
        if (!(await issuePairingCredential())) {
          respond(503, { error: "The review environment is unavailable." });
          return;
        }
        response.writeHead(204).end();
      } catch {
        respond(503, { error: "The review environment is unavailable." });
      }
      return;
    }
    if (pathname !== "/review/pairing") {
      respond(404, { error: "Page not found." });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      respond(405, { error: "Use POST to create a connection link." });
      return;
    }
    if (
      request.headers.origin !== origin ||
      request.headers["content-type"] !== "application/json"
    ) {
      respond(403, { error: "Create the connection link from the review access page." });
      return;
    }
    if (!matchesDigest(bearer(request), digest)) {
      respond(401, { error: "Open the full review link from your invitation." });
      return;
    }
    try {
      if ((await readBody(request, 4096)) === undefined) {
        respond(413, { error: "Request is too large." });
        return;
      }
      const grant = await issuePairingCredential();
      if (!grant) {
        respond(503, { error: "The review environment could not create a connection link." });
        return;
      }
      const pairingUrl = new URL("/pair", origin);
      pairingUrl.hash = new URLSearchParams({ token: grant.credential }).toString();
      respond(200, {
        pairingUrl: pairingUrl.toString(),
        expiresAt: grant.expiresAt,
        qrImage: qrImage(pairingUrl.toString()),
      });
    } catch {
      respond(503, { error: "The review environment is unavailable. Please try again." });
    }
  });
  server.maxConnections = 64;
  server.requestTimeout = 15_000;
  return server;
}

if (import.meta.main) {
  const tokenFile = process.env.SUPACODE_REVIEW_ADMIN_TOKEN_FILE;
  const publicUrl = process.env.SUPACODE_REVIEW_PUBLIC_URL;
  const invitationSha256 = process.env.SUPACODE_REVIEW_INVITATION_SHA256;
  if (!tokenFile || !publicUrl || !invitationSha256) {
    throw new Error("Review access configuration is incomplete.");
  }
  const server = await createReviewAccessServer({
    publicUrl,
    invitationSha256,
    reviewCodeSha256: process.env.SUPACODE_REVIEW_CODE_SHA256 || undefined,
    backendUrl: process.env.SUPACODE_REVIEW_BACKEND_URL ?? "http://127.0.0.1:3773",
    adminToken: (await NodeFSP.readFile(tokenFile, "utf8")).trim(),
  });
  server.listen(Number(process.env.SUPACODE_REVIEW_PORT ?? "3774"), "127.0.0.1");
}
