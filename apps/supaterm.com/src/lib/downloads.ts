const githubOrigin = "https://github.com";

const downloadRoutes = [
  {
    prefix: "/download/latest/",
    basePath: "/supabitapp/supaterm/releases/latest/download/",
  },
  {
    prefix: "/download/tip/",
    basePath: "/supabitapp/supaterm/releases/download/tip/",
    appcastBasePath: "/supabitapp/supaterm/releases/latest/download/",
  },
] as const;

const downloadHref = "/download/latest/supaterm.dmg";

const buildDownloadTargetUrl = (requestUrl: URL) => {
  const route = downloadRoutes.find(({ prefix }) => requestUrl.pathname.startsWith(prefix));
  if (!route) {
    return null;
  }

  const assetPath = requestUrl.pathname.slice(route.prefix.length);
  if (!assetPath) {
    return null;
  }

  const basePath =
    assetPath === "appcast.xml" && "appcastBasePath" in route && route.appcastBasePath
      ? route.appcastBasePath
      : route.basePath;

  return new URL(`${githubOrigin}${basePath}${assetPath}${requestUrl.search}`);
};

export { buildDownloadTargetUrl, downloadHref, downloadRoutes, githubOrigin };
