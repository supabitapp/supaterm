import type { IconProps } from "@phosphor-icons/react";

export function iconDefaults(props: IconProps): IconProps {
  const labelled =
    props["aria-label"] !== undefined ||
    props["aria-labelledby"] !== undefined ||
    props.role !== undefined;
  return { size: 24, "aria-hidden": labelled ? undefined : true, ...props };
}
