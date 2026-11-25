import { ServerSettings } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { secretProviderUses } from "./SecretsSettings.logic";

const personal = (reference: string) => ({ provider: "personal", reference });
const work = { provider: "work", reference: "op://Work/token" };

const settings = Schema.decodeSync(ServerSettings)({
  sourceControlHosts: {
    github: { tokens: { "github.com": personal("op://gh"), "ghe.acme.test": work } },
    bitbucket: { accessToken: personal("op://bb") },
  },
});

it.each([
  ["personal", ["GitHub · github.com", "Bitbucket · Access token"]],
  ["work", ["GitHub · ghe.acme.test"]],
  ["unused", []],
])("lists what reads from secret provider %s", (providerId, uses) => {
  expect(secretProviderUses(settings, providerId).map((use) => use.label)).toEqual(uses);
});
