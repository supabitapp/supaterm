import { Children, isValidElement, use, type ComponentProps, type ReactNode } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { findRevealRef, MarkdownFindContext } from "./markdownFindContext";
import { useTimelineDisclosure } from "./timelineDisclosure";

export function MarkdownDetails({
  children,
  open = false,
}: Pick<ComponentProps<"details">, "children" | "open">) {
  const [isOpen, toggle, setIsOpen] = useTimelineDisclosure(open);
  const searching = use(MarkdownFindContext);
  const expanded = isOpen;
  const revealForFind = () => setIsOpen(true);
  const revealRef = findRevealRef(revealForFind);
  const childNodes = Children.toArray(children);
  const summaryIndex = childNodes.findIndex(
    (child) => isValidElement(child) && child.type === "summary",
  );
  const summaryNode = summaryIndex >= 0 ? childNodes[summaryIndex] : null;
  const summary =
    isValidElement<{ children?: ReactNode }>(summaryNode) && summaryNode.props.children
      ? summaryNode.props.children
      : "Details";
  const content = childNodes.filter((_, index) => index !== summaryIndex);

  return (
    <div className="my-2 border-y border-border/60">
      <Collapsible
        open={isOpen}
        onOpenChange={(_, details) => toggle(details.event)}
        data-markdown-details=""
        data-markdown-details-open={expanded ? "true" : "false"}
      >
        <CollapsibleTrigger
          className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium text-foreground"
          data-markdown-details-summary=""
        >
          <span className="flex shrink-0 text-muted-foreground">
            <DisclosureChevron open={isOpen} size="sm" />
          </span>
          <span>{summary}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel ref={revealRef} hiddenUntilFound={searching}>
          <div
            className="pb-3 ps-6 text-foreground/[calc(80%+var(--appearance-contrast-boost)/5)]"
            data-markdown-details-content=""
          >
            {content}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
