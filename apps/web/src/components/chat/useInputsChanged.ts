import { useState } from "react";

function sameInputs(previous: ReadonlyArray<unknown>, inputs: ReadonlyArray<unknown>) {
  return (
    previous.length === inputs.length &&
    previous.every((value, index) => Object.is(value, inputs[index]))
  );
}

type PrimitiveInput = string | number | boolean | null | undefined;

export function useInputsChanged(inputs: ReadonlyArray<PrimitiveInput>) {
  const [previous, setPrevious] = useState<ReadonlyArray<PrimitiveInput> | null>(null);
  if (previous !== null && sameInputs(previous, inputs)) {
    return false;
  }
  setPrevious(inputs);
  return true;
}

export function useInputsChangedWhileActive(active: boolean, inputs: ReadonlyArray<unknown>) {
  const [tracked, setTracked] = useState<ReadonlyArray<unknown> | null>(null);
  if (!active) {
    if (tracked !== null) setTracked(null);
    return false;
  }
  if (tracked === null) {
    setTracked(inputs);
    return false;
  }
  if (sameInputs(tracked, inputs)) {
    return false;
  }
  setTracked(inputs);
  return true;
}
