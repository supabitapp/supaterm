import type { ScopedThreadRef } from "@supaterm/contracts";
import type { ComponentProps } from "react";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { ExpandedPreviewDialog } from "./ExpandedPreviewDialog";

export function HtmlRenderDialog(props: {
  readonly src: string;
  readonly title: string;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly onSelection?: ComponentProps<typeof HtmlRenderDocument>["onSelection"];
  readonly onClose: () => void;
}) {
  return (
    <ExpandedPreviewDialog title={props.title} fit="fill" onClose={props.onClose}>
      <HtmlRenderDocument
        src={props.src}
        title={props.title}
        threadRef={props.threadRef}
        className="block size-full"
        onSelection={props.onSelection}
      />
    </ExpandedPreviewDialog>
  );
}
