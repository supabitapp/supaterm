import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

export function workspaceDockHeight(scale: number) {
  return 80 * Math.max(1, scale);
}

export function useWorkspaceDockClearance() {
  const insets = useSafeAreaInsets();
  const { scale } = useAndroidControlSizing();
  return insets.bottom + workspaceDockHeight(scale) + 16;
}
