import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
} from "@supaterm/client-runtime/voice-input";

export type VoiceInputTarget = {
  readonly ownerKey: string;
  readonly label?: string;
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: VoiceInputControllerDependencies["commitDraft"];
  readonly subscribe: () => () => void;
};

export function createVoiceInputTarget(
  ownerKey: string,
  readText: () => string | null,
  commitDraft: VoiceInputTarget["commitDraft"],
  selection: VoiceDraftSnapshot["selection"],
  subscribeToChanges: (onChange: () => void) => () => void,
): VoiceInputTarget {
  let revision = 0;
  return {
    ownerKey,
    readDraft: () => {
      const text = readText();
      if (text === null) return null;
      return { ownerKey, text, selection, revision };
    },
    commitDraft,
    subscribe: () => {
      let previousText = readText();
      return subscribeToChanges(() => {
        const text = readText();
        if (text !== previousText) {
          previousText = text;
          revision += 1;
        }
      });
    },
  };
}

export class VoiceInputSession {
  readonly controller: VoiceInputController;
  private target: VoiceInputTarget | null = null;
  private unsubscribe: (() => void) | null = null;
  private onCommit: ((text: string) => void) | undefined;

  constructor(dependencies: Omit<VoiceInputControllerDependencies, "readDraft" | "commitDraft">) {
    this.controller = new VoiceInputController({
      ...dependencies,
      onStateChange: (state) => {
        if (!voiceInputBlocksSubmission(state)) {
          this.onCommit = undefined;
          this.unsubscribe?.();
          this.unsubscribe = null;
        }
        dependencies.onStateChange(state);
      },
      readDraft: () => this.target?.readDraft() ?? null,
      commitDraft: (text, selection) => {
        this.target?.commitDraft(text, selection);
        this.onCommit?.(text);
      },
    });
  }

  get ownerKey(): string | null {
    return this.target?.ownerKey ?? null;
  }

  get label(): string | null {
    return this.target?.label ?? null;
  }

  cancel(ownerKey: string | null): void {
    if (ownerKey !== null && this.ownerKey === ownerKey) this.controller.cancel();
  }

  retry(): Promise<void> {
    return this.target ? this.start(this.target) : Promise.resolve();
  }

  stop(onCommit?: (text: string) => void): Promise<void> {
    if (this.controller.currentState.phase !== "recording") return Promise.resolve();
    this.onCommit = onCommit;
    return this.controller.stop();
  }

  start(target: VoiceInputTarget): Promise<void> {
    if (voiceInputBlocksSubmission(this.controller.currentState)) return Promise.resolve();
    this.target = target;
    this.unsubscribe = target.subscribe();
    return this.controller.start();
  }
}
