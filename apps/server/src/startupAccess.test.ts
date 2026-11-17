import { expect, it } from "@effect/vitest";
import * as NetAddress from "effect/net/NetAddress";

import { loopbackUrlHostForAddress, resolveHeadlessConnectionString } from "./startupAccess.ts";

it("resolves wildcard hosts to a concrete external interface when one is available", () => {
  const connectionString = resolveHeadlessConnectionString("0.0.0.0", 3773, {
    en0: [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.42/24",
      },
    ],
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  });

  expect(connectionString).toBe("http://192.168.1.42:3773");
});

it("targets the bound interface when the listener binds a specific address", () => {
  const hostFor = (ip: string) =>
    loopbackUrlHostForAddress(NetAddress.inetAddressFromIpStringUnsafe(ip, 3773));

  expect(hostFor("0.0.0.0")).toBe("127.0.0.1");
  expect(hostFor("::")).toBe("127.0.0.1");
  expect(hostFor("::1")).toBe("[::1]");
  expect(hostFor("127.0.0.1")).toBe("127.0.0.1");
  expect(hostFor("127.0.0.2")).toBe("127.0.0.2");
  expect(hostFor("100.101.102.103")).toBe("100.101.102.103");
});
