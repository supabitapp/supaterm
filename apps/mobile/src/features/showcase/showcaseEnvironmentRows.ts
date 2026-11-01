import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";

const SHOWCASE_LOCAL_ENVIRONMENT_DISPLAY_URLS: Readonly<Record<string, string>> = {
  "Studio Laptop": "https://studio.tailb37e.ts.net/",
  "Basement Tower": "http://192.168.1.40:3773/",
  "Helsinki VPS": "https://vps.supaterm.com/",
};

export function showcaseEnvironmentDisplayUrl(label: string): string | undefined {
  return SHOWCASE_LOCAL_ENVIRONMENT_DISPLAY_URLS[label];
}

export function applyShowcaseLocalEnvironmentDisplayUrls(
  environments: ReadonlyArray<ConnectedEnvironmentSummary>,
): ReadonlyArray<ConnectedEnvironmentSummary> {
  return environments.map((environment) => ({
    ...environment,
    displayUrl:
      showcaseEnvironmentDisplayUrl(environment.environmentLabel) ?? environment.displayUrl,
  }));
}

export function resolveShowcaseEnvironmentUpdateDisplayUrl(input: {
  readonly actualDisplayUrl: string;
  readonly presentedDisplayUrl: string;
  readonly submittedDisplayUrl: string;
}): string {
  return input.submittedDisplayUrl === input.presentedDisplayUrl
    ? input.actualDisplayUrl
    : input.submittedDisplayUrl;
}
