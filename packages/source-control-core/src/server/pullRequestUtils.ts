import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export function trimOptionalString(value: string | null | undefined): string | null;
export function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return (trimmed.length > 0 ? trimmed : null) satisfies string | null;
}

export function isCommitSha(value: string): boolean;
export function isCommitSha(value: string) {
  return /^[0-9a-f]{7,64}$/i.test(value) satisfies boolean;
}

/** Normalize host timestamps to UTC for cross-host string sorting. */
export function toIsoUtc(value: string) {
  return Option.match(DateTime.make(value), { onNone: () => value, onSome: DateTime.formatIso });
}

export function normalizeRefName(refName: string) {
  return refName.trim().replace(/^refs\/heads\//, "");
}

export function normalizeHost(host: string): string;
export function normalizeHost(host: string) {
  return host.trim().toLowerCase() satisfies string;
}
