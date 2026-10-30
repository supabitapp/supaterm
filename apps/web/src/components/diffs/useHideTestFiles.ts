import * as Schema from "effect/Schema";
import { useLocalStorage } from "~/hooks/useLocalStorage";

export function useHideTestFiles() {
  return useLocalStorage("supaterm.diffHideTestFiles", false, Schema.Boolean);
}
