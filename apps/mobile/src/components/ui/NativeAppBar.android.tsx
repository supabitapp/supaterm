import { RNHostView, TopAppBar } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactElement } from "react";
import { NativeThemeHost } from "./NativeThemeHost.android";
import { useControlTheme } from "./useControlTheme";
import { useToolbarLayout } from "./useToolbarLayout";

/** Internal renderer. The surrounding screen owns status-bar and sheet insets. */
export function NativeAppBar(props: {
  readonly title: ReactElement;
  readonly navigationIcon?: ReactElement;
  readonly actions?: ReactElement;
  /** Compose nodes laid out by the bar itself, so they never wait on a React Native measure. */
  readonly nativeActions?: ReactElement;
  /** Shorter bar for a one-row title. */
  readonly singleLine?: boolean;
}) {
  const { colors } = useControlTheme();
  const layout = useToolbarLayout(false, props.singleLine);
  return (
    <NativeThemeHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
      <TopAppBar
        applyWindowInsets={false}
        modifiers={[fillMaxWidth(), height(Math.max(64, layout.height))]}
        colors={{
          containerColor: colors["--color-header"],
          titleContentColor: colors["--color-header-foreground"],
          navigationIconContentColor: colors["--color-header-foreground"],
          actionIconContentColor: colors["--color-header-foreground"],
        }}
      >
        <TopAppBar.Title>{props.title}</TopAppBar.Title>
        {props.navigationIcon ? (
          <TopAppBar.NavigationIcon>
            <RNHostView matchContents>{props.navigationIcon}</RNHostView>
          </TopAppBar.NavigationIcon>
        ) : null}
        {props.actions || props.nativeActions ? (
          <TopAppBar.Actions>
            {props.nativeActions}
            {props.actions ? <RNHostView matchContents>{props.actions}</RNHostView> : null}
          </TopAppBar.Actions>
        ) : null}
      </TopAppBar>
    </NativeThemeHost>
  );
}
