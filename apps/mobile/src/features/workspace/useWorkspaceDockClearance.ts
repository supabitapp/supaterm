import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

export function useWorkspaceDockClearance() {
  const insets = useSafeAreaInsets();
  const { scale } = useAndroidControlSizing();
  return insets.bottom + 80 * Math.max(1, scale) + 16;
}
