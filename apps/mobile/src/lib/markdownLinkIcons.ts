import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import type { ImageSourcePropType } from "react-native";

export interface MarkdownLinkIcon {
  readonly source: ImageSourcePropType;
  readonly tints: boolean;
}

export function markdownLinkIcon(host: string): MarkdownLinkIcon | null {
  return sourceControlClients.findByPublicDomain(host)
    ? { source: require("../../assets/icons/file-diff.png"), tints: true }
    : null;
}
