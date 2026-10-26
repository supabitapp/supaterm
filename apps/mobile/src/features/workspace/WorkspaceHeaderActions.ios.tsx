import { Toolbar } from "../../components/ui/Toolbar";
import { useNavigation, type ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { dispatchHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import type { WorkspaceFilterMenu } from "./workspace-filter-menu";

function invokeFilterAction(menu: WorkspaceFilterMenu, id: string | undefined) {
  menu.onPressAction({ nativeEvent: { event: id ?? "" } });
}

export function WorkspaceHeaderActions(props: { readonly filterMenu?: WorkspaceFilterMenu }) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const filterMenu = props.filterMenu;
  const filterIcon = filterMenu?.customized
    ? "line.3.horizontal.decrease.circle.fill"
    : "line.3.horizontal.decrease.circle";

  return (
    <Toolbar placement="right">
      <Toolbar.Button
        accessibilityLabel="Settings"
        icon="gearshape"
        onPress={() =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: "Settings" },
          })
        }
      />
      {filterMenu ? (
        <Toolbar.Menu accessibilityLabel={filterMenu.accessibilityLabel} icon={filterIcon}>
          {filterMenu.actions.map((action) =>
            action.subactions ? (
              <Toolbar.Menu
                key={action.id ?? action.title}
                title={action.title}
                inline={action.displayInline}
              >
                {action.subactions.map((subaction) => (
                  <Toolbar.MenuAction
                    key={subaction.id ?? subaction.title}
                    disabled={subaction.attributes?.disabled}
                    destructive={subaction.attributes?.destructive}
                    isOn={subaction.state === "on"}
                    subtitle={subaction.subtitle}
                    onPress={() => invokeFilterAction(filterMenu, subaction.id)}
                  >
                    {subaction.title}
                  </Toolbar.MenuAction>
                ))}
              </Toolbar.Menu>
            ) : (
              <Toolbar.MenuAction
                key={action.id ?? action.title}
                disabled={action.attributes?.disabled}
                destructive={action.attributes?.destructive}
                isOn={action.state === "on"}
                subtitle={action.subtitle}
                onPress={() => invokeFilterAction(filterMenu, action.id)}
              >
                {action.title}
              </Toolbar.MenuAction>
            ),
          )}
        </Toolbar.Menu>
      ) : null}
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
