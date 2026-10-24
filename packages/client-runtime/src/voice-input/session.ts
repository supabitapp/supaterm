import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceStopOutcome,
} from "./controller.ts";

export type VoiceInputTarget = {
  readonly ownerKey: string;
  readonly label?: string;
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: VoiceInputControllerDependencies["commitDraft"];
  readonly subscribe: () => () => void;
};

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
      commitDraft: (text, selection, edit) => {
        this.target?.commitDraft(text, selection, edit);
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

  stop(onCommit?: (text: string) => void): Promise<VoiceStopOutcome> {
    if (this.controller.currentState.phase !== "recording") {
      return Promise.resolve({ kind: "none" });
    }
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
