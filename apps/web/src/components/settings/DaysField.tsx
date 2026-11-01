import { useState } from "react";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";

/** Day-count stepper with a "days" suffix. Edits commit as whole days clamped to the range. */
export function DaysField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (days: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <NumberField
      value={draft}
      min={min}
      max={max}
      step={1}
      size="sm"
      className="w-auto"
      onValueChange={setDraft}
      onValueCommitted={(next) => {
        if (next === null) {
          setDraft(value);
          return;
        }
        const days = Math.min(max, Math.max(min, Math.round(next)));
        setDraft(days);
        onCommit(days);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label={`Decrease ${label}`} />
        <NumberFieldInput
          aria-label={`${label} in days`}
          size={5}
          className="w-auto grow-0 text-right"
        />
        <span aria-hidden="true" className="self-center pr-2 text-xs">
          days
        </span>
        <NumberFieldIncrement aria-label={`Increase ${label}`} />
      </NumberFieldGroup>
    </NumberField>
  );
}
