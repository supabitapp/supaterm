import * as Config from "effect/Config";
import * as Option from "effect/Option";

export interface NotaryCredentials {
  readonly key: string;
  readonly keyId: string;
  readonly issuer: string;
}

const nonEmpty = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(Option.filter((value) => value.trim() !== "")),
  );

/**
 * Developer ID signing and notarization for release artifacts built outside
 * electron-builder. Without an identity the artifact is signed ad hoc ("-"),
 * and without App Store Connect credentials it is signed but not notarized.
 */
export const MacSigningConfig = Config.all({
  identity: nonEmpty("SUPATERM_MAC_SIGN_IDENTITY"),
  key: nonEmpty("APPLE_API_KEY"),
  keyId: nonEmpty("APPLE_API_KEY_ID"),
  issuer: nonEmpty("APPLE_API_ISSUER"),
}).pipe(
  Config.map(({ identity, key, keyId, issuer }) => ({
    identity: Option.getOrElse(
      Option.map(identity, (value) => value.trim()),
      () => "-",
    ),
    notary: Option.getOrUndefined(Option.all({ key, keyId, issuer })),
  })),
);

export function codesignArgs(identity: string, target: string, extra: ReadonlyArray<string> = []) {
  return [
    "--force",
    "--sign",
    identity,
    ...(identity === "-" ? [] : ["--options", "runtime", "--timestamp"]),
    ...extra,
    target,
  ];
}

export function notarytoolSubmitArgs(path: string, notary: NotaryCredentials) {
  return [
    "notarytool",
    "submit",
    path,
    "--key",
    notary.key,
    "--key-id",
    notary.keyId,
    "--issuer",
    notary.issuer,
    "--wait",
  ];
}
