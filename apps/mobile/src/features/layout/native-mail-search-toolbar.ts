import type { HeaderBarButtonMailSearchToolbarItem } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { msg } from "gt-react-native";
import { m } from "../../i18n/messages";
import { type MessageResolver } from "../../i18n/messages";

export const NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED = NATIVE_LIQUID_GLASS_SUPPORTED;

export const NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET = 56;

type NativeMailSearchToolbarInput = Omit<
  HeaderBarButtonMailSearchToolbarItem,
  "type" | "useFallbackSearchField"
>;

export function createNativeMailSearchToolbarItem(
  input: NativeMailSearchToolbarInput,
  resolve: MessageResolver = m,
): HeaderBarButtonMailSearchToolbarItem {
  return {
    placeholder: resolve(msg("Search")),
    ...input,
    type: "mailSearchToolbar",
    useFallbackSearchField: true,
  };
}
