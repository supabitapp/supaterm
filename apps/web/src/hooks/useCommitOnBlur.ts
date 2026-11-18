import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";
import { isImeComposing } from "~/lib/imeComposition";

export function useCommitOnBlur(
  value: string,
  onCommit: (next: string) => void,
  normalizeDraft?: (previous: string, next: string) => string,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const valueOnFocus = useRef(value);

  return {
    value: draft ?? value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setDraft(normalizeDraft ? normalizeDraft(draft ?? value, next) : next);
    },
    onFocus: () => {
      valueOnFocus.current = value;
      setDraft(value);
    },
    onBlur: () => {
      const next = draft ?? value;
      setDraft(null);
      if (next !== valueOnFocus.current && next !== value) {
        onCommit(next);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      }
    },
  };
}
