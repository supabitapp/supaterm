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

const withCacheControl = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
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

    return assets.fetch(request);
  },
};
