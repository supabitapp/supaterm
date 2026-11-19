import { Toolbar } from "../../../components/ui/Toolbar";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../../native/native-glass";
import { useDeviceType } from "../../../native/native-layout-metrics";
import { dispatchHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import type { WorkspaceFilterMenu } from "./workspace-filter-menu";
import { workspaceFilterToolbarMenu } from "./WorkspaceFilterToolbarMenu.ios";

export function WorkspaceHeaderActions(props: { readonly filterMenu?: WorkspaceFilterMenu }) {
  const deviceType = useDeviceType();
  // iPad and the Duo take these from WorkspaceToolbar's trailing items.
  if (deviceType !== "phone") return null;

  return (
    <Toolbar placement="right">
      {props.filterMenu ? workspaceFilterToolbarMenu(props.filterMenu) : null}
      {NATIVE_LIQUID_GLASS_SUPPORTED ? null : (
        <Toolbar.Button
          accessibilityLabel="Focus search"
          icon="magnifyingglass"
          onPress={() => dispatchHardwareKeyboardCommand("focusSearch")}
        />
      )}
    </Toolbar>
  );
}
