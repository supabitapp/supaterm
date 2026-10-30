import { createInlineConfirm } from "@supaterm/client-runtime/inline-confirm";
import { useEffect, useId, useState } from "react";

const TARGET_ATTRIBUTE = "data-inline-confirm";

const schedule = (ms: number, run: () => void) => {
  const timeout = window.setTimeout(run, ms);
  return () => window.clearTimeout(timeout);
};

type PressEvent = {
  readonly timeStamp: number;
  readonly preventBaseUIHandler?: () => void;
};

export function useInlineConfirm<Key extends string>() {
  const scope = useId();
  const [armed, setArmed] = useState<Key | null>(null);
  const [confirm] = useState(() => createInlineConfirm<Key>(setArmed, schedule));

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Releases the confirmation timer and target when the hook unmounts.
  useEffect(() => () => confirm.disarm(), [confirm]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Listens for outside pointer presses and keyboard cancellation while confirmation is armed.
  useEffect(() => {
    if (armed === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const repeatedActivation = event.repeat && (event.key === "Enter" || event.key === " ");
      if (event.key !== "Escape" && !repeatedActivation) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") confirm.disarm();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const pressed = target?.closest(`[${TARGET_ATTRIBUTE}]`)?.getAttribute(TARGET_ATTRIBUTE);
      if (pressed !== `${scope}:${armed}`) confirm.disarm();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [armed, confirm, scope]);

  return {
    armed,
    bind: (key: Key, run: () => void) => ({
      [TARGET_ATTRIBUTE]: `${scope}:${key}`,
      ref: confirm.attach(key),
      onClick: (event: PressEvent) => {
        if (!confirm.press(key, event.timeStamp)) {
          event.preventBaseUIHandler?.();
          return;
        }
        run();
      },
    }),
  };
}
