import { useState } from "react";

export function useComposerMenuState(hidden = false) {
  const [open, setOpen] = useState(false);
  if (hidden && open) {
    setOpen(false);
  }
  return [open && !hidden, setOpen] as const;
}
