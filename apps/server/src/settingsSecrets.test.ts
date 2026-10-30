import { expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@supaterm/contracts";

import { mapSettingsSecrets, type SettingsSecret } from "./settingsSecrets.ts";

it("keeps pool tokens separate from other hosts and binds them to the gateway origin", () => {
  const settings: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    easDeviceHosts: [
      {
        kind: "eas",
        id: "pool",
        label: "EAS",
        accessToken: "eas-value",
        maxSessionMinutes: 30,
        idleMinutes: 10,
        maxConcurrentSessions: 2,
      },
    ],
    simlockDeviceHosts: [
      {
        kind: "simlock",
        id: "pool",
        label: "Pool",
        gatewayUrl: "https://pool.example.test",
        agentToken: "pool-value",
        maxLeases: 2,
        maxLeaseMinutes: 60,
      },
    ],
  };
  const values: SettingsSecret[] = [];
  const redacted = mapSettingsSecrets(settings, (secret) => {
    values.push(secret);
    return { value: "", redacted: true };
  });
  expect(redacted.simlockDeviceHosts[0]?.agentToken).not.toContain("pool-value");
  const pool = values.find((secret) => secret.value === "pool-value")!;
  const eas = values.find((secret) => secret.value === "eas-value")!;
  expect(pool.sensitive).toBe(true);
  expect(pool.secretName).not.toBe(eas.secretName);
  const namesAt = (gatewayUrl: string) => {
    let name = "";
    mapSettingsSecrets(
      {
        ...settings,
        simlockDeviceHosts: settings.simlockDeviceHosts.map((host) => ({ ...host, gatewayUrl })),
      },
      (secret) => {
        if (secret.value === "pool-value") name = secret.secretName;
        return secret;
      },
    );
    return name;
  };
  expect(namesAt("https://pool.example.test/")).toBe(pool.secretName);
  expect(namesAt("https://another.example.test")).not.toBe(pool.secretName);
});
