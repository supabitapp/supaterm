import { expect, test } from "bun:test";
import {
  buildManagedPaneEnvironment,
  buildSessionBootstrapArgs,
  resolveSessionSocketPath,
  resolveZmxSocketDirectory,
  resolveManagedZmxBinary,
} from "./pty-manager.js";

test("resolveManagedZmxBinary prefers the injected managed zmx path", () => {
  const originalPath = process.env.SUPATERM_ZMX_PATH;
  process.env.SUPATERM_ZMX_PATH = process.execPath;

  try {
    expect(resolveManagedZmxBinary()).toBe(process.execPath);
  } finally {
    if (originalPath === undefined) {
      delete process.env.SUPATERM_ZMX_PATH;
    } else {
      process.env.SUPATERM_ZMX_PATH = originalPath;
    }
  }
});

test("resolveManagedZmxBinary returns the vendored zmx path", () => {
  const resolved = resolveManagedZmxBinary();

  expect(resolved.endsWith("/ThirdParty/zmx/zig-out/bin/zmx")).toBe(true);
});

test("buildManagedPaneEnvironment injects pane metadata and managed zmx path", () => {
  const environment = buildManagedPaneEnvironment(
    {
      id: "pane-1",
      sessionName: "supaterm.session",
      socketPath: "/tmp/supaterm.sock",
      tabId: "tab-1",
      env: { FOO: "bar" },
    },
    { HOME: "/tmp/home" },
    "/managed/zmx",
  );

  expect(environment.HOME).toBe("/tmp/home");
  expect(environment.FOO).toBe("bar");
  expect(environment.TERM).toBe("xterm-256color");
  expect(environment.COLORTERM).toBe("truecolor");
  expect(environment.SUPATERM_SURFACE_ID).toBe("pane-1");
  expect(environment.SUPATERM_TAB_ID).toBe("tab-1");
  expect(environment.SUPATERM_PANE_SESSION).toBe("supaterm.session");
  expect(environment.SUPATERM_ZMX_PATH).toBe("/managed/zmx");
  expect(environment.SUPATERM_SOCKET_PATH).toBe("/tmp/supaterm.sock");
});

test("resolveZmxSocketDirectory follows zmx environment precedence", () => {
  expect(
    resolveZmxSocketDirectory({
      ZMX_DIR: "/tmp/custom-zmx",
      XDG_RUNTIME_DIR: "/tmp/runtime",
      TMPDIR: "/tmp/fallback",
    }),
  ).toBe("/tmp/custom-zmx");
  expect(
    resolveZmxSocketDirectory({
      XDG_RUNTIME_DIR: "/tmp/runtime",
      TMPDIR: "/tmp/fallback",
    }),
  ).toBe("/tmp/runtime/zmx");
  expect(resolveZmxSocketDirectory({ TMPDIR: "/tmp/fallback/" })).toBe(
    `/tmp/fallback/zmx-${typeof process.getuid === "function" ? process.getuid() : 0}`,
  );
});

test("resolveSessionSocketPath appends the session name inside the socket dir", () => {
  expect(
    resolveSessionSocketPath("supaterm.session", { ZMX_DIR: "/tmp/custom-zmx" }),
  ).toBe("/tmp/custom-zmx/supaterm.session");
});

test("buildSessionBootstrapArgs uses headless bootstrap when no command is provided", () => {
  expect(buildSessionBootstrapArgs("supaterm.session", "/bin/zsh")).toEqual([
    "run",
    "supaterm.session",
  ]);
});

test("buildSessionBootstrapArgs wraps explicit commands through the shell", () => {
  expect(
    buildSessionBootstrapArgs(
      "supaterm.session",
      "/bin/zsh",
      "printf smoke-test",
    ),
  ).toEqual([
    "run",
    "supaterm.session",
    "/bin/zsh",
    "-lc",
    "printf smoke-test",
  ]);
});
