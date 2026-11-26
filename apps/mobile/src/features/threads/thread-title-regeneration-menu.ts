import type { MenuAction } from "@react-native-menu/menu";
import { msg } from "gt-react-native";

export function buildThreadTitleRegenerationMenuItems(input: {
  readonly supported: boolean;
  readonly isRegenerating: boolean;
}): MenuAction[] {
  if (!input.supported) return [];

  return [
    {
      id: "regenerate-title",
      title: input.isRegenerating ? msg("Regenerating…") : msg("Regenerate title"),
      image: "arrow.clockwise",
      ...(input.isRegenerating ? { attributes: { disabled: true } } : {}),
    },
  ];
}
