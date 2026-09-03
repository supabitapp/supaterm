import { isDownloadPath, resolveDownload } from "../src/lib/downloads";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  ASSETS?: AssetBinding;
};

type WorkerCacheStorage = CacheStorage & {
  default?: Cache;
};

const routeMeta: Record<string, Record<string, string>> = {
  "/changelog": {
    title: "Supaterm - What's New",
    description: "See what's new in Supaterm — latest features, improvements, and fixes.",
    "og:title": "Supaterm - What's New",
    "og:description": "See what's new in Supaterm — latest features, improvements, and fixes.",
    "og:url": "https://supaterm.com/changelog",
    "twitter:title": "Supaterm - What's New",
    "twitter:description": "See what's new in Supaterm — latest features, improvements, and fixes.",
  },
  "/terms": {
    title: "Terms of service - Supaterm",
    description: "Terms for buying and using Supaterm.",
    "og:title": "Terms of service - Supaterm",
    "og:description": "Terms for buying and using Supaterm.",
    "og:url": "https://supaterm.com/terms",
  },
  "/privacy": {
    title: "Privacy policy - Supaterm",
    description: "How Supaterm handles personal data.",
    "og:title": "Privacy policy - Supaterm",
    "og:description": "How Supaterm handles personal data.",
    "og:url": "https://supaterm.com/privacy",
  },
  "/refunds": {
    title: "Refund and cancellation policy - Supaterm",
    description: "Refund and cancellation terms for Supaterm licenses.",
    "og:title": "Refund and cancellation policy - Supaterm",
    "og:description": "Refund and cancellation terms for Supaterm licenses.",
    "og:url": "https://supaterm.com/refunds",
  },
};

const rewriteMeta = async (response: Response, meta: Record<string, string>): Promise<Response> => {
  let html = await response.text();

  for (const [attr, value] of Object.entries(meta)) {
    if (attr === "title") {
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${value}</title>`);
    } else {
      const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(
        new RegExp(`(<meta\\s+(?:property|name)="${escaped}"\\s+content=")[^"]*"`),
        `$1${value}"`,
      );
    }
  }

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const cacheControl = "public, max-age=300";
const noStoreCacheControl = "no-store";
const downloadCacheHeader = "x-supaterm-cache";
const siteHeaders = {
  "content-security-policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self' https://p.supaterm.com wss://p.supaterm.com; font-src 'self'; form-action 'self' https://license.supaterm.com https://checkout.stripe.com; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const byteRangePattern = /^bytes=(\d*)-(\d*)$/;
const forwardedDownloadRequestHeaders = [
  "accept",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
] as const;
const methodNotAllowed = () =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });

const notFound = () => new Response("Not Found", { status: 404 });

const getAssets = (env: Env) => env.ASSETS;
const isVideoAsset = (pathname: string) => pathname.endsWith(".mp4");

const withResponseHeaders = (response: Response, additions: Record<string, string>) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(additions)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const uncachedDownloadResponse = (response: Response, cacheStatus: string) =>
  withResponseHeaders(response, {
    "cache-control": noStoreCacheControl,
    [downloadCacheHeader]: cacheStatus,
  });

const upstreamFailureResponse = () =>
  new Response("Upstream fetch failed", {
    status: 502,
    headers: {
      "cache-control": noStoreCacheControl,
      [downloadCacheHeader]: "bypass",
    },
  });

const withAcceptRanges = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const hexDigest = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const normalizeSHA256 = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase().replace(/^sha256:/, "") : null;

const downloadRequestHeaders = (request: Request) => {
  const headers = new Headers();
  for (const name of forwardedDownloadRequestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
};

const downloadCache = () => (globalThis.caches as WorkerCacheStorage | undefined)?.default;

const downloadCacheKey = (request: Request) => {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url, { method: "GET" });
};

const parseByteRange = (header: string, size: number) => {
  if (header.includes(",")) {
    return null;
  }

  const match = byteRangePattern.exec(header);
  if (!match) {
    return null;
  }

  const [, startValue, endValue] = match;

  if (!startValue && !endValue) {
    return null;
  }

  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number(startValue);
  const end = endValue ? Number(endValue) : size - 1;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
};

const serveVideoAsset = async (request: Request, assets: AssetBinding) => {
  const rangeHeader = request.headers.get("range");
  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete("range");

  const assetRequest = new Request(request, {
    headers: assetHeaders,
  });
  const assetResponse = await assets.fetch(assetRequest);

  if (!rangeHeader || !assetResponse.ok) {
    return withAcceptRanges(assetResponse);
  }

  const buffer = await assetResponse.arrayBuffer();
  const range = parseByteRange(rangeHeader, buffer.byteLength);

  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${buffer.byteLength}`,
      },
    });
  }

  const { start, end } = range;
  const headers = new Headers(assetResponse.headers);
  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(end - start + 1));
  headers.set("content-range", `bytes ${start}-${end}/${buffer.byteLength}`);

  return new Response(request.method === "HEAD" ? null : buffer.slice(start, end + 1), {
    status: 206,
    headers,
  });
};

const proxyDownload = async (
  request: Request,
  targetUrl: URL,
  cacheStatus: string,
  responseCacheControl: string,
) => {
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: request.method,
      headers: downloadRequestHeaders(request),
    });
  } catch {
    return upstreamFailureResponse();
  }

  return withResponseHeaders(response, {
    "cache-control": responseCacheControl,
    [downloadCacheHeader]: cacheStatus,
  });
};

const checksumEntry = async (manifestUrl: URL, assetName: string) => {
  let response: Response;
  try {
    response = await fetch(manifestUrl, { method: "GET" });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let manifest: unknown;
  try {
    manifest = await response.json();
  } catch {
    return null;
  }

  const assets = manifest && typeof manifest === "object" ? Reflect.get(manifest, "assets") : null;
  const entry = assets && typeof assets === "object" ? Reflect.get(assets, assetName) : null;
  const sha256 =
    entry && typeof entry === "object"
      ? normalizeSHA256(Reflect.get(entry, "sha256") ?? Reflect.get(entry, "digest"))
      : null;
  const size = entry && typeof entry === "object" ? Number(Reflect.get(entry, "size")) : NaN;

  if (!sha256 || !Number.isSafeInteger(size) || size < 0) {
    return null;
  }

  return { sha256, size };
};

const proxyDownloadAsset = async (request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const download = resolveDownload(new URL(request.url));
  if (!download) {
    return notFound();
  }

  if (request.method === "HEAD" || request.headers.has("range")) {
    return proxyDownload(request, download.targetUrl, "bypass", noStoreCacheControl);
  }

  if (!download.verifiesChecksum) {
    return proxyDownload(request, download.targetUrl, "bypass", cacheControl);
  }

  const cache = downloadCache();
  if (!cache) {
    return proxyDownload(request, download.targetUrl, "bypass", noStoreCacheControl);
  }

  const cacheKey = downloadCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withResponseHeaders(cached, {
      "cache-control": download.cacheControl,
      [downloadCacheHeader]: "hit",
    });
  }

  const entry = await checksumEntry(download.manifestUrl, download.assetName);

  let response: Response;
  try {
    response = await fetch(download.targetUrl, {
      method: "GET",
      headers: downloadRequestHeaders(request),
    });
  } catch {
    return upstreamFailureResponse();
  }

  if (!response.ok) {
    return uncachedDownloadResponse(response, "bypass");
  }

  if (!entry) {
    return uncachedDownloadResponse(response, "bypass");
  }

  const buffer = await response.arrayBuffer();
  const actualSHA256 = hexDigest(await crypto.subtle.digest("SHA-256", buffer));
  if (buffer.byteLength !== entry.size || actualSHA256 !== entry.sha256) {
    return new Response("Checksum mismatch", {
      status: 502,
      headers: {
        "cache-control": noStoreCacheControl,
        [downloadCacheHeader]: "checksum-mismatch",
      },
    });
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", download.cacheControl);
  const cacheResponse = new Response(buffer, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(cacheKey, cacheResponse.clone());
  return withResponseHeaders(cacheResponse, { [downloadCacheHeader]: "validated" });
};

export default {
  async fetch(request: Request, env: Env) {
    const pathname = new URL(request.url).pathname;

    if (isDownloadPath(pathname)) {
      return proxyDownloadAsset(request);
    }

    const assets = getAssets(env);
    if (!assets) {
      return new Response("ASSETS binding not available", { status: 500 });
    }

    if (isVideoAsset(pathname)) {
      return withResponseHeaders(await serveVideoAsset(request, assets), siteHeaders);
    }

    const response = await assets.fetch(request);

    if (response.status === 404 && !pathname.includes(".")) {
      const shell = await assets.fetch(new Request(new URL("/index.html", request.url), request));
      const meta = routeMeta[pathname];
      return withResponseHeaders(meta ? await rewriteMeta(shell, meta) : shell, siteHeaders);
    }

    return withResponseHeaders(response, siteHeaders);
  },
};
