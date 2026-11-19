import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const FxSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("fx").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the fx binary. All fx instances on this machine share its fx login.",
        providerSettingsForm: { placeholder: "fx", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type FxSettings = typeof FxSettings.Type;
