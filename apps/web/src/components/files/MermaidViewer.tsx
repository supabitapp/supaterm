import { useState } from "react";

import { MermaidDiagram } from "../chat/MermaidDiagram";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";

export default function MermaidViewer(props: { readonly text: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto p-6 [&_*]:animate-none!">
      <MermaidDiagram source={props.text} onExpand={setExpanded} />
      {expanded ? (
        <ExpandedImageDialog
          preview={{ images: [{ src: expanded, name: "Mermaid diagram" }], index: 0 }}
          onClose={() => setExpanded(null)}
        />
      ) : null}
    </div>
  );
}
