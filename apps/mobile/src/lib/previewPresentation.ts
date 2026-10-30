import { useNavigation } from "@react-navigation/native";
import { useEffect, useEffectEvent } from "react";
import { Keyboard } from "react-native";

import { mediaVideoThumbnailKey, type VideoPreviewSource } from "./videoPreviewSource";

export function videoPreviewKey(source: VideoPreviewSource): string {
  return source.type === "local"
    ? `local:${source.attachment.id}:${source.attachment.fileUri}`
    : mediaVideoThumbnailKey(source);
}

export function usePreviewPresentation(
  presentationKey: string | null,
  onRequestClose: () => void,
): void {
  const navigation = useNavigation();
  const close = useEffectEvent(onRequestClose);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Navigation blur is an external event and the open state belongs to the caller.
  useEffect(() => {
    if (presentationKey === null) return;
    Keyboard.dismiss();
    if (!navigation.isFocused()) {
      close();
      return;
    }
    return navigation.addListener("blur", () => close());
  }, [presentationKey, navigation]);
}
