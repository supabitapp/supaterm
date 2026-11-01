import { createElement } from "react";
import { iconDefaults } from "./iconDefaults.ts";
import type { Icon, IconProps } from "@phosphor-icons/react";

export function withIconDefaults(
  Component: Icon,
  defaults: Partial<Pick<IconProps, "weight" | "mirrored">> = {},
) {
  function AppIcon(props: IconProps) {
    return createElement(Component, iconDefaults({ ...defaults, ...props }));
  }
  AppIcon.displayName = Component.displayName;
  return AppIcon;
}
