import Animated from "react-native-reanimated";

import { Notice } from "../../components/ui/Notice";
import { useNoticeMotion } from "../../lib/useNoticeMotion";

export function ComposerErrorNotice(props: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  const motion = useNoticeMotion();
  return (
    <Animated.View {...motion} collapsable={false} className="px-4 pb-3">
      <Notice
        message={props.message}
        icon="exclamationmark.circle"
        iconTone="danger"
        floating
        onDismiss={props.onDismiss}
        dismissLabel="Dismiss error"
      />
    </Animated.View>
  );
}
