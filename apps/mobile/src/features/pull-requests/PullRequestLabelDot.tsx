import { View } from "react-native";

export function PullRequestLabelDot(props: { readonly color: string | null }) {
  return (
    <View
      className="size-2.5 rounded-full"
      style={{ backgroundColor: props.color ?? "transparent" }}
    />
  );
}
