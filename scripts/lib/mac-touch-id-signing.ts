// @effect-diagnostics nodeBuiltinImport:off - Packaging resolves the signing library's default entitlement resource.
import * as NodeModule from "node:module";
import * as Plist from "plist";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const decodeProfile = Schema.decodeUnknownEffect(
  Schema.Struct({
    TeamIdentifier: Schema.Array(Schema.String),
    Entitlements: Schema.Struct({
      "keychain-access-groups": Schema.optional(Schema.Array(Schema.String)),
    }),
  }),
);
const decodeEntitlements = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Boolean));

export const prepareMacTouchIdSigning = Effect.fn("prepareMacTouchIdSigning")(function* (input: {
  readonly platform: string;
  readonly signed: boolean;
  readonly repoRoot: string;
  readonly stageAppDir: string;
  readonly appId: string;
}) {
  if (input.platform !== "mac" || !input.signed) return;
  const provisioningProfile = yield* Config.String("SUPATERM_MACOS_PROVISIONING_PROFILE").pipe(
    Config.option,
  );
  if (Option.isNone(provisioningProfile) || provisioningProfile.value.trim().length === 0) return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profilePath = path.resolve(input.repoRoot, provisioningProfile.value);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const xml = yield* spawner.string(
    ChildProcess.make("security", ["cms", "-D", "-i", profilePath]),
  );
  const parsedProfile = yield* Effect.try(() => Plist.parse(xml));
  const profile = yield* decodeProfile(parsedProfile);
  const teamId = profile.TeamIdentifier[0];
  if (teamId && /^[A-Z0-9]{10}$/.test(teamId)) {
    const keychainGroup = `${teamId}.${input.appId}.webauthn`;
    const authorized = (profile.Entitlements["keychain-access-groups"] ?? []).some((group) =>
      group.endsWith("*") ? keychainGroup.startsWith(group.slice(0, -1)) : group === keychainGroup,
    );
    if (authorized) {
      const entitlementsPath = path.join(input.stageAppDir, "entitlements.mac.plist");
      const defaultEntitlements = yield* fs
        .readFileString(
          NodeModule.createRequire(import.meta.url).resolve(
            "@electron/osx-sign/entitlements/default.darwin.plist",
          ),
        )
        .pipe(
          Effect.flatMap((xml) => Effect.try(() => Plist.parse(xml))),
          Effect.flatMap(decodeEntitlements),
        );
      yield* fs.writeFileString(
        entitlementsPath,
        Plist.build({
          ...defaultEntitlements,
          "com.apple.application-identifier": `${teamId}.${input.appId}`,
          "com.apple.developer.team-identifier": teamId,
          "keychain-access-groups": [keychainGroup],
          "com.apple.security.cs.allow-jit": true,
          "com.apple.security.cs.allow-unsigned-executable-memory": true,
          "com.apple.security.cs.disable-library-validation": true,
          "com.apple.security.device.audio-input": true,
        }),
      );
      yield* Effect.log("[desktop-artifact] Touch ID passkeys enabled.");
      return {
        entitlementsPath,
        provisioningProfilePath: profilePath,
        touchIdKeychainAccessGroup: keychainGroup,
      };
    }
  }
  yield* Effect.log("[desktop-artifact] Touch ID passkeys disabled.");
});
