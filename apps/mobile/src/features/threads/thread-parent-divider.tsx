import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  presentParentThreadLink,
  type ParentThread,
} from "@supaterm/client-runtime/state/thread-relationships";
import type { EnvironmentId } from "@supaterm/contracts";
import type { ColorValue } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadContextDivider } from "./thread-context-divider";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

/** Heads a side chat's or subagent's timeline, which holds none of its parent's items. */
export function ThreadParentDivider(props: {
  readonly environmentId: EnvironmentId;
  readonly parent: ParentThread;
  readonly iconColor: ColorValue;
}) {
  const openLinkedThread = useOpenLinkedThread();
  const parentShell = useQuietThreadShell(
    scopeThreadRef(props.environmentId, props.parent.threadId),
  );
  const link = presentParentThreadLink(props.parent, parentShell);
  return (
    <ThreadContextDivider
      label={link.label}
      icon={link.sideChat ? "bubble.left.and.bubble.right" : "person.2"}
      iconColor={props.iconColor}
      accessibilityLabel={`${link.label} ${link.title}`}
      accessibilityHint="Opens the parent thread"
      onPress={() =>
        openLinkedThread({ environmentId: props.environmentId, threadId: link.threadId })
      }
    >
      <Text numberOfLines={1} className="shrink text-xs text-foreground-muted">
        · {link.title}
      </Text>
    </ThreadContextDivider>
  );
}
