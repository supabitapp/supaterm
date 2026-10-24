import { describe, expect, it } from "vite-plus/test";

import { pushChallengeFromPayload, pushRouteFromData, pushRouteHref } from "./notificationPayload";

describe("notification payloads", () => {
  it("reads the route the notification service extension wrote", () => {
    const route = pushRouteFromData({
      environmentId: "environment 1",
      threadId: "thread/2",
      kind: "approval",
    });
    expect(route).toEqual({ environmentId: "environment 1", threadId: "thread/2" });
    expect(pushRouteHref(route!)).toBe("/threads/environment%201/thread%2F2");
  });

  it("opens Home for notifications without a thread", () => {
    expect(pushRouteHref(pushRouteFromData({ environmentId: "e", threadId: "" })!)).toBe("/");
  });

  it("ignores data that is not a route", () => {
    expect(pushRouteFromData(undefined)).toBeNull();
    expect(pushRouteFromData({ environmentId: "", threadId: "t" })).toBeNull();
    expect(pushRouteFromData({ environmentId: 1, threadId: "t" })).toBeNull();
  });

  it("reads gateway challenges from the APNs payload", () => {
    expect(
      pushChallengeFromPayload({
        aps: { alert: { title: "Supaterm" } },
        supatermChallenge: { enrollmentId: "enrollment", code: "code" },
      }),
    ).toEqual({ enrollmentId: "enrollment", code: "code" });
    expect(pushChallengeFromPayload({ supaterm: {} })).toBeNull();
    expect(pushChallengeFromPayload(undefined)).toBeNull();
  });
});
