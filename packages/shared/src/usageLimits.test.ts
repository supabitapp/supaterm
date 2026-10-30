import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type LimitAccount,
  collectProviderUsageLimits,
  withUsageLimitsCommands,
  collectLimitAccounts,
  collectExternalUsageLinks,
  collectLimitNotices,
  collectLimitPools,
  elapsedShare,
  headlineUsageWindows,
  paceOf,
  paceRemainingPercent,
  usesChatGptSharing,
} from "./usageLimits.ts";

const now = Date.parse("2026-09-03T12:00:00.000Z");

const window = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-03T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("pace", () => {
  it("places the clock three fifths through a five-hour window with two hours left", () => {
    expect(elapsedShare(window, now)).toBeCloseTo(0.6);
    expect(paceRemainingPercent(window, now)).toBe(40);
    expect(paceOf(window, now)).toBe("under");
    expect(paceOf({ ...window, usedPercent: 62 }, now)).toBe("on");
    expect(paceOf({ ...window, usedPercent: 80 }, now)).toBe("ahead");
  });
});

describe("pools", () => {
  const checkedAt = "2026-09-03T11:00:00.000Z";
  const weekly = {
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    windowDurationMins: 7 * 24 * 60,
    resetsAt: "2026-09-06T12:00:00.000Z",
  } as const;
  const claude = ProviderDriverKind.make("claudeAgent");
  const laptop = { entry: { target: { label: "Laptop" } } };

  it("merges one account reported on two environments into one entry", () => {
    const native = provider({
      driver: claude,
      instanceId: ProviderInstanceId.make("claude"),
      auth: { status: "authenticated", email: "Same@example.com" },
      usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 40 }] },
    });
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [native] } }],
      [
        EnvironmentId.make("env-b"),
        {
          entry: { target: { label: "Desktop" } },
          serverConfig: {
            providers: [
              {
                ...native,
                usageLimits: {
                  checkedAt: "2026-09-03T11:30:00.000Z",
                  windows: [{ ...window, usedPercent: 55 }],
                },
              },
            ],
          },
        },
      ],
    ]);
    const accounts = collectLimitAccounts(input);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      key: "env-a:claude",
      redeem: { environmentId: "env-b", input: { instanceId: "claude" } },
      environments: [
        { environmentId: "env-a", label: "Laptop" },
        { environmentId: "env-b", label: "Desktop" },
      ],
    });
    expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(55);
  });

  it("merges OpenCode Go limits from machines with the same API key", () => {
    const go = provider({
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode"),
      auth: { status: "authenticated" },
      usageLimits: {
        checkedAt,
        credentialFingerprint: "shared-go-key",
        windows: [{ ...window, id: "go_rolling", usedPercent: 3 }],
      },
    });
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [go] } }],
      [
        EnvironmentId.make("env-b"),
        {
          entry: { target: { label: "Desktop" } },
          serverConfig: {
            providers: [
              {
                ...go,
                usageLimits: {
                  ...go.usageLimits!,
                  checkedAt: "2026-09-03T11:30:00.000Z",
                  windows: [{ ...window, id: "go_rolling", usedPercent: 4 }],
                },
              },
            ],
          },
        },
      ],
    ]);
    const accounts = collectLimitAccounts(input);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.environments).toEqual([
      { environmentId: "env-a", label: "Laptop" },
      { environmentId: "env-b", label: "Desktop" },
    ]);
    expect(collectLimitPools(accounts, now)[0]?.windows[0]?.members).toHaveLength(1);
    expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(4);

    const differentKey = {
      ...go,
      usageLimits: { ...go.usageLimits!, credentialFingerprint: "other-go-key" },
    };
    input.set(EnvironmentId.make("env-b"), {
      entry: { target: { label: "Desktop" } },
      serverConfig: { providers: [differentKey] },
    });
    expect(collectLimitAccounts(input)).toHaveLength(2);

    input.set(EnvironmentId.make("env-a"), {
      ...laptop,
      serverConfig: {
        providers: [{ ...go, auth: { status: "authenticated", email: "same@example.com" } }],
      },
    });
    input.set(EnvironmentId.make("env-b"), {
      entry: { target: { label: "Desktop" } },
      serverConfig: {
        providers: [
          { ...differentKey, auth: { status: "authenticated", email: "SAME@example.com" } },
        ],
      },
    });
    expect(collectLimitAccounts(input)).toHaveLength(1);
  });

  it("takes windows from a fresher read but credits and redeem from the one that reported them", () => {
    const native = provider({
      driver: claude,
      instanceId: ProviderInstanceId.make("claude"),
      auth: { status: "authenticated", email: "same@example.com" },
      usageLimits: {
        checkedAt,
        windows: [{ ...window, usedPercent: 40 }],
        resetCredits: { availableCount: 2 },
      },
    });
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [native] } }],
      [
        EnvironmentId.make("env-b"),
        {
          entry: { target: { label: "Desktop" } },
          serverConfig: {
            providers: [
              {
                ...native,
                usageLimits: {
                  checkedAt: "2026-09-03T11:30:00.000Z",
                  windows: [{ ...window, usedPercent: 55 }],
                },
              },
            ],
          },
        },
      ],
    ]);
    const [account] = collectLimitAccounts(input);
    expect(account?.limits.windows[0]?.usedPercent).toBe(55);
    expect(account?.limits.resetCredits?.availableCount).toBe(2);
    expect(account?.redeem).toEqual({ environmentId: "env-a", input: { instanceId: "claude" } });
  });

  it("redeems on the environment whose snapshot supplied the credits on show", () => {
    const stale = provider({
      auth: { status: "authenticated", email: "same@example.com" },
      usageLimits: {
        checkedAt,
        windows: [window],
        resetCredits: { availableCount: 0 },
      },
    });
    const fresh = {
      ...stale,
      usageLimits: {
        checkedAt: "2026-09-03T11:30:00.000Z",
        windows: [window],
        resetCredits: { availableCount: 2 },
      },
    };
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [stale] } }],
      [
        EnvironmentId.make("env-b"),
        { entry: { target: { label: "Desktop" } }, serverConfig: { providers: [fresh] } },
      ],
    ]);
    const [account] = collectLimitAccounts(input);
    expect(account?.limits.resetCredits?.availableCount).toBe(2);
    expect(account?.redeem).toEqual({ environmentId: "env-b", input: { instanceId: "codex" } });
  });

  it("does not give old credits the timestamp of a newer window-only read", () => {
    const snapshots = [
      { checkedAt, windows: [window], resetCredits: { availableCount: 2 } },
      { checkedAt: "2026-09-03T12:00:00.000Z", windows: [window] },
      {
        checkedAt: "2026-09-03T11:30:00.000Z",
        windows: [window],
        resetCredits: { availableCount: 1 },
      },
    ];
    const input = new Map(
      snapshots.map((usageLimits, i) => [
        EnvironmentId.make(`env-${i}`),
        {
          ...laptop,
          serverConfig: {
            providers: [
              provider({
                auth: { status: "authenticated", email: "same@example.com" },
                usageLimits,
              }),
            ],
          },
        },
      ]),
    );
    const [account] = collectLimitAccounts(input);
    expect(account?.limits.checkedAt).toBe("2026-09-03T12:00:00.000Z");
    expect(account?.limits.resetCredits?.availableCount).toBe(1);
    expect(account?.redeem.environmentId).toBe("env-2");
  });

  it("keeps one email in two workspaces apart while merging each workspace's duplicates", () => {
    const login = (instanceId: string, usedPercent: number, workspaceId?: string) =>
      provider({
        instanceId: ProviderInstanceId.make(instanceId),
        auth: {
          status: "authenticated",
          email: "same@example.com",
          ...(workspaceId ? { workspaceId } : {}),
        },
        usageLimits: { checkedAt, windows: [{ ...weekly, usedPercent }] },
      });
    const input = new Map([
      [
        EnvironmentId.make("env-a"),
        {
          ...laptop,
          serverConfig: {
            providers: [login("business", 8, "ws-business"), login("personal", 26, "ws-plus")],
          },
        },
      ],
      [
        EnvironmentId.make("env-b"),
        {
          entry: { target: { label: "Desktop" } },
          serverConfig: { providers: [login("personal", 26, "ws-plus"), login("unknown", 50)] },
        },
      ],
    ]);
    const accounts = collectLimitAccounts(input);
    expect(accounts.map((account) => account.key)).toEqual([
      "env-a:business",
      "env-a:personal",
      "env-b:unknown",
    ]);
    expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(8);
    expect(accounts[1]?.environments.map((environment) => environment.label)).toEqual([
      "Laptop",
      "Desktop",
    ]);
  });

  it("joins a report without a workspace to the only workspace signed in with its email", () => {
    const native = provider({
      driver: claude,
      auth: { status: "authenticated", email: "same@example.com", workspaceId: "org-a" },
      usageLimits: { checkedAt, windows: [window] },
    });
    const withoutWorkspace = provider({
      driver: claude,
      instanceId: ProviderInstanceId.make("claude"),
      auth: { status: "authenticated", email: "same@example.com" },
      usageLimits: { checkedAt, windows: [window] },
    });
    const withOther = (other: ServerProvider) =>
      new Map([
        [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [native, other] } }],
        [
          EnvironmentId.make("env-b"),
          {
            entry: { target: { label: "Desktop" } },
            serverConfig: { providers: [withoutWorkspace] },
          },
        ],
      ]);
    const unrelated = provider({ instanceId: ProviderInstanceId.make("codex-2") });
    expect(collectLimitAccounts(withOther(unrelated)).map((account) => account.key)).toEqual([
      "env-a:codex",
    ]);
    const unreadable = provider({
      ...native,
      instanceId: ProviderInstanceId.make("team"),
      auth: { ...native.auth, workspaceId: "org-b" },
      usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
    });
    expect(collectLimitAccounts(withOther(unreadable)).map((account) => account.key)).toEqual([
      "env-a:codex",
      "env-b:claude",
    ]);
  });

  it("pools Codex windows by kind, whichever slot reported them", () => {
    const codexAccount = (id: string, slots: readonly string[]) =>
      provider({
        instanceId: ProviderInstanceId.make(id),
        usageLimits: {
          checkedAt,
          windows: slots.map((slot) => ({ ...weekly, id: slot, usedPercent: 50 })),
        },
      });
    const pooled = (providers: ServerProvider[]) =>
      collectLimitPools(
        collectLimitAccounts(
          new Map([[EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers } }]]),
        ),
        now,
      )[0]?.windows ?? [];
    for (const order of [
      [codexAccount("business", ["primary"]), codexAccount("plus", ["secondary"])],
      [codexAccount("plus", ["secondary"]), codexAccount("business", ["primary"])],
    ]) {
      const windows = pooled(order);
      expect(windows.map((window) => window.id)).toEqual(["weekly"]);
      expect(windows[0]?.members).toHaveLength(2);
    }
    expect(
      pooled([codexAccount("a", ["secondary"]), codexAccount("b", ["primary", "secondary"])]).map(
        (window) => window.id,
      ),
    ).toEqual(["weekly", "weekly:secondary"]);
  });

  it("pools windows by id across accounts and orders resets by when they land", () => {
    const input = new Map([
      [
        EnvironmentId.make("env-a"),
        {
          ...laptop,
          serverConfig: {
            providers: [
              provider({
                instanceId: ProviderInstanceId.make("a"),
                driver: claude,
                usageLimits: {
                  checkedAt,
                  windows: [
                    { ...window, usedPercent: 80, resetsAt: "2026-09-03T13:00:00.000Z" },
                    { ...weekly, usedPercent: 20 },
                  ],
                },
              }),
              provider({
                instanceId: ProviderInstanceId.make("b"),
                driver: claude,
                usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 40 }] },
              }),
              provider({
                instanceId: ProviderInstanceId.make("c"),
                usageLimits: { checkedAt, windows: [{ ...weekly, usedPercent: 50 }] },
              }),
              provider({
                instanceId: ProviderInstanceId.make("unsupported"),
                driver: claude,
                usageLimits: { checkedAt, windows: [], unavailable: { reason: "unsupported" } },
              }),
            ],
          },
        },
      ],
    ]);
    const pools = collectLimitPools(collectLimitAccounts(input), now);
    expect(pools.map((pool) => [pool.driver, pool.accounts.length])).toEqual([
      ["claudeAgent", 2],
      ["codex", 1],
    ]);
    const [session, week] = pools[0]!.windows;
    const untimed = collectLimitPools(
      collectLimitAccounts(input).map((account) =>
        account.key === "env-a:b"
          ? {
              ...account,
              limits: {
                ...account.limits,
                windows: account.limits.windows.map((w) => ({ ...w, resetsAt: undefined })),
              },
            }
          : account,
      ),
      now,
    );
    expect(untimed[0]?.windows[0]?.pace).toBe("on");
    expect(session).toMatchObject({
      id: "five_hour",
      remainingPercent: 40,
      usedPercent: 60,
      pace: "under",
    });
    expect(
      session?.resets.map((reset) => [reset.member.account.key, reset.restoresPercent]),
    ).toEqual([
      ["env-a:a", 40],
      ["env-a:b", 20],
    ]);
    expect(week).toMatchObject({ id: "seven_day", remainingPercent: 80, members: [{}] });
    // Codex reports `primary` for both its five-hour and (on Go) monthly window.
    const mixed = collectLimitPools(
      [
        ...collectLimitAccounts(input),
        {
          key: "go",
          driver: claude,
          displayName: "Go",
          email: undefined,
          plan: undefined,
          accentColor: undefined,
          environments: [],
          redeem: {
            environmentId: EnvironmentId.make("env-a"),
            input: { instanceId: ProviderInstanceId.make("go") },
          },
          limits: {
            checkedAt,
            windows: [
              {
                id: "five_hour",
                kind: "monthly",
                label: "Monthly",
                usedPercent: 82,
                windowDurationMins: 30 * 24 * 60,
                resetsAt: "2026-09-14T12:00:00.000Z",
              },
            ],
          },
        },
      ],
      now,
    );
    expect(mixed[0]?.windows.map((window) => [window.kind, window.members.length])).toEqual([
      ["session", 2],
      ["weekly", 1],
      ["monthly", 1],
    ]);
    expect(session?.members.map((member) => member.account.key)).toEqual(["env-a:a", "env-a:b"]);
    expect(pools[0]?.accounts.map((account) => account.key)).toEqual(["env-a:a", "env-a:b"]);
  });
});

describe("pooled account columns", () => {
  const weekly = {
    ...window,
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    windowDurationMins: 7 * 24 * 60,
  } as const;
  const account = (key: string, windows: LimitAccount["limits"]["windows"]): LimitAccount => ({
    key,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: key,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    redeem: {
      environmentId: EnvironmentId.make("env-a"),
      input: { instanceId: ProviderInstanceId.make(key) },
    },
    limits: { checkedAt: "2026-09-03T11:00:00.000Z", windows },
  });
  const keys = (pool: ReturnType<typeof collectLimitPools>[number]) =>
    pool.windows.map((row) =>
      row.columns.map((member) => (member.window ? member.account.key : null)),
    );

  it.each([
    ["claudeAgent", "13:00", 40, "14:00", 100],
    ["codex", "14:00", 100, "14:00", 100],
    ["claudeAgent", "15:00", 100, "15:00", 100],
    ["codex", "15:00", 40, "14:00", 60],
  ] as const)(
    "%s session resetting at %s with %i percent spent becomes usable at %s with %i percent restored",
    (driver, sessionReset, usedPercent, usableAt, restoresPercent) => {
      const at = (time: string) => `2026-09-03T${time}:00.000Z`;
      const a = {
        ...account("a", [
          {
            ...window,
            id: driver === "codex" ? "primary" : window.id,
            usedPercent,
            resetsAt: at(sessionReset),
          },
          {
            ...weekly,
            id: driver === "codex" ? "secondary" : weekly.id,
            usedPercent: 100,
            resetsAt: at("14:00"),
          },
        ]),
        driver: ProviderDriverKind.make(driver),
      };
      const [session] = collectLimitPools([a], now)[0]!.windows;
      expect.soft(session?.remainingPercent).toBe(0);
      expect(session?.resets[0]).toMatchObject({
        at: Date.parse(at(usableAt)),
        restoresPercent,
      });
    },
  );

  it("excludes weekly-blocked sessions from the pool without changing snapshots or model allowances", () => {
    const blocked = account("blocked", [
      window,
      { ...weekly, usedPercent: 100 },
      { ...weekly, id: "seven_day_fable", usedPercent: 20 },
    ]);
    const accounts = [
      blocked,
      account("available", [
        { ...window, usedPercent: 20 },
        { ...weekly, usedPercent: 99 },
        { ...weekly, id: "seven_day_fable", usedPercent: 40 },
      ]),
      { ...blocked, key: "cursor", driver: ProviderDriverKind.make("cursor") },
    ];
    const snapshot = structuredClone(accounts);
    const [claude, cursor] = collectLimitPools(accounts, now);
    expect.soft(claude?.windows.map((row) => row.remainingPercent)).toEqual([40, 1, 70]);
    expect.soft(cursor?.windows.map((row) => row.remainingPercent)).toEqual([60, 0, 80]);
    expect(accounts).toEqual(snapshot);
  });

  it("keeps session columns across rows with opposite reset and usage orders", () => {
    const accounts = [
      account("a", [
        { ...weekly, usedPercent: 80, resetsAt: "2026-09-05T12:00:00.000Z" },
        { ...window, usedPercent: 10, resetsAt: "2026-09-03T15:00:00.000Z" },
      ]),
      account("b", [
        { ...weekly, usedPercent: 20, resetsAt: "2026-09-06T12:00:00.000Z" },
        { ...window, usedPercent: 90, resetsAt: "2026-09-03T13:00:00.000Z" },
      ]),
    ];
    const [pool] = collectLimitPools(accounts, now);
    expect(pool!.accounts.map((account) => account.key)).toEqual(["b", "a"]);
    expect(keys(pool!)).toEqual([
      ["b", "a"],
      ["b", "a"],
    ]);
    expect(pool!.windows[1]!.resets.map((reset) => reset.member.account.key)).toEqual(["a", "b"]);
    expect(pool!.windows[1]!.remainingPercent).toBe(50);
    expect(keys(collectLimitPools(accounts.toReversed(), now)[0]!)).toEqual(keys(pool!));
  });

  it.each([undefined, "invalid", "2026-09-03T11:30:00.000Z"])(
    "keeps blocked sessions empty without predicting a refill from a missing or stale clock (%s)",
    (resetsAt) => {
      const [pool] = collectLimitPools(
        [
          account("session-clock", [
            { ...window, resetsAt },
            { ...weekly, usedPercent: 100 },
          ]),
          account("weekly-clock", [window, { ...weekly, usedPercent: 100, resetsAt }]),
        ],
        now,
      );
      expect(pool!.windows[0]).toMatchObject({ remainingPercent: 0, pace: null, resets: [] });
      expect(pool!.windows[0]!.columns.map((column) => column.window?.resetsAt)).toEqual([
        undefined,
        undefined,
      ]);
    },
  );

  it("orders by usable session refill and clears suppression after a fresh weekly reading", () => {
    const blocked = account("blocked", [
      { ...window, resetsAt: "2026-09-03T13:00:00.000Z" },
      { ...weekly, usedPercent: 100, resetsAt: "2026-09-03T15:00:00.000Z" },
    ]);
    const available = account("available", [window]);
    const [before] = collectLimitPools([blocked, available], now);
    expect(before!.accounts.map((account) => account.key)).toEqual(["available", "blocked"]);
    expect(before!.windows[0]!.remainingPercent).toBe(30);
    const refreshed = {
      ...blocked,
      limits: {
        checkedAt: "2026-09-03T12:00:00.000Z",
        windows: [blocked.limits.windows[0]!, { ...weekly, usedPercent: 10 }],
      },
    };
    const [after] = collectLimitPools([refreshed, available], now);
    expect(after!.accounts.map((account) => account.key)).toEqual(["blocked", "available"]);
    expect(after!.windows[0]!.remainingPercent).toBe(60);
    expect(after!.windows[0]!.resets[0]).toMatchObject({
      at: Date.parse("2026-09-03T13:00:00.000Z"),
      restoresPercent: 20,
    });
  });

  it("preserves gaps without counting missing windows toward pooled quota", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [window]),
        account("b", [
          { ...window, resetsAt: "2026-09-03T15:00:00.000Z" },
          { ...weekly, usedPercent: 80 },
        ]),
        account("c", [weekly]),
      ],
      now,
    );
    expect(keys(pool!)).toEqual([
      ["a", "b", null],
      [null, "b", "c"],
    ]);
    expect(pool!.windows[1]!.members.map((member) => member.account.key)).toEqual(["b", "c"]);
    expect(pool!.windows[1]!.remainingPercent).toBe(40);
    expect(pool!.windows[1]!.resets.map((reset) => reset.restoresPercent)).toEqual([40, 20]);
  });

  it("falls back to weekly resets when no account reports a session", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [{ ...weekly, resetsAt: "2026-09-06T12:00:00.000Z" }]),
        account("b", [{ ...weekly, resetsAt: "2026-09-05T12:00:00.000Z" }]),
      ],
      now,
    );
    expect(keys(pool!)).toEqual([["b", "a"]]);
  });
});

describe("headlineUsageWindows", () => {
  const weekly = {
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 62,
    windowDurationMins: 10_080,
  } as const;
  const claude = (windows: ServerProviderUsageWindow[]) =>
    provider({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      driver: ProviderDriverKind.make("claudeAgent"),
      usageLimits: { checkedAt: "2026-09-03T11:00:00.000Z", windows },
    });
  const headline = (target: ServerProvider | null) =>
    headlineUsageWindows(target).map(({ label, window }) => [label, window.id]);

  it("shows the busiest window of each length, session first, whatever order they arrive in", () => {
    const fable = { ...weekly, id: "seven_day_fable", label: "Weekly · Fable", usedPercent: 30 };
    expect(headline(claude([fable, weekly, window]))).toEqual([
      ["5h", "five_hour"],
      ["Week", "seven_day"],
    ]);
    expect(headline(claude([weekly, { ...fable, usedPercent: 90 }]))).toEqual([
      ["Week", "seven_day_fable"],
    ]);
  });

  it("shows Cursor's busier pool rather than the combined percentage", () => {
    const cursor = provider({
      instanceId: ProviderInstanceId.make("cursor"),
      driver: ProviderDriverKind.make("cursor"),
      usageLimits: {
        checkedAt: "2026-09-03T11:00:00.000Z",
        windows: [
          { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 49 },
          { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 9 },
          { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 15 },
        ],
      },
    });
    expect(headline(cursor)).toEqual([["Month", "apiPercentUsed"]]);
  });

  it("names session windows by their length and leaves out other periods", () => {
    const labels = (session: Partial<ServerProviderUsageWindow>) =>
      headline(
        claude([
          { ...window, ...session },
          { ...weekly, id: "grok", kind: "other", label: "Billing period" },
        ]),
      ).map(([label]) => label);
    expect(labels({ windowDurationMins: 300 })).toEqual(["5h"]);
    expect(labels({ windowDurationMins: 90 })).toEqual(["Session"]);
    expect(labels({ windowDurationMins: undefined })).toEqual(["Session"]);
  });

  it("shows nothing for a provider that cannot report limits right now", () => {
    expect(headline(null)).toEqual([]);
    expect(headline({ ...claude([window]), enabled: false })).toEqual([]);
    expect(headline(provider({}))).toEqual([]);
  });
});

describe("/usage-limits", () => {
  const limits = { checkedAt: "2026-09-03T11:00:00.000Z", windows: [window] };
  const selected = provider({
    usageLimits: limits,
    auth: { status: "authenticated", email: "same@example.com" },
  });
  it("keeps unidentified custom instances separate, filtering by driver", () => {
    const report = collectProviderUsageLimits(
      selected.instanceId,
      [
        selected,
        provider({
          instanceId: ProviderInstanceId.make("codex-work"),
          displayName: "Work",
          usageLimits: { ...limits, resetCredits: { availableCount: 2 } },
        }),
        provider({
          driver: ProviderDriverKind.make("claude"),
          instanceId: ProviderInstanceId.make("claude"),
          usageLimits: limits,
        }),
      ],
      now,
    );
    expect(report?.createdAt).toBe("2026-09-03T12:00:00.000Z");
    expect(report?.accounts.map((account) => account.instanceId)).toEqual(["codex", "codex-work"]);
    expect(report?.accounts[1]).toMatchObject({
      displayName: "Work",
      limits: { resetCredits: { availableCount: 2 } },
    });
  });

  it("keeps the freshest usable native duplicate and the freshest native credits in either order", () => {
    const failed = provider({
      auth: selected.auth,
      usageLimits: {
        ...limits,
        checkedAt: "2026-09-03T11:40:00.000Z",
        unavailable: { reason: "probeFailed" },
      },
    });
    const credited = provider({
      instanceId: ProviderInstanceId.make("codex-credit"),
      auth: selected.auth,
      usageLimits: {
        checkedAt: "2026-09-03T11:20:00.000Z",
        windows: [{ ...window, usedPercent: 50 }],
        resetCredits: { availableCount: 2 },
      },
    });
    const staleCredit = provider({
      ...credited,
      instanceId: ProviderInstanceId.make("codex-stale-credit"),
      usageLimits: { ...limits, resetCredits: { availableCount: 3 } },
    });
    const freshest = provider({
      instanceId: ProviderInstanceId.make("codex-fresh"),
      auth: selected.auth,
      usageLimits: {
        checkedAt: "2026-09-03T11:30:00.000Z",
        windows: [{ ...window, usedPercent: 55 }],
      },
    });
    const duplicates = [failed, staleCredit, credited, freshest];
    for (const providers of [duplicates, duplicates.toReversed()]) {
      const report = collectProviderUsageLimits(failed.instanceId, providers, now);
      expect(report?.accounts.map((account) => account.instanceId)).toEqual(["codex-fresh"]);
      expect(report?.accounts[0]).toMatchObject({
        limits: {
          checkedAt: "2026-09-03T11:30:00.000Z",
          windows: [{ usedPercent: 55 }],
          resetCredits: { availableCount: 2 },
        },
        resetCreditInput: { instanceId: "codex-credit" },
      });
      expect(report?.accounts[0]?.limits.unavailable).toBeUndefined();
    }
  });

  it("merges native workspace duplicates only while the workspace evidence is unambiguous", () => {
    const known = provider({
      ...selected,
      instanceId: ProviderInstanceId.make("workspace-a"),
      auth: { ...selected.auth, workspaceId: "ws-a" },
    });
    const fresh = provider({
      ...known,
      instanceId: ProviderInstanceId.make("workspace-a-fresh"),
      usageLimits: { ...limits, checkedAt: "2026-09-03T11:30:00.000Z" },
    });
    const natives = [known, fresh, selected];
    expect(
      collectProviderUsageLimits(selected.instanceId, natives, now)?.accounts.map(
        (account) => account.instanceId,
      ),
    ).toEqual(["workspace-a-fresh"]);

    const unreadable = provider({
      instanceId: ProviderInstanceId.make("workspace-b"),
      auth: { ...selected.auth, workspaceId: "ws-b" },
    });
    expect(
      collectProviderUsageLimits(selected.instanceId, [...natives, unreadable], now)?.accounts.map(
        (account) => account.instanceId,
      ),
    ).toEqual(["workspace-a-fresh", "codex"]);
    expect(
      collectProviderUsageLimits(
        selected.instanceId,
        [...natives, { ...unreadable, usageLimits: limits }],
        now,
      )?.accounts.map((account) => account.instanceId),
    ).toEqual(["workspace-a-fresh", "codex", "workspace-b"]);
  });

  it("keeps a failed probe and offers nothing without limits", () => {
    const failed = provider({ usageLimits: { ...limits, unavailable: { reason: "probeFailed" } } });
    expect(
      collectProviderUsageLimits(selected.instanceId, [failed], now)?.accounts.map(
        (account) => account.instanceId,
      ),
    ).toEqual(["codex"]);
    expect(collectProviderUsageLimits(selected.instanceId, [provider({})], now)).toBeNull();
    expect(
      collectProviderUsageLimits(
        selected.instanceId,
        [provider({ enabled: false, usageLimits: limits })],
        now,
      ),
    ).toBeNull();
  });

  it("advertises global and workspace commands only for providers present in Limits", () => {
    const withWorkspace = provider({
      workspaceSnapshots: [
        { cwd: "/tmp/project", checkedAt: limits.checkedAt, slashCommands: [], skills: [] },
      ],
    });
    const [supported] = withUsageLimitsCommands([{ ...withWorkspace, usageLimits: limits }]);
    expect(supported?.slashCommands.map((command) => command.name)).toEqual(["usage-limits"]);
    expect(
      supported?.workspaceSnapshots?.[0]?.slashCommands.map((command) => command.name),
    ).toEqual(["usage-limits"]);
    expect(withUsageLimitsCommands([withWorkspace])[0]?.slashCommands).toEqual([]);
    const ownCommand = provider({
      slashCommands: [{ name: "usage-limits", description: "Provider's own" }],
    });
    expect(withUsageLimitsCommands([ownCommand])[0]?.slashCommands).toEqual([
      { name: "usage-limits", description: "Provider's own" },
    ]);
  });
});

describe("external usage settings", () => {
  it("deduplicates destinations across accounts and environments without inventing quota pools", () => {
    const managed = provider({
      usageLimits: {
        checkedAt: "2026-09-03T11:00:00.000Z",
        windows: [],
        unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
        externalUsage: { label: "ChatGPT usage", url: "https://chatgpt.com/#settings/Usage" },
      },
    });
    const presentations = new Map([
      [
        EnvironmentId.make("a"),
        {
          entry: { target: { label: "A" } },
          serverConfig: {
            providers: [managed, { ...managed, instanceId: ProviderInstanceId.make("personal") }],
          },
        },
      ],
      [
        EnvironmentId.make("b"),
        { entry: { target: { label: "B" } }, serverConfig: { providers: [managed] } },
      ],
    ]);
    expect(collectExternalUsageLinks(presentations)).toEqual([
      {
        ...managed.usageLimits!.externalUsage,
        message: "Track usage in ChatGPT.",
        accounts: [`${managed.instanceId} on A`, "personal on A", `${managed.instanceId} on B`],
      },
    ]);
    expect(collectLimitAccounts(presentations)).toEqual([]);
    expect(collectLimitNotices(presentations)).toEqual([]);
  });
});

describe("ChatGPT sharing presentation", () => {
  it("requires verified sharing metadata rather than the Codex driver or login type", () => {
    const codex = provider({ auth: { status: "authenticated", type: "chatgpt" } });
    expect(usesChatGptSharing(codex)).toBe(false);
    expect(
      usesChatGptSharing({ ...codex, auth: { ...codex.auth, subscriptionSharing: true } }),
    ).toBe(true);
    expect(
      usesChatGptSharing({
        ...codex,
        auth: { status: "unauthenticated", subscriptionSharing: true },
      }),
    ).toBe(false);
  });
});
