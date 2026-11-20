import { RuntimeMode, type ResolvedKeybindingsConfig } from "@supaterm/contracts";
import { memo } from "react";
import { EllipsisIcon } from "@supaterm/icons";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { shortcutLabelForCommand } from "../../keybindings";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<{
    readonly mode: RuntimeMode;
    readonly label: string;
  }>;
  keybindings: ResolvedKeybindingsConfig;
  size?: "sm" | "xs";
  /** Close the portaled popup when its trigger hides. */
  hidden?: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const runtimeModeShortcut = shortcutLabelForCommand(props.keybindings, "composer.mode");

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0"
            aria-label="More composer controls"
            data-composer-shortcut="composer.mode"
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <div className="flex items-center gap-2 px-2 py-1.5 font-medium text-muted-foreground text-xs">
          Access
          {runtimeModeShortcut ? <MenuShortcut>{runtimeModeShortcut}</MenuShortcut> : null}
        </div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {props.runtimeModeOptions.map((option) => (
            <MenuRadioItem key={option.mode} value={option.mode}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
