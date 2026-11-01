import { memo, useLayoutEffect, useState, type ReactNode } from "react";

import {
  createComposerImageThumbnail,
  isHeicImageFile,
  MAX_COMPRESSIBLE_SOURCE_BYTES,
  readComposerImageThumbnail,
  type ComposerImageThumbnailMode,
} from "../../lib/imageCompression";
import { cn } from "../../lib/utils";

export const ComposerImageThumbnail = memo(function ComposerImageThumbnail({
  file,
  mode = "square",
  alt,
  className,
  fallback,
}: {
  file: File;
  mode?: ComposerImageThumbnailMode;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const [preview, setPreview] = useState(() => ({
    file,
    mode,
    src: readComposerImageThumbnail(file, mode),
  }));
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src =
    preview.file === file && preview.mode === mode
      ? preview.src
      : readComposerImageThumbnail(file, mode);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- owns the local blob URL and decodes its replacement before swapping the visible image
  useLayoutEffect(() => {
    let disposed = false;
    let localUrl: string | undefined;
    const cached = readComposerImageThumbnail(file, mode);
    if (
      file.size <= MAX_COMPRESSIBLE_SOURCE_BYTES &&
      !isHeicImageFile(file) &&
      cached === undefined
    ) {
      localUrl = URL.createObjectURL(file);
      // oxlint-disable-next-line react/set-state-in-effect -- the blob URL is created and revoked by this effect
      setPreview({ file, mode, src: localUrl });
    }
    if (cached === undefined) {
      void createComposerImageThumbnail(file, mode).then(async (thumbnail) => {
        if (disposed) return;
        if (!thumbnail) {
          if (!localUrl) setPreview({ file, mode, src: null });
          return;
        }
        const image = new Image();
        image.src = thumbnail;
        try {
          await image.decode();
          if (!disposed) setPreview({ file, mode, src: thumbnail });
        } catch {
          // Keep the local preview if the thumbnail cannot be decoded.
        }
      });
    }
    return () => {
      disposed = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [file, mode]);

  return src && failedSrc !== src ? (
    <img
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
      }}
      src={src}
      alt={alt}
      onLoad={() => setLoadedSrc(src)}
      onError={() => setFailedSrc(src)}
      className={cn(
        className,
        mode === "snapshot" ? "object-contain" : "object-cover",
        loadedSrc !== src && "invisible",
      )}
    />
  ) : src === undefined ? null : (
    fallback
  );
});
