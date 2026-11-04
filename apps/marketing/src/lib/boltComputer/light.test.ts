import { describe, expect, it } from "vite-plus/test";

import { radiance } from "./light";

const plastic = { albedo: [0.7, 0.68, 0.6], f0: 0.04, spec: 0.2, shininess: 14, rim: 0.5 } as const;

describe("radiance", () => {
  it("stays finite for a normal rounded just past unit length toward the viewer", () => {
    expect(radiance(plastic, 0, 0, 1.00000002).every(Number.isFinite)).toBe(true);
  });
});
