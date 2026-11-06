import { useRef, useState } from "react";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@supaterm/contracts";

import { cn } from "~/lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

import { TextFieldVoiceInput } from "../chat/TextFieldVoiceInput";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PullRequestMarkdown } from "./PullRequestMarkdown";

export function PullRequestMarkdownEditor({
  value,
  cwd,
  environmentId,
  threadRef = null,
  placeholder,
  label,
  saving,
  allowEmpty = false,
  className,
  onSave,
  onCancel,
}: {
  readonly value: string;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadRef?: ScopedThreadRef | null;
  readonly placeholder?: string | undefined;
  readonly label: string;
  readonly saving: boolean;
  readonly allowEmpty?: boolean;
  readonly className?: string | undefined;
  readonly onSave: (next: string) => void;
  readonly onCancel: () => void;
}) {
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [seed, setSeed] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  const empty = draft.trim().length === 0;
  const saveDisabled = !canWriteSourceControl || saving || voiceBusy || (empty && !allowEmpty);

  return (
    <div
      className={cn("space-y-2", className)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (
            !saveDisabled &&
            !event.repeat &&
            readEnvironmentScope(environmentId, AuthSourceControlWriteScope)
          )
            onSave(draft);
          return;
        }
        if (event.key !== "Escape" || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <ToggleGroup
        aria-label="Markdown editor mode"
        variant="segmented"
        value={[preview ? "preview" : "write"]}
        disabled={saving}
        onValueChange={(next) => {
          const mode = next[0];
          if (mode === "write" || mode === "preview") setPreview(mode === "preview");
        }}
      >
        <Toggle value="write">Write</Toggle>
        <Toggle value="preview">Preview</Toggle>
      </ToggleGroup>
      {preview ? (
        <div className="rounded-lg border border-border/60 px-3 py-2">
          {empty ? (
            <p className="text-xs text-muted-foreground">Nothing to preview.</p>
          ) : (
            <PullRequestMarkdown
              text={draft}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
            />
          )}
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          autoFocus
          disabled={saving}
          readOnly={voiceBusy}
          value={draft}
          rows={6}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <div className="flex justify-end gap-2">
        {preview ? null : (
          <span className="mr-auto">
            <TextFieldVoiceInput
              environmentId={environmentId}
              threadId={threadRef?.environmentId === environmentId ? threadRef.threadId : null}
              disabled={saving}
              fieldRef={textareaRef}
              onChange={setDraft}
              onBusyChange={setVoiceBusy}
            />
          </span>
        )}
        <Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={saveDisabled}
          onClick={() => {
            if (saveDisabled || !readEnvironmentScope(environmentId, AuthSourceControlWriteScope))
              return;
            onSave(draft);
          }}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
