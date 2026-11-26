import type { DeviceHostSummary, DevicePlatform } from "@supaterm/contracts";
import {
  BoxIcon,
  CameraIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  HouseIcon,
  KeyboardIcon,
  MaximizeIcon,
  PictureInPictureIcon,
  PowerIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SquareIcon,
  TypeIcon,
  XIcon,
  MoonIcon,
  SunIcon,
} from "@supaterm/icons";

import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import type { DeviceStreamHandle, DeviceViewControls } from "./DeviceStreamView";
import type { DeviceControls } from "./useDeviceControls";
import { T, msg, useGT } from "gt-react";

export function DeviceControlsRail(props: {
  platform: DevicePlatform;
  hostKind: DeviceHostSummary["kind"] | undefined;
  handle: DeviceStreamHandle | null;
  view: DeviceViewControls;
  controls: DeviceControls;
  screenshotPending: boolean;
  onScreenshot: () => void;
  toolsOpen: boolean;
  onTools: () => void;
  onFloat: () => void;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const gt = useGT();
  const { view, handle, controls } = props;
  const confirm = useInlineConfirm<"power-off">();
  const popupSide = "left";
  const settings = controls.detail?.settings;
  const inputDisabled = !handle?.inputConnected;
  const runsHostCommands = props.hostKind === "local" || props.hostKind === "ssh";
  const nextAppearance = settings?.appearance === "dark" ? "light" : "dark";
  const Icon = settings?.appearance === "dark" ? SunIcon : MoonIcon;
  return (
    <aside
      aria-label={gt("Device controls")}
      data-layout="rail"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-14 flex-col items-center gap-2 overflow-y-auto [justify-content:safe_center] py-3 pr-2 [scrollbar-width:none]"
    >
      <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-full border border-border/50 bg-background/80 p-2 shadow-sm [scrollbar-width:none]">
        <RailButton
          tooltipSide={popupSide}
          label={gt("Home", { $context: "device home button" })}
          disabled={inputDisabled}
          onClick={() => handle?.pressButton("home")}
        >
          <HouseIcon />
        </RailButton>
        {props.platform === "android" ? (
          <>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Back", { $context: "device back button" })}
              disabled={inputDisabled}
              onClick={() => handle?.pressButton("back")}
            >
              <ChevronLeftIcon />
            </RailButton>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Recents", { $context: "Android recent apps button" })}
              disabled={inputDisabled}
              onClick={() => handle?.pressButton("recents")}
            >
              <SquareIcon />
            </RailButton>
            {runsHostCommands ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={gt("Rotate device")}
                      disabled={controls.disabled}
                    />
                  }
                >
                  <RotateCcwIcon />
                </MenuTrigger>
                <MenuPopup side={popupSide}>
                  <MenuItem
                    onClick={() => void controls.act({ type: "setOrientation", value: "portrait" })}
                  >
                    <T>Portrait</T>
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void controls.act({ type: "setOrientation", value: "landscape_left" })
                    }
                  >
                    <T>Landscape</T>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : null}
          </>
        ) : (
          <RailButton
            tooltipSide={popupSide}
            label={gt("Rotate device")}
            disabled={inputDisabled || !!view.keyboard?.attached}
            onClick={() => handle?.rotate()}
          >
            <RotateCcwIcon />
          </RailButton>
        )}
        {runsHostCommands ? (
          <>
            <RailDivider />
            <RailButton
              tooltipSide={popupSide}
              label={
                nextAppearance === "light"
                  ? gt("Switch device to light mode")
                  : gt("Switch device to dark mode")
              }
              disabled={controls.disabled || !settings?.appearance}
              onClick={() => void controls.act({ type: "setAppearance", value: nextAppearance })}
            >
              <Icon />
            </RailButton>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={gt("Device text size")}
                    title={gt("Device text size")}
                    disabled={controls.disabled || !settings?.textSize}
                  />
                }
              >
                <TypeIcon />
              </MenuTrigger>
              <MenuPopup side={popupSide} className="min-w-40">
                <MenuRadioGroup
                  value={settings?.textSize ?? ""}
                  onValueChange={(value) => {
                    if (
                      value === "small" ||
                      value === "default" ||
                      value === "large" ||
                      value === "extra-large"
                    )
                      void controls.act({ type: "setTextSize", value });
                  }}
                >
                  {(
                    [
                      ["small", msg("Small")],
                      ["default", msg("Default")],
                      ["large", msg("Large")],
                      ["extra-large", msg("Extra large")],
                    ] as const
                  ).map(([value, label]) => (
                    <MenuRadioItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <span className="flex-1">{label}</span>
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Device tools")}
              pressed={props.toolsOpen}
              onClick={props.onTools}
            >
              <SlidersHorizontalIcon />
            </RailButton>
          </>
        ) : null}
        <RailButton
          tooltipSide={popupSide}
          label={props.screenshotPending ? gt("Capturing screenshot") : gt("Save screenshot")}
          disabled={!view.streaming || props.screenshotPending}
          onClick={props.onScreenshot}
        >
          <CameraIcon />
        </RailButton>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("More device actions")}
                title={gt("More device actions")}
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup side={popupSide} align="end">
            <MenuItem onClick={props.onFloat}>
              <PictureInPictureIcon />
              <T>Float device over chat</T>
            </MenuItem>
            <MenuItem onClick={props.onClose}>
              <XIcon />
              <T>Close device panel</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" {...confirm.bind("power-off", props.onPowerOff)}>
              <PowerIcon />
              {confirm.armed === "power-off" ? gt("Confirm power off") : gt("Power off device")}
            </MenuItem>
          </MenuPopup>
        </Menu>
        <RailDivider />
        <RailButton
          tooltipSide={popupSide}
          label={gt("3D view")}
          pressed={view.phone}
          disabled={!view.streaming || !!view.phoneUnavailableReason}
          description={view.phoneUnavailableReason ?? undefined}
          onClick={view.showPhone}
        >
          <BoxIcon />
        </RailButton>
        <RailButton
          tooltipSide={popupSide}
          label={gt("Flat view")}
          pressed={!view.phone}
          disabled={!view.streaming}
          onClick={view.showFlat}
        >
          <SmartphoneIcon />
        </RailButton>
        {view.keyboard ? (
          <RailButton
            tooltipSide={popupSide}
            label={
              view.keyboard.attached ? gt("Detach Magic Keyboard") : gt("Attach Magic Keyboard")
            }
            pressed={view.keyboard.attached}
            onClick={view.keyboard.toggle}
          >
            <KeyboardIcon />
          </RailButton>
        ) : null}
        {view.phone ? (
          <RailButton
            tooltipSide={popupSide}
            label={gt("Restore 3D view")}
            onClick={view.resetView}
          >
            <MaximizeIcon />
          </RailButton>
        ) : null}
      </div>
      {view.foldingControls}
    </aside>
  );
}

function RailDivider() {
  return <div aria-hidden className="my-1 h-px w-5 shrink-0 bg-border/70" />;
}

function RailButton(props: {
  tooltipSide: "left" | "bottom";
  label: string;
  description?: string | undefined;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      size="icon-sm"
      variant={props.pressed ? "secondary" : "ghost"}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
  return (
    <Tooltip>
      {props.disabled && props.description ? (
        <TooltipTrigger
          render={
            <span className="inline-flex" tabIndex={0} role="group" aria-label={props.label} />
          }
        >
          {button}
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={button} />
      )}
      <TooltipPopup side={props.tooltipSide}>{props.description ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}
