import {
  CODEX_MICRO_AGENT_KEYS,
  type ClientSettings,
  type CodexMicroCustomAgentKeys,
  type CodexMicroDeviceState,
  type CodexMicroLayout,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import * as Equal from "effect/Equal";
import { useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../../hooks/useSettings";
import { useThreadShells } from "../../../state/entities";
import { useCodexMicroSlots } from "../../codexMicro/codexMicroStore";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import { scrollToSettingsTarget, SettingsSection } from "../settingsLayout";
import { searchableSetting } from "../settingsSearch";
import { CodexMicroAgentKeyDialog } from "./CodexMicroAgentKeyDialog";
import { CodexMicroKeyboard } from "./CodexMicroKeyboard";
import { CodexMicroKeycapDialog } from "./CodexMicroKeycapDialog";
import { CodexMicroKnobDialog } from "./CodexMicroKnobDialog";
import {
  codexMicroAgentKeyView,
  codexMicroEncoderModeOption,
  codexMicroStatusLights,
  isCodexMicroAgentKey,
  resetCodexMicroLayout,
  type CodexMicroKeyId,
} from "./CodexMicroSettings.logic";
import { CodexMicroStickDialog } from "./CodexMicroStickDialog";
import { useCodexMicroPressedKey } from "./useCodexMicroPressedKey";

const selectLayoutSettings = (settings: ClientSettings) => ({
  enabled: settings.codexMicroEnabled,
  layout: settings.codexMicroLayout,
  agentSource: settings.codexMicroAgentSource,
  customAgentKeys: settings.codexMicroCustomAgentKeys,
});

const AGENT_KEYS_SETTING_ID = searchableSetting("codex-micro-agent-keys").id;

function KeyEditor({
  editing,
  layout,
  customAgentKeys,
  onLayoutChange,
  onCustomAgentKeysChange,
  onClose,
}: {
  editing: CodexMicroKeyId;
  layout: CodexMicroLayout;
  customAgentKeys: CodexMicroCustomAgentKeys;
  onLayoutChange: (layout: CodexMicroLayout) => void;
  onCustomAgentKeysChange: (customAgentKeys: CodexMicroCustomAgentKeys) => void;
  onClose: () => void;
}) {
  if (editing === "stick") {
    return <CodexMicroStickDialog layout={layout} onChange={onLayoutChange} onClose={onClose} />;
  }
  if (editing === "knob") {
    return <CodexMicroKnobDialog layout={layout} onChange={onLayoutChange} onClose={onClose} />;
  }
  if (isCodexMicroAgentKey(editing)) {
    return (
      <CodexMicroAgentKeyDialog
        agentKey={editing}
        assignment={customAgentKeys[editing]}
        onChange={(assignment) =>
          onCustomAgentKeysChange({ ...customAgentKeys, [editing]: assignment })
        }
        onClose={onClose}
      />
    );
  }
  return (
    <CodexMicroKeycapDialog
      slot={editing}
      layout={layout}
      onSave={onLayoutChange}
      onClose={onClose}
    />
  );
}

export function CodexMicroLayoutSection({ state }: { state: CodexMicroDeviceState | null }) {
  const settings = useClientSettings(selectLayoutSettings);
  const updateSettings = useUpdateClientSettings();
  const slots = useCodexMicroSlots();
  const pressedKey = useCodexMicroPressedKey(settings.layout.separateMicrophoneKeys);
  const customAssignments = settings.agentSource === "custom";
  const threads = useThreadShells(customAssignments);
  const [editing, setEditing] = useState<CodexMicroKeyId | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const threadTitles = new Map(
    threads.map((thread) => [
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread.title,
    ]),
  );
  const agentKeys = CODEX_MICRO_AGENT_KEYS.map((key) =>
    codexMicroAgentKeyView(
      key,
      slots.find((slot) => slot.key === key) ?? null,
      customAssignments ? settings.customAgentKeys[key] : undefined,
      threadTitles,
    ),
  );
  const resetLayout = resetCodexMicroLayout(settings.layout);
  const layoutIsDefault = Equal.equals(resetLayout, settings.layout);
  const saveLayout = (layout: CodexMicroLayout) => {
    void updateSettings({ codexMicroLayout: layout });
  };

  const select = (key: CodexMicroKeyId) => {
    if (isCodexMicroAgentKey(key) && !customAssignments) {
      scrollToSettingsTarget(AGENT_KEYS_SETTING_ID);
      return;
    }
    setEditing(key);
  };

  return (
    <SettingsSection
      {...searchableSetting("codex-micro-layout")}
      headerAction={
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={layoutIsDefault}
          onClick={() => setResetOpen(true)}
        >
          Reset layout
        </Button>
      }
    >
      <div className="flex justify-center px-4 py-6">
        <CodexMicroKeyboard
          layout={settings.layout}
          agentKeys={agentKeys}
          agentKeyHint={customAssignments ? undefined : "Change what agent keys follow in Options"}
          knobLabel={codexMicroEncoderModeOption(settings.layout.encoderMode).label}
          lights={codexMicroStatusLights(settings.enabled, state)}
          pressedKey={pressedKey}
          onSelect={select}
        />
      </div>
      {editing === null ? null : (
        <KeyEditor
          editing={editing}
          layout={settings.layout}
          customAgentKeys={settings.customAgentKeys}
          onLayoutChange={saveLayout}
          onCustomAgentKeysChange={(customAgentKeys) =>
            void updateSettings({ codexMicroCustomAgentKeys: customAgentKeys })
          }
          onClose={() => setEditing(null)}
        />
      )}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset keyboard layout?</AlertDialogTitle>
            <AlertDialogDescription>
              Command keys, the analog stick, and the knob go back to their defaults. Agent keys and
              their custom assignments stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                saveLayout(resetLayout);
                setResetOpen(false);
              }}
            >
              Reset layout
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
