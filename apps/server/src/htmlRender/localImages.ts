export const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES).join("|");
export const ABSOLUTE_PATH = String.raw`(?:/(?!/)|[a-z]:[\\/])`;

const LOCAL_IMAGE_PATH = new RegExp(
  String.raw`^${ABSOLUTE_PATH}[^\r\n]*\.(?:${IMAGE_EXTENSIONS})$`,
  "i",
);

/** A path a page can reference for HtmlRender to embed when it prepares the page. */
export const isLocalImagePath = (path: string) => LOCAL_IMAGE_PATH.test(path);
