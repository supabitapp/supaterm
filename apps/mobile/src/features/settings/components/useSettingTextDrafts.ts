import type { ServerSettingsPatch } from "@supaterm/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

type TextSetting = "branchNamePrefix" | "branchNameInstructions" | "threadTitleInstructions";

/**
 * Text typed into settings fields, saved when editing ends or the screen closes, since
 * leaving the screen does not end editing. A draft typed over a value that has since
 * changed elsewhere is dropped. `null` is a mixed value, which any draft replaces.
 */
export function useSettingTextDrafts<Field extends TextSetting>(
  saved: Readonly<Record<Field, string | null>>,
  onChange: (patch: ServerSettingsPatch) => void,
) {
  const drafts = useRef<Partial<Record<Field, { text: string; over: string | null }>>>({});
  const take = (field: Field): ServerSettingsPatch => {
    const draft = drafts.current[field];
    delete drafts.current[field];
    const value = saved[field];
    if (draft === undefined || draft.over !== value) return {};
    const text = draft.text.trim();
    return value === null || text !== value ? { [field]: text } : {};
  };
  const send = (patch: ServerSettingsPatch) => {
    if (Object.keys(patch).length > 0) onChange(patch);
  };
  const saveDrafts = useEffectEvent(() => {
    const fields = Object.keys(drafts.current) as Field[];
    send(Object.assign({}, ...fields.map(take)));
  });
  useEffect(() => () => saveDrafts(), []);
  return {
    edit: (field: Field, text: string) => {
      drafts.current[field] = { text, over: saved[field] };
    },
    save: (field: Field) => send(take(field)),
  };
}
