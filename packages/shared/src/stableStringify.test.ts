import { describe, expect, it } from "@effect/vitest";

import { stableStringify } from "./stableStringify.ts";

describe("stableStringify", () => {
  it("orders keys by code units regardless of locale", () => {
    expect(stableStringify({ y: "four", x: "three", kty: "two", crv: "one" })).toBe(
      '{"crv":"one","kty":"two","x":"three","y":"four"}',
    );
    expect(stableStringify({ a: 3, Z: 2, A: 1, ä: 4 })).toBe('{"A":1,"Z":2,"a":3,"ä":4}');
  });

  it("canonicalizes object keys recursively", () => {
    expect(
      stableStringify({
        z: 1,
        a: {
          y: true,
          b: null,
        },
        list: [{ c: "three", a: "one" }],
      }),
    ).toBe('{"a":{"b":null,"y":true},"list":[{"a":"one","c":"three"}],"z":1}');
  });
});
