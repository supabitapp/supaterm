import { useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  AndroidHeaderIconButton,
  AndroidHeaderOverflowMenu,
  type AndroidHeaderAction,
} from "../../components/ui/AndroidScreenHeader";
import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { fitAndroidHeaderActions } from "../../components/ui/headerMenu.android";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { WorkspaceConnectionTitle } from "../home/WorkspaceConnectionTitle";

/**
 * The Android header row above each workspace tab's list. Both tabs draw this same row, so
 * switching tabs leaves the title and buttons where they were.
 */
export function WorkspaceListToolbarRow(props: {
  readonly searching: boolean;
  readonly searchField: ReactNode;
  readonly onCloseSearch: () => void;
  readonly titleAccessibilityLabel?: string;
  readonly onOpenEnvironments: () => void;
  readonly actions: ReadonlyArray<AndroidHeaderAction>;
  /** Stays trailing while searching, so it never moves and still narrows the results. */
  readonly filter: ReactNode;
}) {
  const { height } = useToolbarLayout();
  const { buttonSize, scale } = useAndroidControlSizing();
  const [width, setWidth] = useState(0);
  const { visibleActions, overflowActions } = fitAndroidHeaderActions(props.actions, {
    width,
    buttonSize,
    gap: 4 * scale,
    reservedButtons: props.filter ? 1 : 0,
  });
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      className="flex-row items-center gap-1"
      style={{ minHeight: height }}
    >
      {props.searching ? (
        <>
          <AndroidHeaderIconButton
            accessibilityLabel="Close search"
            icon="arrow.left"
            onPress={props.onCloseSearch}
          />
          {props.searchField}
        </>
      ) : (
        <>
          <View className="min-w-0 flex-1 pl-4">
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironments}
              brand={
                <CompactBrandTitle
                  allowFontScaling={false}
                  accessibilityLabel={props.titleAccessibilityLabel}
                  fit
                />
              }
            />
          </View>
          {visibleActions.map((action) => (
            <AndroidHeaderIconButton
              key={action.accessibilityLabel}
              accessibilityLabel={action.accessibilityLabel}
              icon={action.icon}
              onPress={action.onPress}
            />
          ))}
          {overflowActions.length > 0 ? (
            <AndroidHeaderOverflowMenu actions={overflowActions} />
          ) : null}
        </>
      )}
      {props.filter}
    </View>
  );
}
