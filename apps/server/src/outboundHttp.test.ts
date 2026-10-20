// @effect-diagnostics nodeBuiltinImport:off - the test runs a real TLS h2 server to see which protocol fetch negotiates.
import * as NodeHttp2 from "node:http2";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Undici from "undici";
import { afterAll, afterEach, beforeAll, describe, expect } from "vite-plus/test";

import {
  builtinFetchUsesHttp2,
  extendConnectionAttemptTimeout,
  installHttp1FetchDispatcher,
} from "./outboundHttp.ts";

// Test-only self-signed P-256 certificate for 127.0.0.1, valid until 2126; not a
// secret. Node cannot mint X.509 certificates without a library, and a local
// server only offers h2 over ALPN, which needs TLS.
const TEST_KEY = /* gitleaks:allow */ `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg8e4dOUdMq8iWvH9K
6K3ET1o297gQai0AsFExFcotrLChRANCAATFqviWypuKNNdHFGSOweNN2+AFHCbN
CTYJ50ZJbE+y7SoouEFVcE76hDRg9Gcv3AV6ZrK0pwSeDUfi0GXj7H9z
-----END PRIVATE KEY-----
`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBkzCCATmgAwIBAgIUC4wkgJP6TozJiHvQ+UA/MEGSes0wCgYIKoZIzj0EAwIw
JjEkMCIGA1UEAwwbc3VwYXRlcm0gb3V0Ym91bmQgaHR0cCB0ZXN0MCAXDTI2MTAx
NjE3MDU0NloYDzIxMjYwOTIyMTcwNTQ2WjAmMSQwIgYDVQQDDBtzdXBhdGVybSBv
dXRib3VuZCBodHRwIHRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATFqviW
ypuKNNdHFGSOweNN2+AFHCbNCTYJ50ZJbE+y7SoouEFVcE76hDRg9Gcv3AV6ZrK0
pwSeDUfi0GXj7H9zo0MwQTAPBgNVHREECDAGhwR/AAABMA8GA1UdEwEB/wQFMAMB
Af8wHQYDVR0OBBYEFA80osh1DPu558KjqgiUqeMR7yLZMAoGCCqGSM49BAMCA0gA
MEUCIQC4f2ud7aURCnKxqnlNItObCd9YrD2U96YVMKgXGgzOvQIgcGTEV+NwF3Cy
SWtxwtr8RbC5xrm7TTYul3G9SPCvNS0=
-----END CERTIFICATE-----
`;

const server = NodeHttp2.createSecureServer(
  { allowHTTP1: true, key: TEST_KEY, cert: TEST_CERT },
  (request, response) => response.end(request.httpVersion),
);
let origin = "";
const defaultCaCertificates = NodeTls.getCACertificates("default");
const defaultDispatcher = Undici.getGlobalDispatcher();
const defaultAttemptTimeout = NodeNet.getDefaultAutoSelectFamilyAttemptTimeout();

beforeAll(async () => {
  NodeTls.setDefaultCACertificates([...defaultCaCertificates, TEST_CERT]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}/`;
});

afterEach(() => {
  Undici.setGlobalDispatcher(defaultDispatcher);
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(defaultAttemptTimeout);
});

afterAll(async () => {
  NodeTls.setDefaultCACertificates(defaultCaCertificates);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const versionViaGlobalDispatcher = async () => (await Undici.request(origin)).body.text();

const versionViaBuiltinFetch = () =>
  HttpClient.get(origin).pipe(
    Effect.flatMap((response) => response.text),
    Effect.provide(FetchHttpClient.layer),
  );

describe("installHttp1FetchDispatcher", () => {
  it("makes the global dispatcher negotiate HTTP/1.1 and keeps the env proxy agent", async () => {
    Undici.setGlobalDispatcher(new Undici.Agent());
    expect(await versionViaGlobalDispatcher()).toBe("2.0");

    installHttp1FetchDispatcher();
    expect(await versionViaGlobalDispatcher()).toBe("1.1");

    Undici.setGlobalDispatcher(new Undici.EnvHttpProxyAgent());
    installHttp1FetchDispatcher();
    expect(Undici.getGlobalDispatcher()).toBeInstanceOf(Undici.EnvHttpProxyAgent);
  });

  // Only a runtime that bundles undici 8 (Node 26+) offers h2 through the
  // built-in fetch, so only there can this prove fetch reads the new dispatcher.
  it.effect.runIf(builtinFetchUsesHttp2(process.versions.undici))(
    "moves the built-in fetch off HTTP/2",
    () =>
      Effect.gen(function* () {
        expect(yield* versionViaBuiltinFetch()).toBe("2.0");
        installHttp1FetchDispatcher();
        expect(yield* versionViaBuiltinFetch()).toBe("1.1");
      }),
  );
});

describe("extendConnectionAttemptTimeout", () => {
  it("raises a default below the floor to 1000 ms", () => {
    NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(50);
    extendConnectionAttemptTimeout();
    expect(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(1_000);
  });

  it("keeps a larger configured timeout", () => {
    NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(5_000);
    extendConnectionAttemptTimeout();
    expect(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(5_000);
  });
});
