import { describe, expect, it } from "vite-plus/test";

import {
  buildPairingUrl,
  extractPairingUrlFromQrPayload,
  parsePairingUrl,
  pairingUrlForFields,
} from "./pairing";

describe("buildPairingUrl", () => {
  it("uses HTTP for a schemeless IP address", () => {
    expect(buildPairingUrl("192.168.1.100:3773", "pairing-token")).toBe(
      "http://192.168.1.100:3773/#token=pairing-token",
    );
  });

  it("keeps HTTPS as the default for a schemeless hostname", () => {
    expect(buildPairingUrl("remote.example.com", "pairing-token")).toBe(
      "https://remote.example.com/#token=pairing-token",
    );
  });

  it("preserves an explicit scheme for an IP address", () => {
    expect(buildPairingUrl("https://192.168.1.100:3773", "pairing-token")).toBe(
      "https://192.168.1.100:3773/#token=pairing-token",
    );
  });
});

describe("extractPairingUrlFromQrPayload", () => {
  it("unwraps mobile deep links that carry an encoded pairing url", () => {
    expect(
      extractPairingUrlFromQrPayload(
        "supaterm://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
      ),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });
});

describe("parsePairingUrl", () => {
  it("preserves scanned or pasted route metadata until the host or token is edited", () => {
    const original =
      "http://192.168.1.10:3773/pair#token=code&env=machine&routes=https://machine.ts.net";
    const fields = parsePairingUrl(original);
    expect(pairingUrlForFields(fields.host, fields.code, original)).toBe(original);
    expect(pairingUrlForFields("https://new.test", fields.code, original)).toBe(
      "https://new.test/#token=code",
    );
    expect(pairingUrlForFields(fields.host, "new-code", original)).toBe(
      "http://192.168.1.10:3773/#token=new-code",
    );
    const wrapper = `supaterm://pair?pairingUrl=${encodeURIComponent(original)}`;
    expect(extractPairingUrlFromQrPayload(wrapper)).toBe(original);
  });
  it("reads hosted pairing links into backend host fields", () => {
    expect(
      parsePairingUrl(
        "https://app.supaterm.com/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=pairing-token",
      ),
    ).toEqual({
      host: "https://desktop.tailnet.ts.net",
      code: "pairing-token",
    });
  });
});
