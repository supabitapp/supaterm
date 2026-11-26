import type { RuntimeMode } from "@supaterm/contracts";
import { BuildingIcon } from "@supaterm/icons";
import { T, Var } from "gt-react";

import type { MessageResolver } from "~/i18n/messages";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { runtimeModeConfig } from "./runtimeModeConfig";

/** Shown while the thread's mode is above its environment's ceiling, so sends would be refused. */
export function managedRuntimeModeBannerItem(
  denial: string,
  fallback: RuntimeMode | undefined,
  onSwitch: (mode: RuntimeMode) => void,
  resolve: MessageResolver,
): ComposerBannerStackItem {
  return {
    id: "managed-runtime-mode",
    variant: "warning",
    icon: <BuildingIcon />,
    title: denial,
    ...(fallback === undefined
      ? {}
      : {
          actions: (
            <Button size="xs" variant="ghost" onClick={() => onSwitch(fallback)}>
              <T>
                Switch to <Var>{resolve(runtimeModeConfig[fallback].label)}</Var>
              </T>
            </Button>
          ),
        }),
  };
}
