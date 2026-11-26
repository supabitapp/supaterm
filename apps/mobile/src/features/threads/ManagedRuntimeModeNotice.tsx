import type { ManagedPolicySummary, RuntimeMode } from "@supaterm/contracts";
import { useGT, useMessages } from "gt-react-native";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import {
  updateComposerDraftSettings,
  useComposerDraftSettings,
} from "../../state/use-composer-drafts";
import { managedRuntimeModeSwitch } from "./thread-settings-options";

/** Switching sets the draft's mode, which the next send applies first. */
export function ManagedRuntimeModeNotice(props: {
  readonly threadKey: string;
  readonly threadRuntimeMode: RuntimeMode;
  readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
  readonly policy: ManagedPolicySummary | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const draftSettings = useComposerDraftSettings(props.threadKey);
  const blocked = managedRuntimeModeSwitch(
    props.policy,
    draftSettings.runtimeMode ?? props.threadRuntimeMode,
    props.supportedRuntimeModes,
    messages,
  );
  if (blocked === undefined) return null;
  const { denial, target } = blocked;
  return (
    <View className="gap-2 px-4 pb-3">
      <AppText textRole="footnote" className="text-foreground-muted">
        {gt("{denial} Switch this thread's mode to continue.", { denial })}
      </AppText>
      {target === undefined ? null : (
        <Button
          label={gt("Switch to {mode}", { mode: messages(target.label) })}
          onPress={() => updateComposerDraftSettings(props.threadKey, { runtimeMode: target.mode })}
        />
      )}
    </View>
  );
}
