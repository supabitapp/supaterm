import type { ReactNode } from "react";
import { PreviewPanelInline } from "../preview/PreviewPanelLayout";
import { RightPanelSheet } from "../RightPanelSheet";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";

type ChatRightPanelProps = Omit<RightPanelTabsProps, "mode" | "maximized" | "layoutControls"> & {
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly layoutControls: ReactNode;
  readonly widthStorageKey: string;
  readonly sheetOpen: boolean;
  readonly sheetContainer: HTMLElement | null | undefined;
  readonly sheetAnimationDurationMs: number;
  readonly onClose: () => void;
};

/**
 * The right panel, inline beside the chat column or as a sheet on narrow
 * layouts. The inline panel must render as a direct child of the chat's
 * PreviewPanelGroup; the sheet renders outside it.
 */
export function ChatRightPanel(props: ChatRightPanelProps) {
  const {
    sheet,
    maximized,
    layoutControls,
    widthStorageKey,
    sheetOpen,
    sheetContainer,
    sheetAnimationDurationMs,
    onClose,
    ...tabs
  } = props;
  if (!sheet) {
    return (
      <PreviewPanelInline
        open={tabs.open === true}
        widthStorageKey={widthStorageKey}
        onCollapse={onClose}
      >
        <RightPanelTabs {...tabs} mode="inline" maximized={maximized} />
      </PreviewPanelInline>
    );
  }
  return (
    <RightPanelSheet
      animationDurationMs={sheetAnimationDurationMs}
      open={sheetOpen}
      onClose={onClose}
      container={sheetContainer}
    >
      <RightPanelTabs {...tabs} mode="sheet" layoutControls={layoutControls} />
    </RightPanelSheet>
  );
}
