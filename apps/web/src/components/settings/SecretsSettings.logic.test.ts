import { ServerSettings } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { secretProviderUses } from "./SecretsSettings.logic";

const personal = (reference: string) => ({ provider: "personal", reference });
const work = { provider: "work", reference: "op://Work/token" };

const settings = Schema.decodeSync(ServerSettings)({
  providerInstances: {
    antigravity_work: {
      driver: "antigravity",
      displayName: "Antigravity Work",
      config: { authMethod: "gemini-api-key", apiKey: personal("op://gemini") },
      environment: [
        { name: "API_TOKEN", value: "", secret: personal("op://a/env") },
        { name: "OTHER_TOKEN", value: "", secret: work },
      ],
    },
    codex_plain: {
      driver: "codex",
      environment: [{ name: "CODEX_TOKEN", value: "", secret: personal("op://c/env") }],
    },
  },
  sourceControlHosts: {
    github: { tokens: { "github.com": personal("op://gh"), "ghe.acme.test": work } },
    bitbucket: { accessToken: personal("op://bb") },
  },
  easDeviceHosts: [
    { kind: "eas", id: "eas", label: "Expo Simulators", accessToken: personal("op://expo") },
  ],
});

it.each([
  [
    "personal",
    [
      "Antigravity Work · API key",
      "Antigravity Work · API_TOKEN",
      "Codex · CODEX_TOKEN",
      "GitHub · github.com",
      "Bitbucket · Access token",
      "Expo Simulators · Access Token",
    ],
  ],
  ["work", ["Antigravity Work · OTHER_TOKEN", "GitHub · ghe.acme.test"]],
  ["unused", []],
])("lists what reads from secret provider %s", (providerId, uses) => {
  expect(secretProviderUses(settings, providerId).map((use) => use.label)).toEqual(uses);
});
