import type { ScopedThreadRef } from "@supaterm/contracts";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { ExpandedPreviewDialog } from "./ExpandedPreviewDialog";

export function HtmlRenderDialog(props: {
  readonly src: string;
  readonly title: string;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly onClose: () => void;
}) {
  return (
    <ExpandedPreviewDialog
      title={props.title}
      contentClassName="h-[100cqh] w-[100cqw]"
      onClose={props.onClose}
    >
      <HtmlRenderDocument
        src={props.src}
        title={props.title}
        threadRef={props.threadRef}
        className="block size-full"
      />
    </ExpandedPreviewDialog>
  );
}
