import { getCodexMicroBridge } from "../codexMicroBridge";
import { useCodexMicroDeviceState } from "../codexMicroStore";
import { SettingsPageContainer } from "../../settings/settingsLayout";
import { CodexMicroConnectionSection } from "./CodexMicroConnectionSection";
import { CodexMicroLayoutSection } from "./CodexMicroLayoutSection";
import { CodexMicroOptionsSection } from "./CodexMicroOptionsSection";

export function CodexMicroSettings() {
  const state = useCodexMicroDeviceState();
  const bridge = getCodexMicroBridge();
  if (bridge === null) return null;

  return (
    <SettingsPageContainer>
      <CodexMicroConnectionSection bridge={bridge} state={state} />
      <CodexMicroLayoutSection state={state} />
      <CodexMicroOptionsSection />
    </SettingsPageContainer>
  );
}
