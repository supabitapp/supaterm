import type { BrowserImportFailureReason, BrowserImportSource } from "@supaterm/contracts";

export interface WizardTargetProfile {
  readonly id: string;
  readonly name: string;
}

export type WizardTarget =
  | { readonly kind: "new"; readonly profileId: string }
  | { readonly kind: "existing"; readonly profileId: string; readonly name: string };

export type WizardTargetSelection =
  | { readonly kind: "new" }
  | { readonly kind: "existing"; readonly profileId: string };

export function initialTargetSelection(
  canCreateProfile: boolean,
  targetProfiles: ReadonlyArray<WizardTargetProfile>,
) {
  if (canCreateProfile) return { kind: "new" } satisfies WizardTargetSelection;
  const first = targetProfiles[0];
  return (
    first ? { kind: "existing", profileId: first.id } : { kind: "new" }
  ) satisfies WizardTargetSelection;
}

export function resolveWizardTarget(
  selection: WizardTargetSelection,
  newProfileId: string,
  targetProfiles: ReadonlyArray<WizardTargetProfile>,
) {
  if (selection.kind === "new")
    return { kind: "new", profileId: newProfileId } satisfies WizardTarget | undefined;
  const profile = targetProfiles.find((candidate) => candidate.id === selection.profileId);
  if (profile === undefined) return undefined satisfies WizardTarget | undefined;
  return {
    kind: "existing",
    profileId: selection.profileId,
    name: profile.name,
  } satisfies WizardTarget | undefined;
}

export type ImportOutcome =
  | {
      readonly kind: "imported";
      readonly imported: number;
      readonly skipped: number;
      readonly skippedDomains: ReadonlyArray<string>;
      readonly targetName: string;
    }
  | { readonly kind: "blocked"; readonly reason: BrowserImportFailureReason };

export type WizardStep =
  | { readonly step: "quit" }
  | {
      readonly step: "fullDiskAccess";
      readonly resume: "configure" | "import";
      readonly checked?: boolean;
    }
  | { readonly step: "configure" }
  | { readonly step: "checking"; readonly check: "browser" | "fullDiskAccess" }
  | { readonly step: "importing" }
  | {
      readonly step: "done";
      readonly imported: number;
      readonly skipped: number;
      readonly skippedDomains: ReadonlyArray<string>;
      readonly targetName: string;
    }
  | { readonly step: "blocked"; readonly reason: BrowserImportFailureReason };

export function canCloseWizard(step: WizardStep) {
  return step.step !== "importing";
}

export function initialWizardStep(source: BrowserImportSource) {
  if (source.unavailable === "browserRunning") return { step: "quit" } satisfies WizardStep;
  if (source.unavailable === "needsFullDiskAccess") {
    return { step: "fullDiskAccess", resume: "configure" } satisfies WizardStep;
  }
  if (source.unavailable !== undefined)
    return { step: "blocked", reason: source.unavailable } satisfies WizardStep;
  if (source.profiles.length === 0)
    return { step: "blocked", reason: "unknownSourceProfile" } satisfies WizardStep;
  return { step: "configure" } satisfies WizardStep;
}

export function outcomeToStep(outcome: ImportOutcome) {
  if (outcome.kind === "imported") {
    return {
      step: "done",
      imported: outcome.imported,
      skipped: outcome.skipped,
      skippedDomains: outcome.skippedDomains,
      targetName: outcome.targetName,
    } satisfies WizardStep;
  }
  if (outcome.reason === "browserRunning") return { step: "quit" } satisfies WizardStep;
  if (outcome.reason === "needsFullDiskAccess") {
    return { step: "fullDiskAccess", resume: "import", checked: true } satisfies WizardStep;
  }
  return { step: "blocked", reason: outcome.reason } satisfies WizardStep;
}

export function refreshedSourceStep(source: BrowserImportSource | undefined) {
  if (source === undefined)
    return { step: "blocked", reason: "unknownSource" } satisfies WizardStep;
  return initialWizardStep(source) satisfies WizardStep;
}

export function fullDiskAccessRecheckStep(source: BrowserImportSource | undefined) {
  const next = refreshedSourceStep(source);
  return (next.step === "fullDiskAccess" ? { ...next, checked: true } : next) satisfies WizardStep;
}

export function refreshedSourceProfileDirectory(
  currentDirectory: string,
  source: BrowserImportSource,
) {
  if (source.profiles.some((profile) => profile.directory === currentDirectory)) {
    return currentDirectory;
  }
  return source.profiles[0]?.directory ?? "";
}

export function isRetryableReason(reason: BrowserImportFailureReason) {
  switch (reason) {
    case "needsKeychainApproval":
    case "keychainItemMissing":
    case "keychainUnavailable":
    case "readFailed":
    case "sessionUnavailable":
    case "profileNotSaved":
      return true;
    default:
      return false;
  }
}

export function formatSkippedDomains(domains: ReadonlyArray<string>) {
  if (domains.length === 0) return "";
  if (domains.length === 1) return domains[0]!;
  if (domains.length <= 3) return `${domains.slice(0, -1).join(", ")} and ${domains.at(-1)}`;
  return `${domains.slice(0, 3).join(", ")} and ${domains.length - 3} more`;
}
