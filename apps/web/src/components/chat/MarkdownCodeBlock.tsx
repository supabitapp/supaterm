import { Check, Copy } from "lucide";
import { PlayIcon, WrapTextIcon } from "lucide-react";
import React, { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { getClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  hasSpecificPierreIconForFileName,
  syntheticFileNameForLanguageId,
} from "../../pierre-icons";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { PierreEntryIcon } from "./PierreEntryIcon";

const THREAD_FIND_IGNORE_PROPS = {
  "data-thread-find-ignore": "",
} as React.HTMLAttributes<HTMLDivElement>;

export function MarkdownCodeBlockFrame({
  as: Wrapper = "div",
  language,
  fenceTitle,
  theme,
  wrapped = true,
  title,
  actions,
  headerProps,
  children,
}: {
  as?: React.ElementType;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  wrapped?: boolean;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <Wrapper
      dir="ltr"
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-language={language}
      data-wrap={wrapped ? "true" : "false"}
    >
      <div
        {...headerProps}
        className={cn(
          "chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none",
          headerProps?.className,
        )}
      >
        {title ?? (
          <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs">
            <MarkdownCodeBlockTitleContent
              fenceTitle={fenceTitle}
              language={language}
              theme={theme}
            />
          </span>
        )}
        {actions}
      </div>
      {children}
    </Wrapper>
  );
}

function MarkdownCodeBlockTitleContent({
  fenceTitle,
  language,
  theme,
}: {
  fenceTitle: string | null;
  language: string;
  theme: "light" | "dark";
}) {
  if (fenceTitle) {
    return (
      <>
        <PierreEntryIcon pathValue={fenceTitle} kind="file" theme={theme} className="size-3.5" />
        <span className="truncate">{fenceTitle}</span>
      </>
    );
  }

  const fileName = syntheticFileNameForLanguageId(language);
  if (!hasSpecificPierreIconForFileName(fileName)) {
    return <span className="truncate">{language}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 rounded-sm" aria-label={`Language: ${language}`} />
        }
      >
        <PierreEntryIcon pathValue={fileName} kind="file" theme={theme} className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{language}</TooltipPopup>
    </Tooltip>
  );
}

export function MarkdownCodeBlock({
  code,
  language,
  fenceTitle,
  theme,
  onRunShellCommand,
  isStreaming,
  viewToggle,
  canWrap = true,
  diagram = false,
  children,
}: {
  code: string;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  onRunShellCommand?: ((command: string) => void) | undefined;
  isStreaming: boolean;
  viewToggle?: ReactNode;
  canWrap?: boolean;
  diagram?: boolean;
  children: ReactNode;
}) {
  const [wrapped, setWrapped] = useState(() => getClientSettings().wordWrap);
  // The shared clipboard helper falls back to execCommand where navigator.clipboard is missing,
  // such as remote clients served over plain HTTP.
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    timeout: 1200,
    target: "code block",
    onError: (cause) =>
      reportMarkdownActionFailure(
        {
          operation: "copy-code-block",
          language,
          ...(fenceTitle ? { fenceTitle } : {}),
        },
        cause,
      ),
  });
  const wrapLabel = wrapped ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";
  const command = code.trim();
  const canRun =
    onRunShellCommand !== undefined &&
    !isStreaming &&
    /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/.test(language) &&
    code.endsWith("\n") &&
    command.length > 0 &&
    !command.endsWith("\\") &&
    // Control and invisible format characters (bidi overrides, zero-width) can
    // make the rendered command differ from what the terminal would receive.
    !/[\p{Cc}\p{Cf}]/u.test(code.slice(0, -1));

  const copyButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            onClick={() => copyToClipboard(code)}
            aria-label={copyLabel}
          />
        }
      >
        <MorphIcon className="size-3" icon={copied ? Check : Copy} />
      </TooltipTrigger>
      <TooltipPopup side="top">{copyLabel}</TooltipPopup>
    </Tooltip>
  );

  if (diagram) {
    return (
      <div className="my-[0.65rem] border border-transparent" data-language={language}>
        <div className="flex items-center justify-end gap-0.5 pt-1.5 pr-1.5 select-none">
          {viewToggle}
          {copyButton}
        </div>
        {children}
      </div>
    );
  }

  return (
    <MarkdownCodeBlockFrame
      language={language}
      fenceTitle={fenceTitle}
      theme={theme}
      wrapped={wrapped}
      headerProps={THREAD_FIND_IGNORE_PROPS}
      actions={
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Code block actions">
          {canWrap ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={wrapped ? "secondary" : "ghost-muted"}
                    size="icon-xs"
                    aria-pressed={wrapped}
                    onClick={() => setWrapped((value) => !value)}
                    aria-label={wrapLabel}
                  />
                }
              >
                <WrapTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
            </Tooltip>
          ) : null}
          {canRun ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    onClick={() => onRunShellCommand(command)}
                    aria-label="Run in terminal"
                  />
                }
              >
                <PlayIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">Run in terminal</TooltipPopup>
            </Tooltip>
          ) : null}
          {viewToggle}
          {copyButton}
        </span>
      }
    >
      {children}
    </MarkdownCodeBlockFrame>
  );
}
