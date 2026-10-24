import { EnvironmentId } from "@supaterm/contracts";
import { assert, it } from "@effect/vitest";

import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import {
  applyShowcaseLocalEnvironmentDisplayUrls,
  resolveShowcaseEnvironmentUpdateDisplayUrl,
} from "./showcaseEnvironmentRows";

function environment(
  environmentId: string,
  environmentLabel: string,
  displayUrl = "http://127.0.0.1:3773/",
): ConnectedEnvironmentSummary {
  return {
    environmentId: EnvironmentId.make(environmentId),
    environmentLabel,
    displayUrl,
    isEnabled: true,
    connectionState: "connected",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("presents showcase transports as remote endpoints", () => {
  const environments = applyShowcaseLocalEnvironmentDisplayUrls([
    environment("runtime-id-1", "Studio Laptop"),
    environment("runtime-id-2", "Basement Tower"),
    environment("runtime-id-3", "Helsinki VPS"),
  ]);

  assert.deepStrictEqual(
    environments.map(({ displayUrl }) => displayUrl),
    ["https://studio.tailb37e.ts.net/", "http://192.168.1.40:3773/", "https://vps.supaterm.com/"],
  );
});

it("does not persist a cosmetic showcase URL when only the label is saved", () => {
  assert.equal(
    resolveShowcaseEnvironmentUpdateDisplayUrl({
      actualDisplayUrl: "http://127.0.0.1:3773/",
      presentedDisplayUrl: "https://studio.tailb37e.ts.net/",
      submittedDisplayUrl: "https://studio.tailb37e.ts.net/",
    }),
    "http://127.0.0.1:3773/",
  );
  assert.equal(
    resolveShowcaseEnvironmentUpdateDisplayUrl({
      actualDisplayUrl: "http://127.0.0.1:3773/",
      presentedDisplayUrl: "https://studio.tailb37e.ts.net/",
      submittedDisplayUrl: "https://new-host.example.com/",
    }),
    "https://new-host.example.com/",
  );
});
