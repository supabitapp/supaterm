import { CheckIcon, CopyIcon, Maximize2Icon } from "lucide-react";
import { use, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { renderMermaidDiagram } from "./mermaidRenderer";
import { ExpandedPreviewDialog } from "../components/chat/ExpandedPreviewDialog";
import { MarkdownFindContext, useFindRevealRef } from "../components/chat/markdownFindContext";

export function MermaidBlock({
  source,
  complete,
  title,
}: {
  source: string;
  complete: boolean;
  title: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [rendered, setRendered] = useState<{ source: string; output: string | null } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>(null);
  const searching = use(MarkdownFindContext);
  const revealSource = useCallback(() => setShowSource(true), []);
  const sourceRevealRef = useFindRevealRef(revealSource);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    timeout: 1200,
    target: "diagram content",
    onCopy: setCopiedText,
  });
  const output = complete && rendered?.source === source ? rendered.output : null;
  const showingDiagram = output !== null && !showSource;
  const content = showingDiagram ? output : source;
  const copied = isCopied && copiedText === content;
  const copyLabel = copied ? "Copied" : showingDiagram ? "Copy diagram" : "Copy source";

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!complete || !visible) return;
    let current = true;
    void renderMermaidDiagram(source).then((result) => {
      if (current) setRendered({ source, output: result });
    });
    return () => {
      current = false;
    };
  }, [complete, source, visible]);

  return (
    <div
      ref={container}
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
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
                      onClick={() => setExpandedDiagram(output)}
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
                  onClick={() => copyToClipboard(content, content)}
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      <pre
        ref={searching && !showingDiagram ? sourceRevealRef : undefined}
        data-thread-find-ignore={showingDiagram ? "true" : undefined}
        className="overflow-x-auto whitespace-pre font-mono [overflow-wrap:normal] [word-break:normal]"
      >
        <code>{content}</code>
      </pre>
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
          <pre className="m-0 font-mono text-(length:--font-size-code,var(--text-sm)) leading-snug whitespace-pre">
            {expandedDiagram}
          </pre>
        </ExpandedPreviewDialog>
      ) : null}
    </div>
  );
}
