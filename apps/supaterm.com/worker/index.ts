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

const downloadPrefix = "/download/tip/";
const downloadBase = "https://github.com/supabitapp/supaterm/releases/download/tip/";
const cacheControl = "public, max-age=300";

const methodNotAllowed = () =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });

const notFound = () => new Response("Not Found", { status: 404 });

const getAssets = (env: Env) => env.ASSETS;

const withCacheControl = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const buildTargetUrl = (requestUrl: URL) => {
  const assetPath = requestUrl.pathname.slice(downloadPrefix.length);
  if (!assetPath) {
    return null;
  }

  const targetUrl = new URL(`${downloadBase}${assetPath}`);
  targetUrl.search = requestUrl.search;
  return targetUrl;
};

const proxyTipAsset = async (request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const targetUrl = buildTargetUrl(new URL(request.url));
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
    if (new URL(request.url).pathname.startsWith(downloadPrefix)) {
      return proxyTipAsset(request);
    }

    const assets = getAssets(env);
    if (!assets) {
      return new Response("ASSETS binding not available", { status: 500 });
    }

    return assets.fetch(request);
  },
};
