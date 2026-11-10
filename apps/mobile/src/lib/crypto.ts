import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as ExpoCrypto from "expo-crypto";

function toExpoDigestAlgorithm(algorithm: Digest.Algorithm): ExpoCrypto.CryptoDigestAlgorithm {
  switch (algorithm.name) {
    case "MD5":
      return ExpoCrypto.CryptoDigestAlgorithm.MD5;
    case "SHA-1":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA1;
    case "SHA-256":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA256;
    case "SHA-384":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA384;
    case "SHA-512":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA512;
  }
}

// Hermes has no SubtleCrypto, so Effect's WebCrypto layers cannot back these services.
const digest = (algorithm: Digest.Algorithm, data: Uint8Array) =>
  Effect.promise(async () => {
    const input = new Uint8Array(data.length);
    input.set(data);
    return new Uint8Array(await ExpoCrypto.digest(toExpoDigestAlgorithm(algorithm), input));
  });

export const cryptoLayer = Layer.mergeAll(
  Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(ExpoCrypto.getRandomBytes)),
  Layer.succeed(
    Digest.Digest,
    Digest.Digest.of({
      digest,
      digestHex: Effect.fn("Digest.Digest.digestHex")((algorithm, data) =>
        Effect.map(digest(algorithm, data), Hex.encode),
      ),
    }),
  ),
);
