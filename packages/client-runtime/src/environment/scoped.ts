import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type EnvironmentId as EnvironmentIdType,
  type ProjectId as ProjectIdType,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@supaterm/contracts";

export function scopeProjectRef(environmentId: EnvironmentIdType, projectId: ProjectIdType) {
  return { environmentId, projectId };
}

export function scopeThreadRef(environmentId: EnvironmentIdType, threadId: ThreadId) {
  return { environmentId, threadId };
}

function scopedRefKey(ref: ScopedProjectRef | ScopedThreadRef) {
  const localId = "projectId" in ref ? ref.projectId : ref.threadId;
  return `${ref.environmentId}:${localId}`;
}

export function scopedProjectKey(ref: ScopedProjectRef) {
  return scopedRefKey(ref);
}

export function scopedThreadKey(ref: ScopedThreadRef): string;
export function scopedThreadKey(ref: ScopedThreadRef) {
  return scopedRefKey(ref) satisfies string;
}

function parseScopedKey(key: string) {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }
  return {
    environmentId: EnvironmentId.make(key.slice(0, separatorIndex)),
    localId: key.slice(separatorIndex + 1),
  };
}

export function parseScopedProjectKey(key: string) {
  const parsed = parseScopedKey(key);
  if (!parsed) {
    return null;
  }
  return {
    environmentId: parsed.environmentId,
    projectId: ProjectId.make(parsed.localId),
  };
}

export function parseScopedThreadKey(key: string) {
  const parsed = parseScopedKey(key);
  if (!parsed) {
    return null;
  }
  return {
    environmentId: parsed.environmentId,
    threadId: ThreadId.make(parsed.localId),
  };
}
