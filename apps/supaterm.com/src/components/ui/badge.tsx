import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center justify-center whitespace-nowrap border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.22em] transition-colors rounded-full",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border/70 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ className, variant }))} {...props} />
  );
}

export { Badge, badgeVariants };
