import * as HostProcess from "@supaterm/shared/HostProcess";
import * as SharedObservability from "@supaterm/shared/observability";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redactable from "effect/Redactable";
import * as References from "effect/References";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpLogger from "effect/observability/OtlpLogger";

import * as ServerConfig from "./config.ts";

const redactingCredentials = <Output>(logger: Logger.Logger<unknown, Output>) =>
  Logger.make<unknown, Output>((options) =>
    logger.log({ ...options, cause: SharedObservability.redactCauseCredentials(options.cause) }),
  );

const consolePretty = () => {
  const pretty = redactingCredentials(Logger.consolePretty());
  return Logger.make((options) =>
    pretty.log({
      ...options,
      message: Array.isArray(options.message)
        ? options.message.map(prettyCauseFields)
        : prettyCauseFields(options.message),
    }),
  );
};

function prettyCauseFields(value: unknown): unknown;
function prettyCauseFields(value: unknown) {
  if (typeof value !== "object" || value === null) return value satisfies unknown;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value satisfies unknown;

  if (Redactable.isRedactable(value)) return value satisfies unknown;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  let changed = false;
  for (const descriptor of Object.values(descriptors)) {
    if ("value" in descriptor && Cause.isCause(descriptor.value)) {
      descriptor.value = SharedObservability.redactUrlCredentials(Cause.pretty(descriptor.value));
      changed = true;
    }
  }
  return (changed ? Object.create(prototype, descriptors) : value) satisfies unknown;
}

export const layer = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const hostName = yield* HostProcess.Hostname;
  const layerMinimumLogLevel = Layer.succeed(References.MinimumLogLevel, config.logLevel);

  const logs = config.otlpLogsExport;
  const otlpLogger =
    config.otlpLogsUrl === undefined
      ? undefined
      : OtlpLogger.make({
          url: config.otlpLogsUrl,
          exportInterval: `${logs.exportIntervalMs} millis`,
          headers: logs.headers,
          resource: ServerConfig.otlpResource(config, hostName),
        }).pipe(Effect.map(redactingCredentials));

  const layerLogger = Logger.layer(
    otlpLogger === undefined
      ? [consolePretty(), Logger.tracerLogger]
      : [consolePretty(), otlpLogger],
    { mergeWithExisting: false },
  ).pipe(
    Layer.provide(OtlpExporter.layerFlusher),
    Layer.provide(SharedObservability.layerOtlpSerialization(logs.protocol)),
  );

  return Layer.mergeAll(layerLogger, layerMinimumLogLevel);
}).pipe(Layer.unwrap);
