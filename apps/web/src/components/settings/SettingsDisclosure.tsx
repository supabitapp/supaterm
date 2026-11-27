import { ChevronRightIcon } from "@supaterm/icons";
import type { ReactNode } from "react";

export function SettingsDisclosure({
  title,
  children,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="mx-1 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:mx-2 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRightIcon
          aria-hidden
          className="size-3 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      {children}
    </details>
  );
}
