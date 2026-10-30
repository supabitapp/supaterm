import { useEffect, useState } from "react";

import { useCodexMicroPressedInput } from "../codexMicroStore";
import { codexMicroPressedKey, type CodexMicroKeyId } from "./CodexMicroSettings.logic";

const PRESS_FEEDBACK_MS = 150;

/** The key the keyboard reported pressed within the last moment; presses before mount are ignored. */
export function useCodexMicroPressedKey(separateMicrophoneKeys: boolean): CodexMicroKeyId | null {
  const pressed = useCodexMicroPressedInput();
  const [seen, setSeen] = useState(pressed);
  const [flash, setFlash] = useState<{ readonly key: CodexMicroKeyId; readonly at: number } | null>(
    null,
  );
  if (pressed !== seen) {
    setSeen(pressed);
    if (pressed !== null) {
      const key = codexMicroPressedKey(pressed.event, { separateMicrophoneKeys });
      if (key !== null) setFlash({ key, at: pressed.at });
    }
  }
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), PRESS_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  return flash?.key ?? null;
}
