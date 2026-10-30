import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceTranscriber,
} from "@supaterm/client-runtime/voice-input";

import type { VoiceEngine } from "../../lib/voiceEngine";

export type VoiceInputEngine = VoiceEngine & {
  readonly transcriber: VoiceTranscriber;
  /** BCP 47, what an environment is asked to transcribe in. */
  readonly language: string;
};

export type VoiceInputTarget = {
  readonly ownerKey: string;
  readonly label?: string;
  /** Chosen when recording starts, so a settings change never moves a recording elsewhere. */
  readonly engine?: VoiceInputEngine;
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
  private sendRecording: ((uri: string) => Promise<void>) | undefined;

  constructor(
    dependencies: Omit<
      VoiceInputControllerDependencies,
      "readDraft" | "commitDraft" | "getTranscriber" | "sendRecording"
    >,
  ) {
    this.controller = new VoiceInputController({
      ...dependencies,
      onStateChange: (state) => {
        if (!voiceInputBlocksSubmission(state)) {
          this.onCommit = undefined;
          this.sendRecording = undefined;
          this.unsubscribe?.();
          this.unsubscribe = null;
        }
        dependencies.onStateChange(state);
      },
      getTranscriber: () => this.target?.engine?.transcriber ?? null,
      sendRecording: (uri) =>
        this.sendRecording
          ? this.sendRecording(uri)
          : Promise.reject(new Error("This recording can't be sent as a message.")),
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

  get engine(): VoiceInputEngine | null {
    return this.target?.engine ?? null;
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

  /** Hands the finished recording to `sendRecording` as the user's message, untranscribed. */
  send(sendRecording: (uri: string) => Promise<void>): Promise<void> {
    if (this.controller.currentState.phase !== "recording") return Promise.resolve();
    this.sendRecording = sendRecording;
    return this.controller.send();
  }

  start(target: VoiceInputTarget): Promise<void> {
    if (voiceInputBlocksSubmission(this.controller.currentState)) return Promise.resolve();
    this.target = target;
    this.unsubscribe = target.subscribe();
    return this.controller.start();
  }
}
