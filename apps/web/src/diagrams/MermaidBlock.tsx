import { serializeCodeBlockToMarkdown } from "../markdown-clipboard";
import { CheckIcon, CopyIcon, Maximize2Icon } from "lucide-react";
import { use, useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { ExpandedMermaid, MermaidSvg, useDiagramWidth, useMermaidDiagram } from "./MermaidSvg";
import { ExpandedPreviewDialog } from "../components/chat/ExpandedPreviewDialog";
import { MarkdownFindContext, findRevealRef } from "../components/chat/markdownFindContext";

export function MermaidBlock({
  source,
  complete,
  title,
}: {
  source: string;
  complete: boolean;
  title: string | null;
}) {
  const { ref: container, width } = useDiagramWidth();
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [showSource, setShowSource] = useState(false);
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>(null);
  const searching = use(MarkdownFindContext);
  const revealSource = () => setShowSource(true);
  const sourceRevealRef = findRevealRef(revealSource);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    timeout: 1200,
    target: "diagram content",
    onCopy: setCopiedText,
  });
  const diagram = useMermaidDiagram(source, width, complete && visible);
  const output = complete ? diagram : null;
  const showingDiagram = output !== null && !showSource;
  const copied = isCopied && copiedText === source;
  const copyLabel = copied ? "Copied" : "Copy Mermaid source";

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  return (
    <div
      ref={container}
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-markdown-mermaid=""
      data-markdown-copy={
        showingDiagram ? serializeCodeBlockToMarkdown(source, "mermaid") : undefined
      }
      data-language="mermaid"
      data-wrap="false"
    >
      <div
        data-thread-find-ignore="true"
        className="chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none"
      >
        <span className="min-w-0 truncate font-mono text-2xs">{title ?? "mermaid"}</span>
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Diagram actions">
          {output !== null ? (
            <>
              <Button
                size="xs"
                variant={showingDiagram ? "secondary" : "ghost-muted"}
                aria-pressed={showingDiagram}
                onClick={() => setShowSource(false)}
              >
                Diagram
              </Button>
              <Button
                size="xs"
                variant={showSource ? "secondary" : "ghost-muted"}
                aria-pressed={showSource}
                onClick={() => setShowSource(true)}
              >
                Source
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost-muted"
                      size="icon-xs"
                      aria-label="Open full screen"
                      onClick={() => setExpandedDiagram(source)}
                    />
                  }
                >
                  <Maximize2Icon className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="top">Open full screen</TooltipPopup>
              </Tooltip>
            </>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label={copyLabel}
                  onClick={() => copyToClipboard(source, source)}
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      {showingDiagram ? (
        <div
          data-thread-find-ignore="true"
          tabIndex={0}
          aria-label="Mermaid diagram"
          className="max-h-120 overflow-auto overscroll-contain p-3"
        >
          <MermaidSvg diagram={output} />
        </div>
      ) : (
        <pre
          ref={searching ? sourceRevealRef : undefined}
          className="overflow-x-auto whitespace-pre font-mono [overflow-wrap:normal] [word-break:normal]"
        >
          <code>{source}</code>
        </pre>
      )}
      {searching && showingDiagram ? (
        <pre ref={sourceRevealRef} hidden>
          {source}
        </pre>
      ) : null}
      {expandedDiagram !== null ? (
        <ExpandedPreviewDialog
          title={title ?? "Mermaid diagram"}
          fit="center"
          onClose={() => setExpandedDiagram(null)}
        >
          <ExpandedMermaid source={expandedDiagram} />
        </ExpandedPreviewDialog>
      ) : null}
    </div>
  );
}
