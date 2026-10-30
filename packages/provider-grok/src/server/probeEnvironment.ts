// Background probes must not trigger invisible updates or npm console windows.
// Disable the CLI updater only for probes; user sessions keep their configured behavior.
export function grokProbeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...environment, GROK_DISABLE_AUTOUPDATER: "1" };
}
