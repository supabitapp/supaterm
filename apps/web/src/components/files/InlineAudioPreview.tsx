import type { AssetResource, EnvironmentId } from "@supaterm/contracts";
import { useState } from "react";
import { observeIntersection } from "~/lib/observeIntersection";

import { useAssetUrlState } from "~/assets/assetUrls";

import { AudioPreview } from "./AudioPreview";

export function InlineAudioPreview(props: {
  readonly name: string;
  readonly environmentId?: EnvironmentId;
  readonly resource?: AssetResource;
  readonly src?: string;
  readonly copyMarkdown?: string;
  readonly onOpen?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const asset = useAssetUrlState(
    visible ? (props.environmentId ?? null) : null,
    visible ? (props.resource ?? null) : null,
  );
  const src = visible ? (asset._tag === "Success" ? asset.url : props.src) : undefined;
  const failed = asset._tag === "Failure" || (src !== undefined && failedSrc === src);

  return (
    <span
      ref={(element) => {
        if (!element) return;
        return observeIntersection(element, (entry) => {
          if (entry.isIntersecting) setVisible(true);
        });
      }}
      data-markdown-copy={props.copyMarkdown}
    >
      <AudioPreview
        compact
        name={props.name}
        src={src ?? ""}
        revision={
          props.resource
            ? JSON.stringify([props.environmentId, props.resource])
            : (props.src ?? null)
        }
        failed={failed}
        onOpen={props.onOpen}
        onRetry={() => setFailedSrc(null)}
        onError={() => setFailedSrc(src ?? null)}
      />
    </span>
  );
}
