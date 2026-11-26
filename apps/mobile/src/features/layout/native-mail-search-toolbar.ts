import type { HeaderBarButtonMailSearchToolbarItem } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { msg } from "gt-react-native";

export const NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED = NATIVE_LIQUID_GLASS_SUPPORTED;

export const NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET = 56;

type NativeMailSearchToolbarInput = Omit<
  HeaderBarButtonMailSearchToolbarItem,
  "type" | "useFallbackSearchField"
>;

export function createNativeMailSearchToolbarItem(
  input: NativeMailSearchToolbarInput,
): HeaderBarButtonMailSearchToolbarItem {
  return {
    placeholder: msg("Search"),
    ...input,
    type: "mailSearchToolbar",
    useFallbackSearchField: true,
  };
}
