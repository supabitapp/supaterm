// @effect-diagnostics nodeBuiltinImport:off - Hands a real file on disk to a real desktop browser.
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { INCOGNITO_BROWSER_PROFILE_ID } from "@supaterm/contracts";
import { chromium, type Browser, type BrowserContext, type BrowserType } from "playwright-core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerBrowserContexts } from "./ServerBrowserContexts.ts";

type Launch = BrowserType["launch"];
type LaunchPersistent = BrowserType["launchPersistentContext"];
const unexpectedLaunch = () => Promise.reject(new Error("unexpected browser launch"));
const launches: {
  readonly launch: { readonly next: Array<Launch>; always: Launch };
  readonly persistent: { readonly next: Array<LaunchPersistent>; always: LaunchPersistent };
  readonly mkdir: { readonly next: Array<() => Promise<void>> };
  readonly rm: { readonly next: Array<() => Promise<void>> };
} = {
  launch: { next: [], always: unexpectedLaunch },
  persistent: { next: [], always: unexpectedLaunch },
  mkdir: { next: [] },
  rm: { next: [] },
};
const browserType = {
  launch: (options?: Parameters<Launch>[0]) =>
    (launches.launch.next.shift() ?? launches.launch.always)(options),
  launchPersistentContext: (directory: string, options?: Parameters<LaunchPersistent>[1]) =>
    (launches.persistent.next.shift() ?? launches.persistent.always)(directory, options),
};
const profileFiles = {
  mkdir: async (_path: string, _options: { readonly recursive: true }) => {
    await launches.mkdir.next.shift()?.();
  },
  rm: async (_path: string, _options: { readonly recursive: true; readonly force: true }) => {
    await launches.rm.next.shift()?.();
  },
};
const launchSpy = vi.spyOn(browserType, "launch");
const persistentSpy = vi.spyOn(browserType, "launchPersistentContext");
const mkdirSpy = vi.spyOn(profileFiles, "mkdir");
const rmSpy = vi.spyOn(profileFiles, "rm");
const launchPersistentChromium = chromium.launchPersistentContext.bind(chromium);

const makeContext = () => {
  const events = new NodeEvents.EventEmitter();
  let closed = false;
  const context = {
    newPageFailures: [] as Array<Error>,
    closeWith: undefined as (() => Promise<void>) | undefined,
    on: vi.fn((event: string, listener: () => void) => events.on(event, listener)),
    pages: vi.fn(() => []),
    newPage: vi.fn(async () => {
      const failure = context.newPageFailures.shift();
      if (failure) throw failure;
      return { once: vi.fn() };
    }),
    isClosed: () => closed,
    close: vi.fn(async () => {
      if (context.closeWith) return context.closeWith();
      if (!closed) {
        closed = true;
        events.emit("close");
      }
    }),
  };
  return context;
};

const makeBrowser = () => {
  const events = new NodeEvents.EventEmitter();
  const contexts: ReturnType<typeof makeContext>[] = [];
  const queuedContexts: Array<BrowserContext> = [];
  return {
    created: contexts,
    queuedContexts,
    contexts: () => contexts.filter((context) => !context.isClosed()),
    on: vi.fn((event: string, listener: () => void) => events.on(event, listener)),
    newContext: vi.fn(async () => {
      const queued = queuedContexts.shift();
      if (queued) return queued;
      const context = makeContext();
      contexts.push(context);
      return context as unknown as BrowserContext;
    }),
    close: vi.fn(async () => {
      for (const context of contexts) await context.close();
      events.emit("disconnected");
    }),
  };
};

const options = () => ({
  profilesDir: "/test/profiles",
  executable: vi.fn(async () => "/test/chromium"),
  env: {},
  browserType,
  profileFiles,
});

const devToolsPort = async (userDataDir: string) => {
  const file = NodePath.join(userDataDir, "DevToolsActivePort");
  if (!NodeFS.existsSync(file)) {
    await new Promise<void>((resolve) => {
      const watcher = NodeFS.watch(userDataDir, () => {
        if (!NodeFS.existsSync(file)) return;
        watcher.close();
        resolve();
      });
      if (NodeFS.existsSync(file)) {
        watcher.close();
        resolve();
      }
    });
  }
  return NodeFS.readFileSync(file, "utf8").split("\n")[0];
};

const withLauncher = () => {
  const release = vi.fn(async () => {});
  return {
    release,
    configuration: {
      ...options(),
      launcher: vi.fn(async (executable: string) => ({ path: `${executable}-launcher`, release })),
    },
  };
};

beforeEach(() => {
  launches.launch.next.length = 0;
  launches.launch.always = unexpectedLaunch;
  launches.persistent.next.length = 0;
  launches.persistent.always = unexpectedLaunch;
  launches.mkdir.next.length = 0;
  launches.rm.next.length = 0;
  for (const spy of [launchSpy, persistentSpy, mkdirSpy, rmSpy]) spy.mockClear();
});

describe("ServerBrowserContexts", () => {
  it("closes the shared browser only after it holds no context for the idle period", async () => {
    vi.useFakeTimers();
    try {
      const first = makeBrowser();
      const second = makeBrowser();
      launches.launch.next.push(
        async () => first as unknown as Browser,
        async () => second as unknown as Browser,
      );
      const pool = new ServerBrowserContexts({ ...options(), idleBrowserMs: 10 });
      const agent = await pool.contextFor("default", "agent");
      await pool.scratchPage();
      await agent.close();
      await vi.advanceTimersByTimeAsync(10);
      expect(first.close).not.toHaveBeenCalled();
      await first.created[1]!.close();
      await vi.advanceTimersByTimeAsync(9);
      const next = await pool.contextFor("default", "next");
      await vi.advanceTimersByTimeAsync(10);
      expect(first.close).not.toHaveBeenCalled();
      await next.close();
      await vi.advanceTimersByTimeAsync(10);
      expect(first.close).toHaveBeenCalledOnce();
      await pool.contextFor("default", "later");
      expect(launchSpy).toHaveBeenCalledTimes(2);
      expect(second.newContext).toHaveBeenCalledOnce();
      await pool.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a scratch context when creating its page fails", async () => {
    const browser = makeBrowser();
    launches.launch.always = async () => browser as unknown as Browser;
    const pool = new ServerBrowserContexts(options());
    const peer = await pool.contextFor("default", "peer");
    const context = await browser.newContext();
    const failure = new Error("newPage failed");
    browser.created[1]!.newPageFailures.push(failure);
    browser.queuedContexts.push(context);
    try {
      await expect(pool.scratchPage()).rejects.toBe(failure);
      expect(context.close).toHaveBeenCalledOnce();
      expect(browser.contexts()).toEqual([peer]);
      expect(peer.close).not.toHaveBeenCalled();
      expect(browser.close).not.toHaveBeenCalled();
    } finally {
      await pool.close();
    }
  });

  it("lazily shares one browser across concurrent isolated sessions and reuses each context", async () => {
    const browser = makeBrowser();
    const launch = Promise.withResolvers<Browser>();
    const started = Promise.withResolvers<void>();
    launches.launch.always = () => {
      started.resolve();
      return launch.promise;
    };
    const { configuration, release } = withLauncher();
    const pool = new ServerBrowserContexts(configuration);
    expect(configuration.executable).not.toHaveBeenCalled();
    const first = pool.contextFor("default", "agent-a");
    const again = pool.contextFor("default", "agent-a");
    const second = pool.contextFor("default", "agent-b");
    const incognito = pool.contextFor(INCOGNITO_BROWSER_PROFILE_ID);
    await started.promise;
    expect(release).not.toHaveBeenCalled();
    launch.resolve(browser as unknown as Browser);
    const [a, reused, b, privateContext] = await Promise.all([first, again, second, incognito]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(a).toBe(reused);
    expect(new Set([a, b, privateContext]).size).toBe(3);
    expect(launchSpy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ executablePath: "/test/chromium-launcher" }),
    );
    expect(persistentSpy).not.toHaveBeenCalled();
    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    await pool.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
    for (const context of browser.created) expect(context.close).toHaveBeenCalled();
  });

  it("keeps human profiles persistent without sharing their storage with agents", async () => {
    const human = makeContext();
    const browser = makeBrowser();
    launches.persistent.always = async () => human as unknown as BrowserContext;
    launches.launch.always = async () => browser as unknown as Browser;
    const { configuration, release } = withLauncher();
    const pool = new ServerBrowserContexts(configuration);
    const persistent = await pool.contextFor("work/team");
    expect(await pool.contextFor("work/team")).toBe(persistent);
    expect(await pool.contextFor("work/team", "agent")).not.toBe(persistent);
    expect(persistentSpy).toHaveBeenCalledExactlyOnceWith(
      "/test/profiles/work%2Fteam",
      expect.objectContaining({ chromiumSandbox: true, executablePath: "/test/chromium-launcher" }),
    );
    expect(release).toHaveBeenCalledTimes(2);
    expect(mkdirSpy).toHaveBeenCalledWith("/test/profiles/work%2Fteam", { recursive: true });
    await pool.close();
    expect(human.close).toHaveBeenCalledTimes(1);
  });

  it("diagnoses a launcher failure against the real executable", async () => {
    const diagnosed = new Error("diagnosed");
    const diagnose = vi.fn(async () => diagnosed);
    const pool = new ServerBrowserContexts({
      ...options(),
      diagnose,
      launcher: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });
    await expect(pool.contextFor("default", "agent")).rejects.toBe(diagnosed);
    expect(diagnose).toHaveBeenCalledExactlyOnceWith("/test/chromium", expect.any(Error));
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it("creates no launcher for a profile whose storage cannot be created", async () => {
    launches.mkdir.next.push(async () => {
      throw new Error("EACCES");
    });
    const { configuration } = withLauncher();
    const pool = new ServerBrowserContexts(configuration);
    await expect(pool.contextFor("work/team")).rejects.toThrow("EACCES");
    expect(configuration.launcher).not.toHaveBeenCalled();
  });

  it("clears a profile by closing its open context before deleting its storage", async () => {
    const human = makeContext();
    const browser = makeBrowser();
    launches.persistent.always = async () => human as unknown as BrowserContext;
    launches.launch.always = async () => browser as unknown as Browser;
    const onContextClose = vi.fn();
    const pool = new ServerBrowserContexts({ ...options(), onContextClose });
    const persistent = await pool.contextFor("work/team");
    const agent = await pool.contextFor("work/team", "agent");
    launches.rm.next.push(async () => {
      expect(human.close).toHaveBeenCalledTimes(1);
    });
    await pool.clearProfile("work/team");
    expect(onContextClose).toHaveBeenCalledExactlyOnceWith(persistent);
    expect(rmSpy).toHaveBeenCalledExactlyOnceWith("/test/profiles/work%2Fteam", {
      recursive: true,
      force: true,
    });
    expect(await pool.contextFor("work/team", "agent")).toBe(agent);
    expect(browser.created[0]?.close).not.toHaveBeenCalled();
    launches.persistent.always = async () => makeContext() as unknown as BrowserContext;
    expect(await pool.contextFor("work/team")).not.toBe(persistent);
    await pool.clearProfile("never-opened");
    expect(rmSpy).toHaveBeenLastCalledWith("/test/profiles/never-opened", {
      recursive: true,
      force: true,
    });
    await pool.close();
  });

  it("waits for the context to close when the same profile is cleared concurrently", async () => {
    const human = makeContext();
    const closed = Promise.withResolvers<void>();
    human.closeWith = () => closed.promise;
    launches.persistent.always = async () => human as unknown as BrowserContext;
    const pool = new ServerBrowserContexts(options());
    await pool.contextFor("work/team");

    const first = pool.clearProfile("work/team");
    const second = pool.clearProfile("work/team");
    const deletionsBeforeClose = rmSpy.mock.calls.length;
    closed.resolve();
    await Promise.all([first, second]);

    expect(deletionsBeforeClose).toBe(0);
    expect(human.close).toHaveBeenCalledTimes(1);
    expect(rmSpy).toHaveBeenCalledExactlyOnceWith("/test/profiles/work%2Fteam", {
      recursive: true,
      force: true,
    });
    await pool.close();
  });

  it("opens a profile requested during its clear only after the storage is deleted", async () => {
    launches.persistent.always = async () => makeContext() as unknown as BrowserContext;
    const removing = Promise.withResolvers<void>();
    const removed = Promise.withResolvers<void>();
    let deleted = false;
    let clearing = false;
    const launchedAfterDelete: Array<boolean> = [];
    const pool = new ServerBrowserContexts({
      ...options(),
      executable: async () => {
        if (clearing) launchedAfterDelete.push(deleted);
        return "/test/chromium";
      },
    });
    await pool.contextFor("work/team");
    launches.rm.next.push(async () => {
      removing.resolve();
      await removed.promise;
      deleted = true;
    });
    clearing = true;
    const cleared = pool.clearProfile("work/team");
    const reopening = pool.contextFor("work/team");
    await removing.promise;
    removed.resolve();
    await Promise.all([cleared, reopening]);
    expect(launchedAfterDelete).toEqual([true]);
    await pool.close();
  });

  it.each([undefined, "default"])(
    "never retries a failed %s launch with the sandbox disabled",
    async (profile) => {
      const failure = async () => {
        throw new Error("sandbox unavailable");
      };
      if (profile) launches.persistent.always = failure;
      else launches.launch.always = failure;
      const launch = profile ? persistentSpy : launchSpy;
      const pool = new ServerBrowserContexts(options());
      await expect(pool.contextFor(profile ?? INCOGNITO_BROWSER_PROFILE_ID)).rejects.toThrow(
        "sandbox unavailable",
      );
      expect(launch).toHaveBeenCalledTimes(1);
      expect(
        profile ? persistentSpy.mock.calls[0]?.[1] : launchSpy.mock.calls[0]?.[0],
      ).toMatchObject({ chromiumSandbox: true });
      await pool.close();
    },
  );

  it("allows only an explicit sandbox opt-out", async () => {
    const browser = makeBrowser();
    launches.launch.always = async () => browser as unknown as Browser;
    const pool = new ServerBrowserContexts({
      ...options(),
      env: { SUPATERM_SERVER_BROWSER_SANDBOX: "0" },
    });
    await pool.contextFor(INCOGNITO_BROWSER_PROFILE_ID);
    expect(launchSpy).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: false }));
    await pool.close();
  });

  it("retries a failed startup on a later request with sandboxing still enabled", async () => {
    const browser = makeBrowser();
    launches.launch.next.push(async () => {
      throw new Error("executable unavailable");
    });
    launches.launch.always = async () => browser as unknown as Browser;
    const pool = new ServerBrowserContexts(options());
    await expect(pool.contextFor("default", "agent")).rejects.toThrow("executable unavailable");
    await pool.contextFor("default", "agent");
    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(launchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ chromiumSandbox: true }));
    await pool.close();
  });

  it("cleans up a browser whose launch finishes during shutdown and rejects future work", async () => {
    const browser = makeBrowser();
    const launch = Promise.withResolvers<Browser>();
    launches.launch.always = () => launch.promise;
    const pool = new ServerBrowserContexts(options());
    const opening = expect(pool.contextFor("default", "agent")).rejects.toThrow("closed");
    const closing = pool.close();
    launch.resolve(browser as unknown as Browser);
    await Promise.all([opening, closing]);
    await expect(pool.contextFor("default", "agent")).rejects.toThrow("closed");
    await pool.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(browser.created[0]?.close).toHaveBeenCalled();
  });

  it("uploads a file over 50 MB to a desktop tab, which shares the server's filesystem", async () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "supaterm-desktop-upload-"),
    );
    const userDataDir = NodePath.join(directory, "profile");
    const pool = new ServerBrowserContexts(options());
    try {
      const desktop = await launchPersistentChromium(userDataDir, {
        headless: true,
        args: ["--remote-debugging-port=0"],
      });
      try {
        const port = await devToolsPort(userDataDir);
        const { browser, page } = await pool.connectDesktopPage(`http://127.0.0.1:${port}`);
        try {
          const file = NodePath.join(directory, "large.bin");
          NodeFS.writeFileSync(file, "");
          NodeFS.truncateSync(file, 51 * 1024 * 1024);
          await page.setContent(`<input type="file">`);
          await page.locator("input").setInputFiles(file);
          expect(
            await page.$eval("input", (input) =>
              Array.from(
                (input as unknown as { files: ArrayLike<{ name: string; size: number }> }).files,
                ({ name, size }) => ({ name, size }),
              ),
            ),
          ).toEqual([{ name: "large.bin", size: 51 * 1024 * 1024 }]);
        } finally {
          await browser.close();
        }
      } finally {
        await pool.close();
        await desktop.close();
      }
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
