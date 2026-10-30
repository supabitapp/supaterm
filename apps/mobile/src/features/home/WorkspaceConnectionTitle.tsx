import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  brandTitleOffset,
  CompactBrandTitle,
  getCompactBrandHeaderOptions,
} from "../../components/CompactBrandTitle";
import { useConnectionStatusVisibility } from "../../connection/useConnectionStatusVisibility";
import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";
import { useWorkspaceState } from "../../state/workspace";
import {
  workspaceConnectionStatusPresentation,
  type WorkspaceConnectionStatusPresentation,
} from "./workspace-connection-status";

const FADE_IN_MS = 250;

type ConnectionStatus = WorkspaceConnectionStatusPresentation & {
  readonly fadeIn: boolean;
};

const ConnectionStatusContext = createContext<ConnectionStatus | null>(null);

export function WorkspaceConnectionStatusProvider(props: { readonly children: ReactNode }) {
  const { state } = useWorkspaceState();
  const presentation = workspaceConnectionStatusPresentation(state);
  const visible = useConnectionStatusVisibility(
    "workspace",
    presentation !== null,
    state.connectionState === "error" || state.connectionState === "unsupported",
  );
  const status = visible && presentation ? { ...presentation, fadeIn: false } : null;
  return <ConnectionStatusContext value={status}>{props.children}</ConnectionStatusContext>;
}

function StatusFadeIn(props: {
  readonly children: ReactNode;
  readonly animate: boolean;
  readonly grow?: boolean;
  readonly maxWidth?: number;
}) {
  const reducedMotion = useReducedMotionPreference();
  const animate = props.animate && !reducedMotion;
  const [opacity] = useState(() => new Animated.Value(0));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- runs the Animated opacity fade-in and stops it on cleanup
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(opacity, {
      duration: FADE_IN_MS,
      toValue: 1,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, opacity]);

  return (
    <Animated.View
      style={[
        {
          alignItems: "center",
          flexDirection: "row",
          maxWidth: props.maxWidth,

          opacity: animate ? opacity : 1,
        },
        props.grow ? { flex: 1, minWidth: 0 } : null,
      ]}
    >
      {props.children}
    </Animated.View>
  );
}

export function WorkspaceConnectionTitle(props: {
  readonly brand: ReactNode;
  readonly onPress?: () => void;
  readonly grow?: boolean;
  readonly size?: "navbar" | "pageTitle";
  readonly statusOffset?: number;
  readonly maxWidth?: number;
}) {
  const status = use(ConnectionStatusContext);
  const size = props.size ?? "navbar";
  const { scale } = useAndroidControlSizing();

  if (status === null) {
    return props.grow ? (
      <View style={{ alignItems: "center", flex: 1, flexDirection: "row", minWidth: 0 }}>
        {props.brand}
      </View>
    ) : (
      <>{props.brand}</>
    );
  }

  return (
    <StatusFadeIn animate={status.fadeIn} grow={props.grow} maxWidth={props.maxWidth}>
      <Pressable
        accessibilityHint="Opens environment settings"
        accessibilityLabel={status.label}
        accessibilityRole="button"
        disabled={props.onPress === undefined}
        hitSlop={8}
        onPress={props.onPress}
        className="flex-row items-center gap-2"
        style={[
          { flexShrink: 1, marginLeft: props.statusOffset ?? 0 },
          Platform.OS === "android" && { gap: 7 * scale },
        ]}
      >
        <SymbolView
          name="wifi.slash"
          size={Math.round((size === "pageTitle" ? 17 : 15) * scale)}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
        <Text numberOfLines={1} className="text-sm text-foreground-muted" style={{ flexShrink: 1 }}>
          {status.label}
        </Text>
      </Pressable>
    </StatusFadeIn>
  );
}

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
