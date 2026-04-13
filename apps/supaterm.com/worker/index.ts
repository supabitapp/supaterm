type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  ASSETS?: AssetBinding;
};

type CloudflareRequestInit = RequestInit & {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
  };
};

const cacheControl = "public, max-age=300";
const byteRangePattern = /^bytes=(\d*)-(\d*)$/;
const downloadRoutes = [
  {
    prefix: "/download/latest/",
    base: "https://github.com/supabitapp/supaterm/releases/latest/download/",
  },
  {
    prefix: "/download/tip/",
    base: "https://github.com/supabitapp/supaterm/releases/download/tip/",
    appcastBase: "https://github.com/supabitapp/supaterm/releases/latest/download/",
  },
] as const;

const methodNotAllowed = () =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });

const notFound = () => new Response("Not Found", { status: 404 });

const getAssets = (env: Env) => env.ASSETS;
const getDownloadRoute = (pathname: string) =>
  downloadRoutes.find((route) => pathname.startsWith(route.prefix));
const isVideoAsset = (pathname: string) => pathname.endsWith(".mp4");

const withCacheControl = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const withAcceptRanges = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

const buildTargetUrl = (route: (typeof downloadRoutes)[number], requestUrl: URL) => {
  const assetPath = requestUrl.pathname.slice(route.prefix.length);
  if (!assetPath) {
    return null;
  }

  const base =
    assetPath === "appcast.xml" && "appcastBase" in route && route.appcastBase
      ? route.appcastBase
      : route.base;
  const targetUrl = new URL(`${base}${assetPath}`);
  targetUrl.search = requestUrl.search;
  return targetUrl;
};

const proxyDownloadAsset = async (route: (typeof downloadRoutes)[number], request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const targetUrl = buildTargetUrl(route, new URL(request.url));
  if (!targetUrl) {
    return notFound();
  }

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: CloudflareRequestInit = {
    method: request.method,
    headers,
    cf: {
      cacheEverything: true,
      cacheTtl: 300,
    },
  };

  const response = await fetch(targetUrl, init);
  return withCacheControl(response);
};

export default {
  async fetch(request: Request, env: Env) {
    const route = getDownloadRoute(new URL(request.url).pathname);
    if (route) {
      return proxyDownloadAsset(route, request);
    }

    const assets = getAssets(env);
    if (!assets) {
      return new Response("ASSETS binding not available", { status: 500 });
    }

    if (isVideoAsset(new URL(request.url).pathname)) {
      return serveVideoAsset(request, assets);
    }

    const response = await assets.fetch(request);

    if (response.status === 404 && !new URL(request.url).pathname.includes(".")) {
      return assets.fetch(new Request(new URL("/index.html", request.url), request));
    }

    return response;
  },
};
