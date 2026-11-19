import { Image, type ImageSourcePropType } from "react-native";

import type { MarkdownFileIcon } from "./markdownLinks";
import { MARKDOWN_FILE_ICON_SOURCES } from "./markdownFileIcons.generated";

export function markdownFileIconSource(icon: MarkdownFileIcon): ImageSourcePropType;
export function markdownFileIconSource(icon: MarkdownFileIcon) {
  return MARKDOWN_FILE_ICON_SOURCES[icon] satisfies ImageSourcePropType;
}

export function markdownIconAssetUri(source: ImageSourcePropType) {
  return Image.resolveAssetSource(source)?.uri;
}
