import { memo, Suspense, use, type ReactNode } from "react";

import {
  createComposerImageThumbnail,
  readComposerImageThumbnail,
  type ComposerImageThumbnailMode,
} from "../../lib/imageCompression";
import { cn } from "../../lib/utils";

export const ComposerImageThumbnail = memo(function ComposerImageThumbnail(props: {
  file: File;
  mode?: ComposerImageThumbnailMode;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  return (
    <Suspense fallback={props.fallback}>
      <ThumbnailImage {...props} />
    </Suspense>
  );
});

function ThumbnailImage({
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
  // A settled thumbnail paints synchronously instead of suspending for a tick.
  const settled = readComposerImageThumbnail(file, mode);
  const src = settled === undefined ? use(createComposerImageThumbnail(file, mode)) : settled;
  return src ? (
    <img
      src={src}
      alt={alt}
      className={cn(className, mode === "snapshot" ? "object-contain" : "object-cover")}
    />
  ) : (
    fallback
  );
}
