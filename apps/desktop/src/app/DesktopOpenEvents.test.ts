import { expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { make, type DesktopOpenEvent } from "./DesktopOpenEvents.ts";

it.effect("captures supported OS events synchronously and drains them in arrival order", () =>
  Effect.gen(function* () {
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const app = {
      on: (name: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            listeners.set(name, listener);
          }),
          () =>
            Effect.sync(() => {
              listeners.delete(name);
            }),
        ).pipe(Effect.asVoid),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const scope = yield* Scope.make();
    const events = yield* make(false).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(ElectronApp.ElectronApp, app),
      Effect.provideService(HostProcess.Platform, "darwin"),
    );
    let prevented = 0;
    const event = {
      preventDefault: () => {
        prevented++;
      },
    };
    listeners.get("open-file")!(event, "/tmp/first.html");
    listeners.get("open-url")!(event, "supaterm://new?prompt=hello");
    listeners.get("second-instance")!({}, ["supaterm", "https://example.com/last"]);
    listeners.get("open-url")!(event, "mailto:ignored@example.com");
    expect(prevented).toBe(2);
    const received: DesktopOpenEvent[] = [];
    yield* events
      .subscribe((entry) => received.push(entry))
      .pipe(Effect.provideService(Scope.Scope, scope));
    expect(received).toEqual([
      { type: "file", path: "/tmp/first.html" },
      { type: "url", url: "supaterm://new?prompt=hello" },
      { type: "second-instance", argv: ["supaterm", "https://example.com/last"] },
    ]);
    listeners.get("open-url")!(event, "https://example.com/live");
    expect(received.at(-1)).toEqual({ type: "url", url: "https://example.com/live" });
    yield* Scope.close(scope, Exit.void);
    expect(listeners.size).toBe(0);
  }),
);
