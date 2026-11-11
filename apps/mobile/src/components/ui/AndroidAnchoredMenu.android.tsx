import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import type { ReactNode } from "react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type { StyleProp, ViewInstance, ViewStyle } from "react-native";
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
  readonly accessibilityLabel?: string;
  readonly title?: string;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
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
          accessibilityLabel={props.accessibilityLabel}
          className={props.className}
          collapsable={false}
          style={props.style}
          onPress={open}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden={Boolean(props.accessibilityLabel)}
            importantForAccessibility={props.accessibilityLabel ? "no-hide-descendants" : "auto"}
          >
            {props.children}
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
