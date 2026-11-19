import * as Crypto from "expo-crypto";

export const uuidv4 = () => Crypto.randomUUID();

export const randomHex = (byteLength: number) =>
  Array.from(Crypto.getRandomBytes(byteLength), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
