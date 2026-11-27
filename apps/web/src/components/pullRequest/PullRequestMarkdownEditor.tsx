import { useRef, useState } from "react";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@supaterm/contracts";

import { cn } from "~/lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

import { TextFieldSpeechControls, useTextFieldSpeech } from "~/speech/useTextFieldSpeech";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "./PullRequestMarkdownTextarea";
import { isImeComposing } from "~/lib/imeComposition";
import { T, useGT } from "gt-react";

export function PullRequestMarkdownEditor({
  value,
  cwd,
  environmentId,
  completionScope,
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
  readonly completionScope: PullRequestCompletionScope | null;
  readonly threadRef?: ScopedThreadRef | null;
  readonly placeholder?: string | undefined;
  readonly label: string;
  readonly saving: boolean;
  readonly allowEmpty?: boolean;
  readonly className?: string | undefined;
  readonly onSave: (next: string) => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [seed, setSeed] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speech = useTextFieldSpeech({
    environmentId,
    ownerKey: JSON.stringify(["pr-markdown", environmentId, cwd, label]),
    text: draft,
    textareaRef,
    onTextChange: setDraft,
    disabled: saving || preview,
  });
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  const empty = draft.trim().length === 0;
  const saveDisabled =
    !canWriteSourceControl ||
    saving ||
    speech.preparing ||
    (empty && !allowEmpty && !speech.blocksSubmission);

  return (
    <div
      className={cn("space-y-2", className)}
      onKeyDown={(event) => {
        if (isImeComposing(event)) return;
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
            speech.submitAfterDictation(onSave);
          return;
        }
        if (event.key !== "Escape" || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <ToggleGroup
        aria-label={gt("Markdown editor mode")}
        variant="segmented"
        value={[preview ? "preview" : "write"]}
        disabled={saving}
        onValueChange={(next) => {
          const mode = next[0];
          if (mode === "write" || mode === "preview") setPreview(mode === "preview");
        }}
      >
        <Toggle value="write">
          <T context="verb, markdown editor mode">Write</T>
        </Toggle>
        <Toggle value="preview">
          <T context="markdown editor mode">Preview</T>
        </Toggle>
      </ToggleGroup>
      {preview ? (
        <div className="rounded-lg border border-border/60 px-3 py-2">
          {empty ? (
            <p className="text-xs text-muted-foreground">
              <T>Nothing to preview.</T>
            </p>
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
        <PullRequestMarkdownTextarea
          ref={textareaRef}
          autoFocus
          disabled={saving}
          readOnly={speech.freezesEditor}
          completionScope={completionScope}
          value={draft}
          rows={6}
          placeholder={placeholder}
          aria-label={label}
          onValueChange={setDraft}
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {preview ? null : <TextFieldSpeechControls speech={speech} disabled={saving} />}
        <Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          <T>Cancel</T>
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
          {saving ? gt("Saving...") : gt("Save")}
        </Button>
      </div>
    </div>
  );
}
