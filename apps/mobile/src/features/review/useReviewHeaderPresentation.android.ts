import type { useReviewHeaderPresentation as useIosReviewHeaderPresentation } from "./useReviewHeaderPresentation";
import { useGT } from "gt-react-native";

export function useReviewHeaderPresentation(
  props: Parameters<typeof useIosReviewHeaderPresentation>[0],
): ReturnType<typeof useIosReviewHeaderPresentation> {
  const gt = useGT();
  return {
    title: gt("Review changes"),
    subtitle: props.androidSubtitle || gt("Select a diff"),
    gitMenu: null,
    menuIcon: "ellipsis.circle",
    refreshAction: {
      id: "refresh",
      title: gt("Refresh current diff"),
      icon: "arrow.clockwise",
      disabled: !props.selectedSection || props.selectedSection.isLoading,
      onPress: () => {
        void props.onRefresh();
      },
    },
  };
}
