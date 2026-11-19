import type * as React from "react";

import { cn } from "~/lib/utils";

const chip =
  "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded px-1 font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3";

const kbdVariants = {
  default: `${chip} bg-muted`,
  raised: `${chip} bg-foreground/8`,
  plain: "font-medium font-sans text-secondary-label text-xs tracking-widest",
};

function Kbd({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & { variant?: keyof typeof kbdVariants }) {
  return (
    <kbd
      className={cn("pointer-events-none select-none", kbdVariants[variant], className)}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
