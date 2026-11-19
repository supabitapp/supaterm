import { Atom, type AtomRegistry } from "effect/reactivity";

import type { DraftComposerAttachment } from "../../lib/composerImages";
import type { ComposerDraft } from "../../state/use-composer-drafts";
import type {
  IncomingShareDestination,
  IncomingShareDraft,
  selectIncomingShareAttachmentsForServer,
} from "../sharing/incoming-share-model";

export type ShareImportPhase =
  | "idle"
  | "reserving"
  | "attaching"
  | "consuming"
  | "done"
  | "failed"
  | "cancelling"
  | "cancelled";

export type ShareImportEvent =
  | "start"
  | "reserved"
  | "attached"
  | "consumed"
  | "failed"
  | "cancel"
  | "cancelFailed"
  | "cancelled";

const TRANSITIONS: Readonly<
  Record<ShareImportPhase, Partial<Record<ShareImportEvent, ShareImportPhase>>>
> = {
  idle: { start: "reserving" },
  reserving: { reserved: "attaching", failed: "failed" },
  attaching: { attached: "consuming", failed: "failed" },
  consuming: { consumed: "done", failed: "failed" },
  done: {},
  failed: { start: "reserving", cancel: "cancelling" },
  cancelling: { cancelled: "cancelled", cancelFailed: "failed" },
  cancelled: {},
};

/** Events that do not apply to the current phase leave it unchanged. */
export function transitionShareImport(
  phase: ShareImportPhase,
  event: ShareImportEvent,
): ShareImportPhase {
  return TRANSITIONS[phase][event] ?? phase;
}

function isShareImportInFlight(phase: ShareImportPhase): boolean {
  return phase === "reserving" || phase === "attaching" || phase === "consuming";
}

/**
 * One draft route importing one share into one draft. Plain data, compared
 * structurally, so the screen can build it on every render.
 */
export interface ShareImportTarget {
  /** The draft route's flow key; the import is abandoned once it leaves the stack. */
  readonly flowKey: string;
  readonly routeKey: string;
  readonly draftKey: string;
  readonly destination: IncomingShareDestination;
  readonly shareId: string;
}

export interface ShareImportDeps {
  readonly registry: AtomRegistry.AtomRegistry;
  /** The share as the inbox holds it now. */
  readonly getShare: (shareId: string) => IncomingShareDraft | null;
  readonly reserve: (shareId: string, destination: IncomingShareDestination) => Promise<void>;
  readonly release: (shareId: string, destination: IncomingShareDestination) => Promise<void>;
  readonly consume: (shareId: string) => Promise<void>;
  readonly readDraft: (draftKey: string) => ComposerDraft;
  /**
   * Restores `snapshot` if the draft still equals `merged`; otherwise removes only
   * what the merge added, keeping later edits.
   */
  readonly undoMerge: (
    draftKey: string,
    snapshot: ComposerDraft,
    merged: ComposerDraft,
  ) => Promise<void>;
  readonly mergeIntoDraft: (
    draftKey: string,
    content: {
      readonly text: string;
      readonly attachments: ReadonlyArray<DraftComposerAttachment>;
      readonly sourceShareId: string;
    },
  ) => Promise<{ readonly skippedAttachmentCount: number }>;
  readonly selectAttachments: (
    share: IncomingShareDraft,
    environmentId: string,
  ) => ReturnType<typeof selectIncomingShareAttachmentsForServer>;
  /** Sweeps files no draft retained; the sweep re-checks ownership. */
  readonly releaseUnusedAttachments: (attachments: ReadonlyArray<DraftComposerAttachment>) => void;
  readonly onWarnings: (warnings: ReadonlyArray<string>) => void;
  readonly onImportFailure: (target: ShareImportTarget, error: unknown) => void;
  /** Reported even after the route left: the undo is still incomplete. */
  readonly onCancelFailure: (target: ShareImportTarget, error: unknown) => void;
  /** Leaves the draft route once its import is cancelled. */
  readonly leave: (target: ShareImportTarget) => void;
}

interface Entry {
  readonly target: ShareImportTarget;
  phase: ShareImportPhase;
  readonly controller: AbortController;
  superseded: boolean;
  detached: boolean;
  run: Promise<void>;
  backup: ComposerDraft | null;
  merged: ComposerDraft | null;
  reservedFor: IncomingShareDestination | null;
  consumed: boolean;
  needsRestore: boolean;
  readonly listeners: Set<() => void>;
}

function keyOf(target: ShareImportTarget): string {
  return JSON.stringify([
    target.flowKey,
    target.routeKey,
    target.draftKey,
    target.destination.environmentId,
    target.destination.projectId,
    target.shareId,
  ]);
}

interface ImportedShare {
  readonly flowKey: string;
  readonly shareId: string;
}

/**
 * Share imports for draft routes. Imports do durable writes, so each is tied to
 * its target, not an atom node that can be rebuilt. Reading a target's phase atom
 * starts its import at most once; alerts, navigation and notifications all
 * follow an await, never run inside the read.
 */
export function makeIncomingShareImports(deps: ShareImportDeps) {
  const entries = new Map<string, Entry>();
  const importedAtom = Atom.make<ReadonlyArray<ImportedShare>>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:incoming-share-imported"),
  );
  const isImportedAtom = Atom.family((key: string) =>
    Atom.make((get) =>
      get(importedAtom).some(
        (imported) => JSON.stringify([imported.flowKey, imported.shareId]) === key,
      ),
    ).pipe(Atom.withLabel("mobile:incoming-share-imported:route")),
  );
  const runningAtom = Atom.make<ReadonlyArray<string>>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:incoming-share-import-running"),
  );
  const isRunningAtom = Atom.family((flowKey: string) =>
    Atom.make((get) => get(runningAtom).includes(flowKey)).pipe(
      Atom.withLabel("mobile:incoming-share-import-running:route"),
    ),
  );

  function notify(entry: Entry): void {
    for (const listener of Array.from(entry.listeners)) listener();
  }

  function advance(entry: Entry, event: ShareImportEvent): void {
    const next = transitionShareImport(entry.phase, event);
    if (next === entry.phase) return;
    entry.phase = next;
    notify(entry);
  }

  function settle(key: string, entry: Entry): void {
    if (entry.detached && entries.get(key) === entry) entries.delete(key);
  }

  async function runImport(key: string, entry: Entry): Promise<void> {
    const { signal } = entry.controller;
    const { shareId, destination, draftKey } = entry.target;
    const stopped = () => {
      if (!signal.aborted) return false;
      if (entry.superseded) notify(entry);
      return true;
    };
    try {
      await deps.reserve(shareId, destination);
      entry.reservedFor = destination;
      if (stopped()) return;
      advance(entry, "reserved");
      const share = deps.getShare(shareId);
      if (!share) throw new Error("The shared content is no longer in the inbox.");
      const selected = deps.selectAttachments(share, destination.environmentId);
      if (selected.status === "pending") {
        throw new Error("Server attachment support is still loading.");
      }
      entry.needsRestore = true;
      let skippedAttachmentCount: number;
      try {
        ({ skippedAttachmentCount } = await deps.mergeIntoDraft(draftKey, {
          text: share.text,
          attachments: selected.attachments,
          sourceShareId: shareId,
        }));
      } finally {
        entry.merged = deps.readDraft(draftKey);
      }
      if (stopped()) return;
      advance(entry, "attached");
      await deps.consume(shareId);
      entry.consumed = true;
      const retainedIds = new Set(
        deps.readDraft(draftKey).attachments.map((attachment) => attachment.id),
      );
      deps.releaseUnusedAttachments(
        share.attachments.filter((attachment) => !retainedIds.has(attachment.id)),
      );
      deps.registry.set(importedAtom, [
        ...deps.registry.get(importedAtom),
        { flowKey: entry.target.flowKey, shareId },
      ]);
      advance(entry, "consumed");
      entry.backup = null;
      settle(key, entry);
      if (stopped()) return;
      const warnings = [...share.warnings, ...selected.warnings];
      if (skippedAttachmentCount > 0) {
        warnings.push(
          `${skippedAttachmentCount} shared file${skippedAttachmentCount === 1 ? " was" : "s were"} skipped because this draft reached the attachment limit.`,
        );
      }
      if (warnings.length > 0) deps.onWarnings(warnings);
    } catch (error) {
      if (stopped()) return;
      advance(entry, "failed");
      deps.onImportFailure(entry.target, error);
    }
  }

  function begin(key: string, entry: Entry): void {
    entry.backup ??= deps.readDraft(entry.target.draftKey);
    advance(entry, "start");
    const { flowKey } = entry.target;
    deps.registry.set(runningAtom, [...deps.registry.get(runningAtom), flowKey]);
    entry.run = runImport(key, entry).finally(() => {
      const running = [...deps.registry.get(runningAtom)];
      running.splice(running.indexOf(flowKey), 1);
      deps.registry.set(runningAtom, running);
    });
  }

  function abandon(key: string, entry: Entry): void {
    entry.controller.abort();
    entries.delete(key);
  }

  function start(target: ShareImportTarget): Entry {
    const key = keyOf(target);
    const existing = entries.get(key);
    if (existing) return existing;
    for (const [otherKey, other] of entries) {
      if (other.target.flowKey === target.flowKey && isShareImportInFlight(other.phase)) {
        other.superseded = true;
        abandon(otherKey, other);
      }
    }
    const entry: Entry = {
      target,
      phase: "idle",
      controller: new AbortController(),
      superseded: false,
      detached: false,
      run: Promise.resolve(),
      backup: null,
      merged: null,
      reservedFor: null,
      consumed: false,
      needsRestore: false,
      listeners: new Set(),
    };
    entries.set(key, entry);
    begin(key, entry);
    return entry;
  }

  async function cancel(target: ShareImportTarget): Promise<void> {
    const key = keyOf(target);
    const entry = entries.get(key);
    if (!entry || entry.phase !== "failed") return;
    const { draftKey, shareId } = entry.target;
    advance(entry, "cancel");
    try {
      if (entry.needsRestore && entry.backup) {
        const merged = entry.merged ?? entry.backup;
        await deps.undoMerge(draftKey, entry.backup, merged);
        entry.needsRestore = false;
        if (entry.consumed) deps.releaseUnusedAttachments(merged.attachments);
      }
      if (entry.reservedFor) {
        await deps.release(shareId, entry.reservedFor);
        entry.reservedFor = null;
      }
      advance(entry, "cancelled");
      if (entry.detached) settle(key, entry);
      else deps.leave(entry.target);
    } catch (error) {
      advance(entry, "cancelFailed");
      deps.onCancelFailure(entry.target, error);
    }
  }

  return {
    phaseAtom: Atom.family((target: ShareImportTarget) =>
      Atom.make((get): ShareImportPhase => {
        const entry = start(target);
        const rebuild = () => get.refreshSelf();
        entry.listeners.add(rebuild);
        get.addFinalizer(() => entry.listeners.delete(rebuild));
        return entry.phase;
      }).pipe(Atom.withLabel("mobile:incoming-share-import")),
    ),
    inFlightAtom: isRunningAtom,
    settled(target: ShareImportTarget): Promise<void> {
      return entries.get(keyOf(target))?.run ?? Promise.resolve();
    },
    importedAtom(flowKey: string, shareId: string) {
      return isImportedAtom(JSON.stringify([flowKey, shareId]));
    },
    retry(target: ShareImportTarget): void {
      const key = keyOf(target);
      const entry = entries.get(key);
      if (!entry || entry.phase !== "failed") return;
      begin(key, entry);
    },
    cancel,
    prune(liveFlowKeys: ReadonlySet<string>): Promise<void> {
      const stopping: Array<Promise<void>> = [];
      for (const [key, entry] of entries) {
        if (liveFlowKeys.has(entry.target.flowKey)) continue;
        if (entry.phase === "failed" || entry.phase === "cancelling") {
          entry.detached = true;
        } else {
          abandon(key, entry);
          stopping.push(entry.run);
        }
      }
      const imported = deps.registry.get(importedAtom);
      const kept = imported.filter((share) => liveFlowKeys.has(share.flowKey));
      if (kept.length !== imported.length) deps.registry.set(importedAtom, kept);
      return Promise.all(stopping).then(() => undefined);
    },
  };
}

export const idleShareImportPhaseAtom = Atom.make<ShareImportPhase>("idle").pipe(
  Atom.withLabel("mobile:incoming-share-import:idle"),
);

export const idleShareFlagAtom = Atom.make(false).pipe(
  Atom.withLabel("mobile:incoming-share-flag:idle"),
);
