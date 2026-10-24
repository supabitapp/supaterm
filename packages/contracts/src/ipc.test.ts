import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DesktopAppBrandingSchema } from "./ipc.ts";

describe("DesktopAppBrandingSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopAppBrandingSchema);

  it("preserves the absent stage for stable desktop branding", () => {
    expect(decode({ baseName: "Supaterm", stageLabel: null, displayName: "Supaterm" })).toEqual({
      baseName: "Supaterm",
      stageLabel: null,
      displayName: "Supaterm",
    });
  });
});
