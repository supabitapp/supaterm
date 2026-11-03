import {
  ColumnsIcon,
  EllipsisIcon,
  PanelRightIcon,
  RowsIcon,
  SquareMenuIcon,
  SquareTerminalIcon,
  XIcon,
} from "@supaterm/icons";

import { openThreadPickerBeside } from "../../chatPanes/actions";
import { useChatPaneStore } from "../../chatPanes/store";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import type { PanelLayoutControlsProps } from "../chat/PanelLayoutControls";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ChatPaneActionsMenu({
  paneId,
  paneClosable,
  showThreadPanelControl = true,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  threadPanelOpen,
  threadPanelShortcutLabel,
  threadPanelHasAttention = false,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  onToggleTerminal,
  onToggleThreadPanel,
  onToggleRightPanel,
}: PanelLayoutControlsProps & { readonly paneId: string; readonly paneClosable: boolean }) {
  const splitRightShortcut = useShortcutLabel("pane.splitRight");
  const splitDownShortcut = useShortcutLabel("pane.splitDown");
  const closeShortcut = useShortcutLabel("pane.close", { context: { paneClosable } });
  const attention = showThreadPanelControl && threadPanelHasAttention;
  return (
    <div
      className="flex h-full shrink-0 items-center [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    aria-label="Pane actions"
                    data-right-panel-toggle
                    size="icon-sm"
                    variant="ghost"
                  />
                }
              >
                <EllipsisIcon className="size-4" />
                {attention ? (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 size-1.5 rounded-full bg-warning ring-2 ring-background"
                  />
                ) : null}
              </MenuTrigger>
            }
          />
          <TooltipPopup side="bottom">Pane actions</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="bottom">
          <MenuItem onClick={() => openThreadPickerBeside("right")}>
            <ColumnsIcon />
            Split right
            {splitRightShortcut ? <MenuShortcut>{splitRightShortcut}</MenuShortcut> : null}
          </MenuItem>
          <MenuItem onClick={() => openThreadPickerBeside("bottom")}>
            <RowsIcon />
            Split down
            {splitDownShortcut ? <MenuShortcut>{splitDownShortcut}</MenuShortcut> : null}
          </MenuItem>
          <MenuItem onClick={() => useChatPaneStore.getState().close(paneId)}>
            <XIcon />
            Close pane
            {closeShortcut ? <MenuShortcut>{closeShortcut}</MenuShortcut> : null}
          </MenuItem>
          <MenuSeparator />
          {showThreadPanelControl ? (
            <MenuItem onClick={onToggleThreadPanel}>
              <SquareMenuIcon />
              {threadPanelOpen ? "Hide thread details" : "Show thread details"}
              {attention ? (
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
              ) : null}
              {threadPanelShortcutLabel ? (
                <MenuShortcut>{threadPanelShortcutLabel}</MenuShortcut>
              ) : null}
            </MenuItem>
          ) : null}
          <MenuItem disabled={!terminalAvailable} onClick={onToggleTerminal}>
            <SquareTerminalIcon />
            {terminalOpen ? "Hide terminal" : "Show terminal"}
            {terminalAvailable && terminalShortcutLabel ? (
              <MenuShortcut>{terminalShortcutLabel}</MenuShortcut>
            ) : null}
          </MenuItem>
          <MenuItem disabled={!rightPanelAvailable} onClick={onToggleRightPanel}>
            <PanelRightIcon />
            {rightPanelOpen ? "Hide right panel" : "Show right panel"}
            {rightPanelAvailable && rightPanelShortcutLabel ? (
              <MenuShortcut>{rightPanelShortcutLabel}</MenuShortcut>
            ) : null}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
