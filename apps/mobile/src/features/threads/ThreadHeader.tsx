import type { ThreadPinnedMessage } from "@supaterm/contracts";
import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
import { pinnedMessageCaption, pinnedMessageTitle } from "./pinnedMessageLabels";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  readonly pinnedMessages?: ReadonlyArray<ThreadPinnedMessage>;
  readonly onJumpToPinnedMessage?: (pin: ThreadPinnedMessage) => void;
}) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? "Close files" : "Open files",
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  const { pinnedMessages, onJumpToPinnedMessage } = props;
  const pinsMenu: AppBarMenu | null =
    pinnedMessages?.length && onJumpToPinnedMessage
      ? {
          title: "Pinned messages",
          icon: "pin",
          items: pinnedMessages.map((pin) => ({
            id: pin.itemId,
            title: pinnedMessageTitle(pin),
            subtitle: pinnedMessageCaption(pin),
            onPress: () => onJumpToPinnedMessage(pin),
          })),
        }
      : null;
  const menus = [pinsMenu, gitMenu, terminalMenu].filter(
    (menu): menu is AppBarMenu => menu !== null,
  );

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
