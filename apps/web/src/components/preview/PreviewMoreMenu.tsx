import type { DesktopPreviewColorScheme, KeybindingCommand } from "@supaterm/contracts";
import { EllipsisVerticalIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "@supaterm/icons";
import { useId, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuDescription,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useShortcutLabel } from "~/hooks/useShortcutLabel";
import { PREVIEW_FOCUS_SHORTCUT_OPTIONS } from "~/lib/previewFocus";

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{
  value: DesktopPreviewColorScheme;
  label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ZoomButton({
  label,
  command,
  variant,
  disabled,
  onClick,
  children,
}: {
  label: string;
  command: KeybindingCommand;
  variant: "outline" | "ghost";
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const shortcut = useShortcutLabel(command, PREVIEW_FOCUS_SHORTCUT_OPTIONS);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-xs"
            type="button"
            onClick={onClick}
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup shortcut={shortcut}>{label}</TooltipPopup>
    </Tooltip>
  );
}

export interface PreviewMoreMenuActions {
  readonly hardReload: () => void;
  readonly setColorScheme: (colorScheme: DesktopPreviewColorScheme) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoom: () => void;
  readonly clearCookies: () => void;
  readonly clearCache: () => void;
  readonly openDevTools?: () => void;
  readonly toggleNativePictureInPicture?: () => void;
}

interface Props {
  enabled: boolean;
  actions: PreviewMoreMenuActions;
  zoomFactor: number;
  colorScheme: DesktopPreviewColorScheme;
  deviceToolbarVisible: boolean;
  onToggleDeviceToolbar: () => void;
  nativePictureInPicture: boolean;
  profileName: string | undefined;

  move?: { readonly label: string; readonly onMove: () => void };
}

const MenuTriggerButton = () => (
  <Tooltip>
    <TooltipTrigger
      render={
        <MenuTrigger
          render={<Button variant="ghost" size="icon-xs" type="button" aria-label="Preview menu" />}
        />
      }
    >
      <EllipsisVerticalIcon />
    </TooltipTrigger>
    <TooltipPopup>More</TooltipPopup>
  </Tooltip>
);

export function PreviewMoreMenu({
  enabled,
  actions,
  zoomFactor,
  colorScheme,
  deviceToolbarVisible,
  onToggleDeviceToolbar,
  nativePictureInPicture,
  profileName,
  move,
}: Props) {
  const confirm = useInlineConfirm<"cookies" | "cache">();
  const cookiesHintId = useId();
  const zoomLabel = `${Math.round(zoomFactor * 100)}%`;
  const disabled = !enabled;
  return (
    <Menu>
      <MenuTriggerButton />
      <MenuPopup align="end" sideOffset={6}>
        <MenuItem onClick={actions.hardReload} disabled={disabled}>
          Hard reload
        </MenuItem>
        {actions.openDevTools ? (
          <MenuItem onClick={actions.openDevTools} disabled={disabled}>
            Open DevTools
          </MenuItem>
        ) : null}
        {actions.toggleNativePictureInPicture ? (
          <MenuItem onClick={actions.toggleNativePictureInPicture} disabled={disabled}>
            {nativePictureInPicture
              ? "Close separate preview window"
              : "Open separate preview window"}
          </MenuItem>
        ) : null}
        {move ? <MenuItem onClick={move.onMove}>{move.label}</MenuItem> : null}
        <MenuItem onClick={onToggleDeviceToolbar} disabled={disabled}>
          {deviceToolbarVisible ? "Hide device toolbar" : "Show device toolbar"}
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={disabled}>Appearance</MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup
              value={colorScheme}
              onValueChange={(value) => actions.setColorScheme(value as DesktopPreviewColorScheme)}
            >
              {COLOR_SCHEME_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem
          closeOnClick={false}
          onClick={(event: React.MouseEvent) => event.preventDefault()}
          className="justify-between"
          disabled={disabled}
        >
          <span>Zoom</span>
          <span className="flex items-center gap-1">
            <ZoomButton
              label="Zoom out"
              command="preview.zoomOut"
              variant="outline"
              disabled={disabled}
              onClick={actions.zoomOut}
            >
              <MinusIcon />
            </ZoomButton>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {zoomLabel}
            </span>
            <ZoomButton
              label="Zoom in"
              command="preview.zoomIn"
              variant="outline"
              disabled={disabled}
              onClick={actions.zoomIn}
            >
              <PlusIcon />
            </ZoomButton>
            <ZoomButton
              label="Reset zoom"
              command="preview.resetZoom"
              variant="ghost"
              disabled={disabled}
              onClick={actions.resetZoom}
            >
              <RotateCcwIcon />
            </ZoomButton>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          {profileName ? (
            <MenuGroupLabel className="max-w-64">
              <span className="block truncate">Profile: {profileName}</span>
            </MenuGroupLabel>
          ) : null}
          <MenuItem
            disabled={disabled}
            {...confirm.bind("cookies", actions.clearCookies)}
            aria-describedby={confirm.armed === "cookies" ? cookiesHintId : undefined}
          >
            {confirm.armed === "cookies" ? "Confirm clear" : "Clear cookies"}
          </MenuItem>
          {confirm.armed === "cookies" ? (
            <MenuDescription id={cookiesHintId}>
              Signs you out of every site in this profile.
            </MenuDescription>
          ) : null}
          <MenuItem disabled={disabled} {...confirm.bind("cache", actions.clearCache)}>
            {confirm.armed === "cache" ? "Confirm clear" : "Clear cache"}
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
