import { ChevronRightIcon } from "@supaterm/icons";
import { cn } from "~/lib/utils";

const sizes = { xs: "size-3", sm: "size-3.5" } as const;

/** Row disclosure indicator: right when closed, down when open. Color comes from the parent. */
export function DisclosureChevron({
  open,
  size = "xs",
}: {
  open: boolean;
  size?: keyof typeof sizes;
}) {
  return (
    <ChevronRightIcon
      aria-hidden
      className={cn(
        sizes[size],
        "shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );
}
