const sources = new WeakMap<object, string>();

export function recordPullRequestObservation<A>(value: A, environmentId: string): A {
  if (typeof value === "object" && value !== null) sources.set(value, environmentId);
  return value;
}

export function pullRequestObservationsShareSource(left: object, right: object): boolean {
  const source = sources.get(left);
  return source !== undefined && source === sources.get(right);
}

export function preservePullRequestObservation<A extends object>(source: object, value: A): A {
  const environmentId = sources.get(source);
  return environmentId === undefined ? value : recordPullRequestObservation(value, environmentId);
}
