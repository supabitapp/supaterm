import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SeparatorProps = HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
};

function Separator({ className, orientation = "horizontal", ...props }: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
