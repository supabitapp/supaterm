export const COMPOSER_ATTACHMENT_DIRECTORY = "supaterm-composer-attachments";
/** Recordings queued as voice messages before dictation moved on-device; outbox entries keep them as files. */
export const LEGACY_VOICE_RECORDING_DIRECTORY = "thread-outbox-audio";

const UUID_PATTERN = "[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}";
const OWNED_DIRECTORIES = [
  { directory: COMPOSER_ATTACHMENT_DIRECTORY, generatedName: new RegExp(`^${UUID_PATTERN}-`, "i") },
  {
    directory: LEGACY_VOICE_RECORDING_DIRECTORY,
    generatedName: new RegExp(`^${UUID_PATTERN}\\.wav$`, "i"),
  },
] as const;
const IOS_DOCUMENTS_PATH = new RegExp(
  `^(.*/Containers/Data/Application/)${UUID_PATTERN}/Documents$`,
  "i",
);
const retainedFiles = new Map<string, number>();

function fileUriPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.hostname || url.search || url.hash) {
      return null;
    }
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\\") || path.includes("\0") || path.split("/").includes("..")) {
      return null;
    }
    return path.startsWith("/private/var/") ? path.slice("/private".length) : path;
  } catch {
    return null;
  }
}

function ownedFileLocation(uri: string) {
  const path = fileUriPath(uri);
  if (path === null) {
    return null;
  }
  for (const owner of OWNED_DIRECTORIES) {
    const separator = `/${owner.directory}/`;
    const index = path.lastIndexOf(separator);
    if (index < 0) continue;
    const name = path.slice(index + separator.length);
    if (!name || name === "." || name.includes("/")) {
      return null;
    }
    return { documentPath: path.slice(0, index), owner, name };
  }
  return null;
}

export function composerAttachmentFileReferenceKey(uri: string): string {
  const location = ownedFileLocation(uri);
  if (!location) {
    return uri;
  }
  const containerPrefix = location.owner.generatedName.test(location.name)
    ? IOS_DOCUMENTS_PATH.exec(location.documentPath)?.[1]
    : undefined;
  const documentPath = containerPrefix
    ? `${containerPrefix}<app>/Documents`
    : location.documentPath;
  return `file://${documentPath}/${location.owner.directory}/${encodeURIComponent(location.name)}`;
}

export function retainComposerAttachmentFile(uri: string, onLastRelease: () => void): () => void {
  const key = composerAttachmentFileReferenceKey(uri);
  retainedFiles.set(key, (retainedFiles.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (retainedFiles.get(key) ?? 1) - 1;
    if (remaining > 0) {
      retainedFiles.set(key, remaining);
      return;
    }
    retainedFiles.delete(key);
    onLastRelease();
  };
}

export function isComposerAttachmentFileRetained(uri: string): boolean {
  return retainedFiles.has(composerAttachmentFileReferenceKey(uri));
}

/** iOS updates can change the Documents container UUID. Bypass source URIs from pickers or other apps. */
export function resolveOwnedComposerAttachmentFileUri(
  uri: string,
  documentDirectoryUri: string,
): string | null {
  const location = ownedFileLocation(uri);
  const documentPath = fileUriPath(documentDirectoryUri)?.replace(/\/+$/, "");
  if (!location || !documentPath) {
    return null;
  }
  if (location.documentPath !== documentPath) {
    const currentContainerPrefix = IOS_DOCUMENTS_PATH.exec(documentPath)?.[1];
    if (
      !currentContainerPrefix ||
      currentContainerPrefix !== IOS_DOCUMENTS_PATH.exec(location.documentPath)?.[1] ||
      !location.owner.generatedName.test(location.name)
    ) {
      return null;
    }
  }
  const resolved = new URL(documentDirectoryUri);
  resolved.pathname = `${resolved.pathname.replace(/\/+$/, "")}/${location.owner.directory}/${encodeURIComponent(location.name)}`;
  return resolved.href;
}
