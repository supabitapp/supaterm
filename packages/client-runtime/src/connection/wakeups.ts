import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

export type ConnectionWakeup =
  | "application-active"
  | "application-resumed"
  | "application-background"
  | "network-changed";

export function shouldResubscribeAfterWakeup(reason: ConnectionWakeup): boolean {
  return reason === "application-active" || reason === "application-resumed";
}

export class ConnectionWakeups extends Context.Service<
  ConnectionWakeups,
  {
    readonly changes: Stream.Stream<ConnectionWakeup>;
    readonly isBackgrounded?: Effect.Effect<boolean>;
  }
>()("@supaterm/client-runtime/connection/wakeups/ConnectionWakeups") {}

const make = (service: ConnectionWakeups["Service"]) => ConnectionWakeups.of(service);

export const layer = (service: ConnectionWakeups["Service"]) =>
  Layer.succeed(ConnectionWakeups, make(service));
