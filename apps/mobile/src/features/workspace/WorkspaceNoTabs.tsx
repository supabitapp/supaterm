import { useAtomSet } from "@effect/atom-react";
import { View } from "react-native";
import { EmptyState } from "../../components/ui/EmptyState";
import { updateMobilePreferencesAtom } from "../../state/preferences";

export function WorkspaceNoTabs() {
  const save = useAtomSet(updateMobilePreferencesAtom);
  return (
    <View className="flex-1 items-center justify-center bg-screen">
      <EmptyState
        title="All sections are hidden"
        detail="Show a section to add it back to navigation."
        actionLabel="Show all sections"
        variant="plain"
        onAction={() => save({ hiddenNavigationTabs: [] })}
      />
    </View>
  );
}
