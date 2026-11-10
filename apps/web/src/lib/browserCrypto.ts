import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Layer from "effect/Layer";

export const browserCryptoLayer = Layer.mergeAll(
  SecureRandom.layerWebCrypto,
  Digest.layerWebCrypto,
);
