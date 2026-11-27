import { isValidElement, type ReactElement, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

type TooltipPopupProps = Parameters<typeof TooltipPopup>[0];

// A disabled control gets no pointer events, so its tooltip is unreachable anyway.
function renderedDisabled(element: ReactElement): boolean {
  const props = element.props as { disabled?: unknown; render?: unknown };
  if (props.disabled === true) return true;
  return isValidElement(props.render) && renderedDisabled(props.render);
}

/** A tooltip on `render`, with the trigger's props passed through unchanged. */
export function SharedTooltipTrigger({
  render,
  children,
  label,
  side = "top",
  align,
  sideOffset,
  variant,
  className,
  disabled = false,
}: {
  render: ReactElement;
  children?: ReactNode;
  label: ReactNode;
  side?: TooltipPopupProps["side"];
  align?: TooltipPopupProps["align"];
  sideOffset?: TooltipPopupProps["sideOffset"];
  variant?: TooltipPopupProps["variant"];
  className?: string;
  disabled?: boolean | undefined;
}) {
  const inactive = disabled === true || renderedDisabled(render);
  return (
    <Tooltip disabled={inactive}>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipPopup
        side={side}
        {...(align ? { align } : {})}
        {...(sideOffset === undefined ? {} : { sideOffset })}
        {...(variant ? { variant } : {})}
        {...(className ? { className } : {})}
      >
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}
