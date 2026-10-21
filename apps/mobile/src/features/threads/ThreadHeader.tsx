import { useMemo } from "react";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";

import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, panes, toggleAuxiliaryPane, composerKeyboardActive } =
    useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderMenu = useMemo<AppBarMenu>(() => {
    const items: AppBarMenuItem[] = [];
    if (props.hasWorkspaceRoot) {
      items.push({
        id: "thread-terminal",
        title: "Terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      items.push({
        id: "thread-files",
        title: filesVisible ? "Close files" : "Files",
        selected: filesVisible,
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    items.push({
      id: "thread-git",
      title: "Git",
      onPress: props.onOpenGitInspector,
    });
    if (onMergeBack) {
      items.push({
        id: "thread-merge-back",
        title: "Merge back to source",
        onPress: onMergeBack,
      });
    }
    return { title: "More actions", icon: "ellipsis", items };
  }, [
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onOpenTerminal,
    onMergeBack,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
  ]);

  return (
    <>
      <AppBar
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? "Hide inspector"
                  : "Show inspector"
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={layout.usesSplitView ? undefined : goBack}
        actions={
          props.onReturnToThread
            ? [
                {
                  accessibilityLabel: "Return to chat",
                  icon: "chevron.left",
                  onPress: props.onReturnToThread,
                },
              ]
            : undefined
        }
        menus={[androidHeaderMenu]}
        hideBottomBorder
        compact={composerKeyboardActive}
      />
      {native.fallback}
    </>
  );
}
