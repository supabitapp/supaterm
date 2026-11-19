import {
  isMonochromeSourceControlIcon,
  sourceControlClients,
} from "@supaterm/client-runtime/source-control-clients";
import type { ImageSourcePropType } from "react-native";

import { SOURCE_CONTROL_LINK_ICON_SOURCES } from "./markdownLinkIcons.generated";

export interface MarkdownLinkIcon {
  readonly source: ImageSourcePropType;
  /** A mark drawn in the text colour takes the link's colour; a coloured mark keeps its own. */
  readonly tints: boolean;
}

export function markdownLinkIcon(host: string): MarkdownLinkIcon | null {
  const definition = sourceControlClients.findByPublicDomain(host);
  const source = definition && SOURCE_CONTROL_LINK_ICON_SOURCES[definition.kind];
  return definition?.icon && source
    ? { source, tints: isMonochromeSourceControlIcon(definition.icon) }
    : null;
}
