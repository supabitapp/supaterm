import { describe, expect, it } from "vite-plus/test";

import { draftSupportedRuntimeModes } from "./runtimeModeConfig";

describe("draftSupportedRuntimeModes", () => {
  const supervisedOnly = {
    instanceId: "fx",
    supportedRuntimeModes: ["approval-required"],
  } as const;
  const noAuto = {
    instanceId: "muse",
    supportedRuntimeModes: ["approval-required", "full-access"],
  } as const;
  const everyMode = { instanceId: "codex" };
  const providers = [supervisedOnly, noAuto, everyMode];

  it.each([
    { label: "one provider that supports it", selections: [supervisedOnly, noAuto] },
    { label: "a provider that reports no modes", selections: [supervisedOnly, everyMode] },
  ])("shows Full access when a multi-model draft includes $label", ({ selections }) => {
    const modes = draftSupportedRuntimeModes(
      supervisedOnly.supportedRuntimeModes,
      selections,
      providers,
    );
    expect(modes === undefined || modes.includes("full-access")).toBe(true);
  });

  it("falls back only when no selected provider can run the mode", () => {
    const modes = draftSupportedRuntimeModes(undefined, [supervisedOnly, noAuto], providers);
    expect(modes).toEqual(["approval-required", "full-access"]);
  });
});
