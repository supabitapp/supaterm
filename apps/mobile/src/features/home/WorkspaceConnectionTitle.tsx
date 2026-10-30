import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  brandTitleOffset,
  CompactBrandTitle,
  getCompactBrandHeaderOptions,
} from "../../components/CompactBrandTitle";
import { useWorkspaceState } from "../../state/workspace";
import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";
import { useConnectionStatusVisibility } from "../../connection/useConnectionStatusVisibility";
import {
  workspaceConnectionStatusPresentation,
  type WorkspaceConnectionStatusPresentation,
} from "./workspace-connection-status";

const FADE_IN_MS = 250;

function useDelayedConnectionStatus(): WorkspaceConnectionStatusPresentation | null {
  const { state } = useWorkspaceState();
  const presentation = workspaceConnectionStatusPresentation(state);
  const visible = useConnectionStatusVisibility(
    "workspace",
    presentation !== null,
    state.connectionState === "error" || state.connectionState === "unsupported",
  );

  return visible ? presentation : null;
}

/**
 * Deliberately JS-driven: this can mount inside a native header item
 * (RNSScreenStackHeaderSubview), where native-driver animated nodes blank the
 * re-hosted view entirely. The JS driver updates opacity through the ordinary
 * style path, which those subviews handle.
 */
function StatusFadeIn(props: { readonly children: ReactNode }) {
  const reducedMotion = useReducedMotionPreference();
  const [opacity] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const animation = Animated.timing(opacity, {
      duration: FADE_IN_MS,
      toValue: 1,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);

  return (
    <Animated.View style={{ alignItems: "center", flexDirection: "row", flexShrink: 1, opacity }}>
      {props.children}
    </Animated.View>
  );
}

/**
 * Keeps the thread-list title visible, with connection status beneath it.
 * Both lines stay inside the header so reconnects never shift the list below.
 */
export function WorkspaceConnectionTitle(props: {
  /** Persistent brand lockup or screen title. */
  readonly brand: ReactNode;
  readonly onPress?: () => void;
  readonly grow?: boolean;
  readonly size?: "navbar" | "pageTitle";
  readonly statusOffset?: number;
  readonly maxWidth?: number;
}) {
  const status = useDelayedConnectionStatus();
  const size = props.size ?? "navbar";
  const { scale } = useAndroidControlSizing();

  return (
    <View
      style={[
        {
          alignItems: "flex-start",
          gap: 2 * scale,
          justifyContent: "center",
          maxWidth: props.maxWidth,
          minHeight: 44 * scale,
          minWidth: 0,
        },
        props.grow ? { flex: 1 } : null,
      ]}
    >
      {props.brand}
      {status !== null ? (
        <StatusFadeIn>
          <Pressable
            accessibilityHint="Opens environment settings"
            accessibilityLabel={status.label}
            accessibilityRole="button"
            disabled={props.onPress === undefined}
            hitSlop={8}
            onPress={props.onPress}
            className="flex-row items-center"
            style={{ flexShrink: 1, marginLeft: props.statusOffset ?? 0 }}
          >
            <Text
              className="text-foreground-muted"
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontSize: (size === "pageTitle" ? 13 : 12) * scale,
                lineHeight: 16 * scale,
              }}
            >
              {status.label}
            </Text>
          </Pressable>
        </StatusFadeIn>
      ) : null}
    </View>
  );
}

/**
 * getCompactBrandHeaderOptions with the brand slot upgraded to the
 * connection subtitle. Screens with an environment-settings callback apply
 * this over the static brand options at mount.
 */
export function getConnectionAwareBrandHeaderOptions(opts: {
  readonly headerWidth: number;
  readonly trailingItemCount?: number;
  readonly onOpenEnvironments: () => void;
  readonly fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"];
}): NativeStackNavigationOptions {
  const maxWidth = Math.max(0, opts.headerWidth - 64 - 44 * (opts.trailingItemCount ?? 1));

  return {
    ...getCompactBrandHeaderOptions(opts.fallbackTitleStyle),
    headerTitle: () => (
      <WorkspaceConnectionTitle
        brand={<CompactBrandTitle />}
        maxWidth={maxWidth}
        onPress={opts.onOpenEnvironments}
        statusOffset={brandTitleOffset()}
      />
    ),
  };
}
