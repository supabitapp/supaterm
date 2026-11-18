import {
  MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
} from "@supaterm/contracts/settings";
import { useRef, useState } from "react";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  type AutoMarkDoneDaysField,
  autoMarkDoneDaysField,
  cancelAutoMarkDoneDaysField,
  commitAutoMarkDoneDaysField,
  editAutoMarkDoneDaysField,
  failAutoMarkDoneDaysField,
  syncAutoMarkDoneDaysField,
} from "./SettingsPanels.logic";

const draftOf = (days: number | null) => (days === null ? "" : String(days));

/**
 * Auto mark-done stepper with a "days" suffix. Typing and arrow keys stay a draft until Enter,
 * blur or a stepper press saves it; a draft outside the range restores the saved value.
 */
export function DaysField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (days: number, options: { onFailed: () => void }) => void;
}) {
  const [stored, setField] = useState(() => autoMarkDoneDaysField(value));
  const field = syncAutoMarkDoneDaysField(stored, value);
  if (field !== stored) setField(field);
  const cancelling = useRef(false);

  const commit = (current: AutoMarkDoneDaysField) => {
    const next = commitAutoMarkDoneDaysField(current);
    setField(next.field);
    if (next.submit === null) return;
    const { revision } = next.field;
    onCommit(next.submit, {
      onFailed: () => setField((latest) => failAutoMarkDoneDaysField(latest, revision)),
    });
  };
  // Base UI shows typed text until the input blurs, so a finished edit blurs and refocuses it.
  const resyncInput = (input: HTMLInputElement) => {
    input.blur();
    input.focus();
  };

  return (
    <NumberField
      value={field.draft.trim() === "" ? null : Number(field.draft)}
      min={MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
      allowOutOfRange
      step={1}
      size="sm"
      className="w-auto"
      onValueChange={(next, details) => {
        if (cancelling.current || details.reason === "input-blur") return;
        setField(editAutoMarkDoneDaysField(field, draftOf(next)));
      }}
      onValueCommitted={(next, details) => {
        if (details.reason !== "increment-press" && details.reason !== "decrement-press") return;
        const draft = draftOf(next);
        commit(draft === field.draft ? field : editAutoMarkDoneDaysField(field, draft));
      }}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label={`Decrease ${label}`} />
        <NumberFieldInput
          aria-label={`${label} in days`}
          size={5}
          className="w-auto grow-0 text-right"
          onBlur={() => {
            if (!cancelling.current) commit(field);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") resyncInput(event.currentTarget);
            if (event.key === "Escape" && field.dirty) {
              // An unhandled Escape closes the settings page, and the blur that follows would save.
              event.preventDefault();
              event.stopPropagation();
              setField(cancelAutoMarkDoneDaysField(field));
              cancelling.current = true;
              resyncInput(event.currentTarget);
              cancelling.current = false;
            }
          }}
        />
        <span aria-hidden="true" className="self-center pr-2 text-xs">
          days
        </span>
        <NumberFieldIncrement aria-label={`Increase ${label}`} />
      </NumberFieldGroup>
    </NumberField>
  );
}
