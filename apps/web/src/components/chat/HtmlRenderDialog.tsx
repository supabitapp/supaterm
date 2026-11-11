import type { ScopedThreadRef } from "@supaterm/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@supaterm/shared/htmlRender";
import { useState, type ComponentProps } from "react";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { ExpandedPreviewDialog } from "./ExpandedPreviewDialog";

export function HtmlRenderDialog(props: {
  readonly src: string;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly onSelection?: ComponentProps<typeof HtmlRenderDocument>["onSelection"];
  readonly onClose: () => void;
}) {
  const { title } = props.htmlRender;
  const [contentHeight, setContentHeight] = useState<number>();
  return (
    <ExpandedPreviewDialog
      title={title}
      fit={{
        initialWidth: HTML_RENDER_COLUMN_WIDTH,
        heightAtWidth: (width) => htmlRenderFrameHeight(props.htmlRender, width, contentHeight),
      }}
      onClose={props.onClose}
    >
      <HtmlRenderDocument
        src={props.src}
        title={title}
        threadRef={props.threadRef}
        className="block size-full"
        onContentHeight={setContentHeight}
        onSelection={props.onSelection}
      />
    </ExpandedPreviewDialog>
  );
}
