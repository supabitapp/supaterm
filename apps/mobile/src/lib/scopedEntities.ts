import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";

export function scopedProjectKey(environmentId: EnvironmentId, projectId: ProjectId): string;
export function scopedProjectKey(environmentId: EnvironmentId, projectId: ProjectId) {
  return `${environmentId}:${projectId}` satisfies string;
}

export function scopedThreadKey(environmentId: EnvironmentId, threadId: ThreadId): string;
export function scopedThreadKey(environmentId: EnvironmentId, threadId: ThreadId) {
  return `${environmentId}:${threadId}` satisfies string;
}
