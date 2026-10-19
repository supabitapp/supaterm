import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils.js";
import * as Schema from "effect/Schema";

export const RELAY_COMPANION_META_NAME = "supaterm-relay-companion";
export const RELAY_COMPANION_REQUEST_LIMIT = 64;
export const RELAY_ERROR_HEADER = "x-supaterm-relay-error";
export const RelayTunnelFailure = Schema.Literals([
  "host-offline",
  "relay-busy",
  "relay-timeout",
  "relay-unreachable",
]);
export type RelayTunnelFailure = typeof RelayTunnelFailure.Type;
const suffix = ".relay.supaterm.alt";
const legacySuffix = ".relay.supaterm.invalid";
const legacyRelayHost = /([0-9a-f]{32}\.[0-9a-f]{32})\.relay\.supaterm\.invalid(?![\w.-])/g;
const encoder = new TextEncoder();
export const encodeBase64 = (data: Uint8Array): string => {
  let value = "";
  for (let i = 0; i < data.length; i += 8192) {
    value += String.fromCharCode(...data.subarray(i, i + 8192));
  }
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
export const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid relay encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
};
export const relayPublicKey = (secret: Uint8Array) => ed25519.getPublicKey(secret);
export const relayEndpointId = (publicKey: Uint8Array) => bytesToHex(sha256(publicKey));
export const relayHttpBaseUrl = (publicKey: Uint8Array) => {
  const hex = bytesToHex(publicKey);
  return `https://${hex.slice(0, 32)}.${hex.slice(32)}${suffix}/`;
};
export const parseRelayAddress = (input: string): Uint8Array | null => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const matched = [suffix, legacySuffix].find((value) => url.hostname.endsWith(value));
  if (matched === undefined) return null;
  if (!["https:", "wss:"].includes(url.protocol) || url.port || url.username || url.password) {
    throw new Error("Invalid relay address");
  }
  const key = url.hostname.slice(0, -matched.length);
  if (!/^[0-9a-f]{32}\.[0-9a-f]{32}$/.test(key)) throw new Error("Invalid relay identity");
  return hexToBytes(key.replace(".", ""));
};
export const canonicalRelayAddress = (input: string): string | null => {
  const publicKey = parseRelayAddress(input);
  return publicKey === null ? null : new URL(relayHttpBaseUrl(publicKey)).origin;
};
export const upgradeRelayAddresses = (text: string): string =>
  text.replace(legacyRelayHost, `$1${suffix}`);
export const signRelayChallenge = (secret: Uint8Array, nonce: string) =>
  encodeBase64(
    ed25519.sign(
      encoder.encode(`supaterm-relay-v1\n${relayEndpointId(relayPublicKey(secret))}\n${nonce}`),
      secret,
    ),
  );

const Version = Schema.Literal(2);
const Hello = Schema.Struct({
  type: Schema.Literal("hello"),
  version: Version,
  key: Schema.String,
});
const Welcome = Schema.Struct({
  type: Schema.Literal("welcome"),
  version: Version,
  key: Schema.String,
  signature: Schema.String,
});
const decodeHello = Schema.decodeUnknownSync(Hello);
const decodeWelcome = Schema.decodeUnknownSync(Welcome);
const keyBytes = (value: string) => {
  const key = decodeBase64(value);
  if (key.length !== 32) throw new Error("Invalid relay key");
  return key;
};
const transcript = (identity: Uint8Array, client: Uint8Array, host: Uint8Array, version: 2) =>
  concatBytes(encoder.encode(`supaterm-tunnel-v${version}\n`), identity, client, host);

function createRelayCipher(shared: Uint8Array, context: Uint8Array, host: boolean) {
  const keys = hkdf(
    sha256,
    shared,
    sha256(context),
    encoder.encode("supaterm-tunnel-traffic-v1"),
    64,
  );
  shared.fill(0);
  const sendKey = keys.slice(host ? 32 : 0, host ? 64 : 32);
  const receiveKey = keys.slice(host ? 0 : 32, host ? 32 : 64);
  keys.fill(0);
  let sent = 0n;
  let received = 0n;
  let destroyed = false;
  const encrypt = (plain: Uint8Array) => {
    if (destroyed) throw new Error("Relay channel closed");
    if (sent >= 1n << 64n) throw new Error("Relay sequence exhausted");
    const nonce = new Uint8Array(12);
    new DataView(nonce.buffer).setBigUint64(4, sent++);
    return Uint8Array.from(
      concatBytes(nonce.subarray(4), chacha20poly1305(sendKey, nonce).encrypt(plain)),
    );
  };
  return {
    seal: encrypt,
    open(frame: Uint8Array, maxPlainBytes: number) {
      if (destroyed || frame.length < 24 || frame.length > maxPlainBytes + 24)
        throw new Error("Invalid relay frame");
      const sequence = new DataView(frame.buffer, frame.byteOffset, 8).getBigUint64(0);
      if (sequence !== received) throw new Error("Relay frame out of order");
      const nonce = new Uint8Array(12);
      nonce.set(frame.subarray(0, 8), 4);
      const plain = chacha20poly1305(receiveKey, nonce).decrypt(frame.subarray(8));
      received++;
      return plain;
    },
    destroy() {
      destroyed = true;
      sendKey.fill(0);
      receiveKey.fill(0);
    },
  };
}
export type RelayCipher = ReturnType<typeof createRelayCipher>;

export function createClientHandshake(
  identity: Uint8Array,
  randomBytes: (size: number) => Uint8Array,
  version: 2 = 2,
) {
  const secret = randomBytes(32);
  const publicKey = x25519.getPublicKey(secret);
  return {
    hello: JSON.stringify({ type: "hello", version, key: encodeBase64(publicKey) }),
    finish(raw: string) {
      try {
        const welcome = decodeWelcome(JSON.parse(raw));
        if (welcome.version !== version) throw new Error("Relay protocol mismatch");
        const host = keyBytes(welcome.key);
        const context = transcript(identity, publicKey, host, version);
        if (
          !ed25519.verify(decodeBase64(welcome.signature), context, identity, { zip215: false })
        ) {
          throw new Error("Relay host identity mismatch");
        }
        return createRelayCipher(x25519.getSharedSecret(secret, host), context, false);
      } finally {
        secret.fill(0);
      }
    },
    destroy() {
      secret.fill(0);
    },
  };
}
export function acceptClientHandshake(
  raw: string,
  identitySecret: Uint8Array,
  randomBytes: (size: number) => Uint8Array,
) {
  const hello = decodeHello(JSON.parse(raw));
  const client = keyBytes(hello.key);
  const secret = randomBytes(32);
  try {
    const publicKey = x25519.getPublicKey(secret);
    const context = transcript(relayPublicKey(identitySecret), client, publicKey, hello.version);
    return {
      version: hello.version,
      welcome: JSON.stringify({
        type: "welcome",
        version: hello.version,
        key: encodeBase64(publicKey),
        signature: encodeBase64(ed25519.sign(context, identitySecret)),
      }),
      cipher: createRelayCipher(x25519.getSharedSecret(secret, client), context, true),
    };
  } finally {
    secret.fill(0);
  }
}
