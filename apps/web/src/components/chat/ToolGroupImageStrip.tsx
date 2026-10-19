import {
  toolGroupImageKey,
  type ToolGroupImage,
} from "@supaterm/client-runtime/work-log/presentation";
import type { EnvironmentId } from "@supaterm/contracts";
import { useState, type CSSProperties } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { usePresence } from "~/hooks/usePresence";
import { cn } from "~/lib/utils";
import { ChatMarkdownAssetImage } from "../ChatMarkdown";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

const VISIBLE_IMAGE_LIMIT = 12;
const THUMBNAIL_STYLE: CSSProperties = { height: "100%", width: "auto", maxWidth: "24rem" };
const NO_KEYS: ReadonlySet<string> = new Set();

/** Images that join an already-rendered strip slide in; a remounted strip shows as it is. */
function useArrivedImageKeys(keys: ReadonlyArray<string>): ReadonlySet<string> {
  const keysKey = keys.join("\n");
  const [state, setState] = useState({ keysKey, arrived: NO_KEYS });
  if (state.keysKey !== keysKey) {
    const previous = new Set(state.keysKey.split("\n"));
    setState({ keysKey, arrived: new Set(keys.filter((key) => !previous.has(key))) });
  }
  return state.arrived;
}

export function ToolGroupImageStrip(props: {
  images: ReadonlyArray<ToolGroupImage> | undefined;
  inset?: boolean;
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const enabled = useClientSettings((settings) => settings.showToolImages);
  const presence = usePresence(enabled && props.images?.length ? props.images : null);
  const images = presence.value ?? [];
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? images : images.slice(0, VISIBLE_IMAGE_LIMIT);
  const keys = visible.map(toolGroupImageKey);
  const arrived = useArrivedImageKeys(keys);
  if (images.length === 0) return null;
  const hiddenCount = images.length - visible.length;
  return (
    <div
      {...presence.props}
      inert={presence.exiting}
      data-image-gallery
      className={cn(
        props.inset === false ? "ms-1" : "ms-7",
        "mt-1 transition-[opacity,translate] duration-180 ease-drawer data-enter:starting:-translate-y-1 data-enter:starting:opacity-0 data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-ending-style:duration-140 motion-reduce:transition-none",
      )}
    >
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {visible.map((image, index) => (
          <div
            key={keys[index]}
            data-enter={arrived.has(keys[index]!) ? "" : undefined}
            className="h-22 shrink-0 transition-[opacity,translate] duration-180 ease-drawer data-enter:starting:-translate-x-1.5 data-enter:starting:opacity-0 motion-reduce:transition-none"
          >
            <ChatMarkdownAssetImage
              environmentId={props.environmentId}
              resource={image.resource}
              alt={image.alt}
              srcFragment={image.srcFragment ?? ""}
              workspaceRoot={props.workspaceRoot}
              style={THUMBNAIL_STYLE}
              onImageExpand={props.onImageExpand}
            />
          </div>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            aria-label={`Show ${hiddenCount} more images`}
            onClick={() => setShowAll(true)}
            className="h-22 w-16 shrink-0 cursor-pointer rounded-lg border border-border/40 bg-muted/40 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset focus-visible:outline-none"
          >
            +{hiddenCount}
          </button>
        ) : null}
      </div>
    </div>
  );
}
