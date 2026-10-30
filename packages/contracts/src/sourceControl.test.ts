import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SourceControlProviderDiscoveryItem } from "./sourceControl.ts";

const discoveryJson = Schema.toCodecJson(SourceControlProviderDiscoveryItem);
const decodeDiscovery = Schema.decodeUnknownSync(discoveryJson);
const encodeDiscovery = Schema.encodeSync(discoveryJson);

const provider = {
  kind: "github",
  label: "GitHub",
  status: "available",
  version: { _tag: "None" },
  installHint: "Configure a credential",
  detail: { _tag: "None" },
  auth: {
    status: "unauthenticated",
    account: { _tag: "None" },
    host: { _tag: "None" },
    detail: { _tag: "None" },
  },
};
const metadata = {
  appName: "Team source control",
  hosts: ["github.com", "git.example.com:8443"],
  installUrl: "https://github.com/apps/team-source-control/installations/new",
  revokeUrl: "https://github.com/settings/installations",
};

describe("source control app sign-in discovery", () => {
  it("preserves configured metadata through the discovery wire codec", () => {
    const input = { ...provider, appSignIn: true, appSignInMetadata: metadata };
    expect(encodeDiscovery(decodeDiscovery(input))).toEqual(input);
  });

  it("reads older discovery responses without inventing app metadata", () => {
    expect(encodeDiscovery(decodeDiscovery(provider))).toEqual(provider);
    const legacy = { ...provider, appSignIn: true };
    expect(encodeDiscovery(decodeDiscovery(legacy))).toEqual(legacy);
  });

  it.each([
    { appName: " " },
    { hosts: [] },
    { hosts: ["https://git.example.com"] },
    { hosts: ["user@git.example.com"] },
    { installUrl: "" },
    { installUrl: "javascript:alert(1)" },
    { installUrl: "http://github.com/apps/team-source-control/installations/new" },
    { revokeUrl: "https://user:password@github.com/settings/installations" },
  ])("rejects invalid app metadata: %j", (change) => {
    expect(() =>
      decodeDiscovery({
        ...provider,
        appSignIn: true,
        appSignInMetadata: { ...metadata, ...change },
      }),
    ).toThrow();
  });
});
