import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class JsignFailedError extends Schema.TaggedError<JsignFailedError>()("JsignFailedError", {
  file: Schema.String,
  exitCode: Schema.Number,
}) {
  override get message() {
    return `jsign exited with code ${String(this.exitCode)} signing ${this.file}.`;
  }
}

export const signWithJsign = Effect.fn("signWithJsign")(function* (file: string) {
  const { jsign, endpoint, account, profile } = yield* Config.all({
    jsign: Config.String("SUPATERM_JSIGN").pipe(Config.withDefault("jsign")),
    endpoint: Config.String("AZURE_TRUSTED_SIGNING_ENDPOINT"),
    account: Config.String("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
    profile: Config.String("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
  });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(
      jsign,
      [
        "--storetype",
        "TRUSTEDSIGNING",
        "--keystore",
        new URL(endpoint).host,
        "--alias",
        `${account}/${profile}`,
        "--alg",
        "SHA-256",
        "--tsaurl",
        "http://timestamp.acs.microsoft.com",
        "--tsmode",
        "RFC3161",

        "--replace",
        file,
      ],
      { stdout: "inherit", stderr: "inherit" },
    ),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new JsignFailedError({ file, exitCode });
  }
});

export default function sign(configuration: { readonly path: string }): Promise<void> {
  return signWithJsign(configuration.path).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );
}
