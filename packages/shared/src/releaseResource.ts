import { type CliReleaseChannel, cliReleaseChannelOf } from "./cliRelease.ts";

export type ReleaseChannel = "dev" | CliReleaseChannel;
export const releaseChannelOf = (version: string): ReleaseChannel =>
  /-pr\.\d+\.\d+$/.test(version) ? "preview" : cliReleaseChannelOf(version);
export const releaseResourceAttributes = (
  channel: ReleaseChannel,
  operatorAttributes: Readonly<Record<string, unknown>> = {},
) => {
  const operatorValue = (key: string) => {
    const value = operatorAttributes[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  return {
    "supaterm.release.channel": operatorValue("supaterm.release.channel") ?? channel,
    "deployment.environment.name":
      operatorValue("deployment.environment.name") ??
      (channel === "dev" ? "development" : channel === "preview" ? "staging" : "production"),
  };
};
