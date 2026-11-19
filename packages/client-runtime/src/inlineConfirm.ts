export const INLINE_CONFIRM_GUARD_MS = 250;
export const INLINE_CONFIRM_TIMEOUT_MS = 5000;

export type InlineConfirmSchedule = (ms: number, run: () => void) => () => void;

export interface InlineConfirm<Key extends string> {
  readonly press: (key: Key, at: number) => boolean;
  readonly disarm: (key?: Key) => void;
  readonly attach: (key: Key) => () => () => void;
}

export function createInlineConfirm<Key extends string>(
  onChange: (armed: Key | null) => void,
  schedule: InlineConfirmSchedule,
): InlineConfirm<Key> {
  let armed: Key | null = null;
  let armedAt = 0;
  let cancelTimeout: (() => void) | undefined;
  const attachments = new Map<Key, () => () => void>();

  const set = (next: Key | null) => {
    cancelTimeout?.();
    cancelTimeout =
      next === null ? undefined : schedule(INLINE_CONFIRM_TIMEOUT_MS, () => set(null));
    armed = next;
    onChange(next);
  };

  const disarm = (key?: Key) => {
    if (armed !== null && (key === undefined || key === armed)) set(null);
  };

  return {
    press: (key, at) => {
      if (armed !== key) {
        armedAt = at;
        set(key);
        return false;
      }
      if (at - armedAt < INLINE_CONFIRM_GUARD_MS) return false;
      set(null);
      return true;
    },
    disarm,
    attach: (key) => {
      let attachment = attachments.get(key);
      if (attachment === undefined) {
        attachment = () => () => disarm(key);
        attachments.set(key, attachment);
      }
      return attachment;
    },
  };
}
