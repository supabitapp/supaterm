const githubOrigin = "https://github.com";
const releaseBasePath = "/supabitapp/supaterm/releases/download/";
const latestBasePath = "/supabitapp/supaterm/releases/latest/download/";
const checksumAssetName = "checksums.json";
const appcastAssetName = "appcast.xml";
const volatileCacheControl = "public, max-age=300";
const immutableCacheControl = "public, max-age=31536000, immutable";
const versionedTagPattern = /^v\d+\.\d+\.\d+$/;
const checksumGatedAssetNames = new Set(["supaterm.app.zip", "supaterm.dmg"]);

const downloadRoutes = [
  {
    prefix: "/download/latest/",
    basePath: latestBasePath,
  },
  {
    prefix: "/download/tip/",
    basePath: `${releaseBasePath}tip/`,
    appcastBasePath: latestBasePath,
  },
] as const;

const downloadHref = "/download/latest/supaterm.dmg";

type DownloadResolution = {
  assetName: string;
  cacheControl: string;
  manifestUrl: URL;
  targetUrl: URL;
  verifiesChecksum: boolean;
};

const buildUrl = (basePath: string, assetName: string) =>
  new URL(`${githubOrigin}${basePath}${assetName}`);

const resolveNamedDownload = (requestUrl: URL): DownloadResolution | null => {
  const route = downloadRoutes.find(({ prefix }) => requestUrl.pathname.startsWith(prefix));
  if (!route) {
    return null;
  }

  const assetPath = requestUrl.pathname.slice(route.prefix.length);
  if (!assetPath) {
    return null;
  }

  const basePath =
    assetPath === appcastAssetName && "appcastBasePath" in route && route.appcastBasePath
      ? route.appcastBasePath
      : route.basePath;

  const verifiesChecksum = checksumGatedAssetNames.has(assetPath);

  return {
    assetName: assetPath,
    cacheControl: volatileCacheControl,
    manifestUrl: buildUrl(route.basePath, checksumAssetName),
    targetUrl: buildUrl(basePath, assetPath),
    verifiesChecksum,
  };
};

const resolveVersionedDownload = (requestUrl: URL): DownloadResolution | null => {
  if (!requestUrl.pathname.startsWith("/download/v")) {
    return null;
  }

  const segments = requestUrl.pathname.slice("/download/".length).split("/").filter(Boolean);
  const [tag, ...assetSegments] = segments;
  const assetName = assetSegments.join("/");

  if (!tag || !assetName || !versionedTagPattern.test(tag)) {
    return null;
  }

  const basePath = `${releaseBasePath}${tag}/`;
  const verifiesChecksum = checksumGatedAssetNames.has(assetName);

  return {
    assetName,
    cacheControl: verifiesChecksum ? immutableCacheControl : volatileCacheControl,
    manifestUrl: buildUrl(basePath, checksumAssetName),
    targetUrl: buildUrl(basePath, assetName),
    verifiesChecksum,
  };
};

const resolveDownload = (requestUrl: URL) =>
  resolveNamedDownload(requestUrl) ?? resolveVersionedDownload(requestUrl);

const buildDownloadTargetUrl = (requestUrl: URL) => {
  const download = resolveDownload(requestUrl);
  return download?.targetUrl ?? null;
};

const isDownloadPath = (pathname: string) =>
  downloadRoutes.some((route) => pathname.startsWith(route.prefix)) ||
  pathname.startsWith("/download/v");

export { buildDownloadTargetUrl, downloadHref, githubOrigin, isDownloadPath, resolveDownload };
