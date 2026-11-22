import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type {
  AccessibilityProps,
  PressableProps,
  StyleProp,
  ViewInstance,
  ViewStyle,
} from "react-native";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { MotionPresence } from "./MotionPresence";

import {
  deriveMenuHorizontalPlacement,
  deriveMenuVerticalPlacement,
} from "../../lib/menu-placement";
import { WindowHingeContext } from "../../native/window-hinge-context";
import { OverlayPortal } from "./OverlayPortal";
import { useAndroidControlSizing } from "./useAndroidControlSizing";
import { MenuPopup } from "./MenuPopup";

const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 6;

// Freeze both snapshots at opening so keyboard and screen reflows cannot flip menu direction.
type AnchorSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly keyboardWasVisible: boolean;
};

type OverlayFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type AndroidAnchoredMenuProps = {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
  readonly accessibilityLabel?: AccessibilityProps["accessibilityLabel"];
  readonly accessibilityHint?: AccessibilityProps["accessibilityHint"];
  readonly accessibilityState?: AccessibilityProps["accessibilityState"];
  readonly hitSlop?: PressableProps["hitSlop"];
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode | ((open: () => void) => ReactNode);
};

function AnchorChildren(props: {
  readonly render: (open: () => void) => ReactNode;
  readonly open: () => void;
}) {
  return props.render(props.open);
}

type TriggerAccessibilityProps = {
  readonly accessible?: boolean;
  readonly accessibilityRole?: AccessibilityProps["accessibilityRole"];
  readonly accessibilityLabel?: AccessibilityProps["accessibilityLabel"];
  readonly accessibilityHint?: AccessibilityProps["accessibilityHint"];
  readonly accessibilityState?: AccessibilityProps["accessibilityState"];
  readonly importantForAccessibility?: AccessibilityProps["importantForAccessibility"];
  readonly hitSlop?: PressableProps["hitSlop"];
  readonly disabled?: boolean;
  readonly children?: ReactNode;
};

function stripTriggerAccessibility(node: ReactNode, depth = 0): ReactNode {
  if (depth >= 3) return node;
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((child) => {
      const stripped = stripTriggerAccessibility(child, depth);
      if (stripped !== child) changed = true;
      return stripped;
    });
    return changed ? next : node;
  }
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<TriggerAccessibilityProps>;
  const { accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState } =
    element.props;
  if (
    accessibilityRole !== undefined ||
    accessibilityLabel !== undefined ||
    accessibilityHint !== undefined ||
    accessibilityState !== undefined
  ) {
    return cloneElement(element, {
      accessible: false,
      accessibilityRole: undefined,
      accessibilityLabel: undefined,
      accessibilityHint: undefined,
      accessibilityState: undefined,
      importantForAccessibility: "no-hide-descendants",
    });
  }
  if (element.props.children !== undefined) {
    const nextChild = stripTriggerAccessibility(element.props.children, depth + 1);
    if (nextChild !== element.props.children) {
      return cloneElement(element, undefined, nextChild);
    }
  }
  return node;
}

function extractTriggerAccessibility(
  node: ReactNode,
  depth = 0,
  acc: {
    accessibilityLabel?: AccessibilityProps["accessibilityLabel"];
    accessibilityHint?: AccessibilityProps["accessibilityHint"];
    accessibilityState?: AccessibilityProps["accessibilityState"];
    hitSlop?: PressableProps["hitSlop"];
  } = {},
): TriggerAccessibilityProps {
  if (depth >= 3) return acc;
  if (Array.isArray(node)) {
    for (const child of node) {
      extractTriggerAccessibility(child, depth, acc);
    }
    return acc;
  }
  if (!isValidElement(node)) return acc;
  const element = node as ReactElement<TriggerAccessibilityProps>;
  const { accessibilityLabel, accessibilityHint, accessibilityState, hitSlop, disabled } =
    element.props;
  if (acc.accessibilityLabel === undefined && accessibilityLabel !== undefined) {
    acc.accessibilityLabel = accessibilityLabel;
  }
  if (acc.accessibilityHint === undefined && accessibilityHint !== undefined) {
    acc.accessibilityHint = accessibilityHint;
  }
  if (acc.accessibilityState === undefined) {
    const nextState = accessibilityState ?? (disabled !== undefined ? { disabled } : undefined);
    if (nextState !== undefined) acc.accessibilityState = nextState;
  }
  if (acc.hitSlop === undefined && hitSlop !== undefined) {
    acc.hitSlop = hitSlop;
  }
  if (
    acc.accessibilityLabel !== undefined &&
    acc.accessibilityHint !== undefined &&
    acc.accessibilityState !== undefined &&
    acc.hitSlop !== undefined
  ) {
    return acc;
  }
  if (element.props.children !== undefined) {
    extractTriggerAccessibility(element.props.children, depth + 1, acc);
  }
  return acc;
}

export function AndroidAnchoredMenu(props: AndroidAnchoredMenuProps) {
  const { scale, menuWidth: desiredMenuWidth, menuItemHeight } = useAndroidControlSizing();
  const [anchor, setAnchor] = useState<AnchorSnapshot | null>(null);
  const [closing, setClosing] = useState(false);
  const [path, setPath] = useState<readonly MenuAction[]>([]);
  const [overlay, setOverlay] = useState<OverlayFrame | null>(null);
  const windowHinge = use(WindowHingeContext);
  const anchorRef = useRef<ViewInstance>(null);
  const overlayRef = useRef<ViewInstance>(null);

  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const keyboardHeight = useKeyboardState((state) => state.height);
  const reset = useCallback(() => {
    setAnchor(null);
    setPath([]);
    setOverlay(null);
    setClosing(false);
  }, []);
  const close = useCallback(() => {
    if (anchor?.keyboardWasVisible) setClosing(true);
    else reset();
  }, [anchor, reset]);
  // The in-window menu is pinned to the trigger's spot above the keyboard, which is stale once it hides.
  if (anchor?.keyboardWasVisible === true && !keyboardVisible) {
    reset();
  }

  const open = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setClosing(false);
      setAnchor({ x, y, width, height, keyboardWasVisible: keyboardVisible });
    });
  }, [keyboardVisible]);

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlay({ x, y, width, height });
    });
  }, []);

  const submenuDepth = path.length;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to Android hardware back to pop a submenu or close a menu opened over the keyboard
  useEffect(() => {
    if (anchor === null || !anchor.keyboardWasVisible) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (submenuDepth > 0) {
        setPath((current) => current.slice(0, -1));
      } else {
        close();
      }
      return true;
    });
    return () => subscription.remove();
  }, [anchor, close, submenuDepth]);

  const parent = path[path.length - 1] ?? null;
  const levelActions = (parent?.subactions ?? props.actions).filter(
    (action) => !(action.attributes?.hidden ?? false),
  );

  const local =
    anchor === null || overlay === null
      ? null
      : {
          x: anchor.x - overlay.x,
          y: anchor.y - overlay.y,
          width: anchor.width,
          height: anchor.height,
        };
  const { left, width: menuWidth } =
    local === null || overlay === null
      ? { left: 0, width: desiredMenuWidth }
      : deriveMenuHorizontalPlacement({
          anchorX: local.x,
          anchorWidth: local.width,
          overlayWidth: overlay.width,
          desiredWidth: desiredMenuWidth,
          margin: SCREEN_MARGIN,
          hinge: windowHinge && { x: windowHinge.x - overlay.x, width: windowHinge.width },
        });
  const verticalPlacement =
    local === null || overlay === null
      ? null
      : deriveMenuVerticalPlacement({
          anchorY: local.y,
          anchorHeight: local.height,
          overlayHeight: overlay.height,
          // This in-window menu preserves keyboard focus; subtract the IME area so its items remain tappable.
          keyboardInset: keyboardVisible ? keyboardHeight : 0,
          gap: ANCHOR_GAP,
          margin: SCREEN_MARGIN,
          minHeight: 2 * menuItemHeight + 14 * scale,
        });
  const opensDown = verticalPlacement === null || "top" in verticalPlacement;

  const { onPressAction } = props;
  const onPressItem = useCallback(
    (action: MenuAction) => {
      if ((action.subactions?.length ?? 0) > 0) {
        setPath((current) => [...current, action]);
        return;
      }
      close();
      if (action.id !== undefined) {
        onPressAction?.({
          nativeEvent: { event: action.id },
        } as Parameters<NonNullable<MenuComponentProps["onPressAction"]>>[0]);
      }
    },
    [close, onPressAction],
  );

  const triggerAccessibility =
    typeof props.children === "function" ? {} : extractTriggerAccessibility(props.children);
  const triggerLabel =
    props.accessibilityLabel ?? triggerAccessibility.accessibilityLabel ?? props.title;
  const triggerHint = props.accessibilityHint ?? triggerAccessibility.accessibilityHint;
  const triggerState = props.accessibilityState ?? triggerAccessibility.accessibilityState;
  const triggerHitSlop = props.hitSlop ?? triggerAccessibility.hitSlop;

  return (
    <>
      {typeof props.children === "function" ? (
        <View ref={anchorRef} collapsable={false} className={props.className} style={props.style}>
          <AnchorChildren render={props.children} open={open} />
        </View>
      ) : (
        <Pressable
          ref={anchorRef}
          accessibilityRole="button"
          accessibilityLabel={triggerLabel}
          accessibilityHint={triggerHint}
          accessibilityState={triggerState}
          hitSlop={triggerHitSlop}
          className={props.className}
          collapsable={false}
          style={props.style}
          onPress={open}
        >
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {stripTriggerAccessibility(props.children)}
          </View>
        </Pressable>
      )}
      {anchor === null ? null : (
        <OverlayPortal>
          <View
            ref={overlayRef}
            collapsable={false}
            className="absolute inset-0"
            pointerEvents={closing ? "none" : "auto"}
            onLayout={measureOverlay}
          >
            <Pressable accessible={false} className="absolute inset-0" onPress={close} />
            {local === null ? null : !anchor.keyboardWasVisible ? (
              <MenuPopup
                // Compose aligns to the trigger's start if it fits; hinge-safe triggers keep menus on their side.
                anchor={windowHinge ? { ...local, x: left, width: menuWidth } : local}
                menuWidth={menuWidth}
                actions={levelActions}
                title={props.title}
                parent={parent}
                onPress={onPressItem}
                onBack={() => setPath((current) => current.slice(0, -1))}
                onClose={close}
              />
            ) : (
              <MotionPresence
                visible={!closing}
                appear
                offsetY={opensDown ? -4 : 4}
                onHidden={reset}
                className="absolute overflow-hidden bg-card-alt shadow-md"
                style={{
                  left,
                  width: menuWidth,
                  borderRadius: 4 * scale,
                  ...verticalPlacement,
                }}
              >
                {/* Compose DropdownMenu takes focus; in-window editor menus preserve the keyboard. */}

                {/* The first item tap must act while the keyboard is open. */}
                <ScrollView
                  contentContainerStyle={{ paddingVertical: 7 * scale }}
                  bounces={false}
                  keyboardShouldPersistTaps="always"
                  showsVerticalScrollIndicator={false}
                >
                  <MenuPopup
                    inline
                    anchor={local}
                    menuWidth={menuWidth}
                    actions={levelActions}
                    title={props.title}
                    parent={parent}
                    onPress={onPressItem}
                    onBack={() => setPath((current) => current.slice(0, -1))}
                    onClose={close}
                  />
                </ScrollView>
              </MotionPresence>
            )}
          </View>
        </OverlayPortal>
      )}
    </>
  );
}
