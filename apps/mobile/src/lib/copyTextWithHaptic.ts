import * as Schema from "effect/Schema";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

export class CopyTextClipboardWriteError extends Schema.TaggedError<CopyTextClipboardWriteError>()(
  "CopyTextClipboardWriteError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to copy ${this.target} to the clipboard.`;
  }
}

export class CopyTextHapticFeedbackError extends Schema.TaggedError<CopyTextHapticFeedbackError>()(
  "CopyTextHapticFeedbackError",
  {
    target: Schema.String,
    feedback: Schema.Literals(["light-impact", "selection"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to trigger ${this.feedback} haptic feedback after copying ${this.target}.`;
  }
}

interface CopyTextWithHapticOptions {
  readonly target?: string;
  readonly feedback?: "light-impact" | "selection";
}

export interface CopyTextPlatform {
  readonly setString: (value: string) => Promise<unknown>;
  readonly lightImpact: () => Promise<void>;
  readonly selection: () => Promise<void>;
  readonly reportError: (message: string, details: object) => void;
}

const expoCopyTextPlatform: CopyTextPlatform = {
  setString: (value) => Clipboard.setStringAsync(value),
  lightImpact: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  selection: () => Haptics.selectionAsync(),
  reportError: (message, details) => console.error(message, details),
};

export async function tryCopyTextWithHaptic(
  value: string,
  options: CopyTextWithHapticOptions = {},
  platform: CopyTextPlatform = expoCopyTextPlatform,
) {
  const target = options.target ?? "text";
  const feedback = options.feedback ?? "light-impact";

  const clipboardWrite = (async () => {
    try {
      await platform.setString(value);
      return true;
    } catch (cause) {
      const error = new CopyTextClipboardWriteError({ target, cause });
      platform.reportError(error.message, { _tag: error._tag, target, stack: error.stack });
      return false;
    }
  })();

  void (async () => {
    try {
      if (feedback === "selection") {
        await platform.selection();
      } else {
        await platform.lightImpact();
      }
    } catch (cause) {
      const error = new CopyTextHapticFeedbackError({ target, feedback, cause });
      platform.reportError(error.message, {
        _tag: error._tag,
        target,
        feedback,
        stack: error.stack,
      });
    }
  })();

  return await clipboardWrite;
}

export function copyTextWithHaptic(
  value: string,
  options: CopyTextWithHapticOptions = {},
  platform: CopyTextPlatform = expoCopyTextPlatform,
) {
  void tryCopyTextWithHaptic(value, options, platform);
}
