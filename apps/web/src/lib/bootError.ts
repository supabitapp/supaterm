import type { DesktopBridge, DesktopUpdateState } from "@supaterm/contracts";

const FALLBACK_TRIAGE_COMMAND = "npx supaterm triage";
const DOWNLOAD_URL = "https://supaterm.com/download";
const ISSUE_URL = "https://github.com/pingdotgg/supaterm/issues/new";
const LAST_FAILURE_KEY = "supaterm:boot-failed-at";
const REPEAT_FAILURE_MS = 5 * 60_000;
const MAX_CAUSES = 3;
const MAX_ERROR_CHARS = 6_000;
const COPY_BLOCKED = "Copy was blocked. The text is selected so you can copy it manually.";
const UPDATE_DOWNLOAD_FAILED = "The update download failed. Try Download update again.";
const UPDATE_INSTALL_FAILED = "The update install failed. Try Restart to update again.";

/** The Windows launcher is a `.cmd` run from PowerShell, which needs `&` to run a quoted path. */
function launcherCommand(launcherPath: string) {
  if (launcherPath.endsWith(".cmd")) {
    return /^[\w:\\.-]+$/.test(launcherPath)
      ? launcherPath
      : `& '${launcherPath.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
  }
  return /^[\w@%+=:,./-]+$/.test(launcherPath)
    ? launcherPath
    : `'${launcherPath.replaceAll("'", `'"'"'`)}'`;
}

/** Desktop can run its bundled launcher without Node; everything else falls back to npx. */
export async function resolveTriageCommand(bridge: DesktopBridge | undefined) {
  try {
    const state = await bridge?.cliCommand?.getState();
    // Windows reports onPath from its PATH entry alone; only an existing launcher proves it runs.
    if (state?.launcherPath) {
      return state.onPath ? "supaterm triage" : `${launcherCommand(state.launcherPath)} triage`;
    }
  } catch (error) {
    console.warn("Could not read the desktop CLI state.", error);
  }
  return FALLBACK_TRIAGE_COMMAND;
}

/** The update button only appears when the desktop updater has a newer build to offer. */
export function updateActionFor(state: DesktopUpdateState | null | undefined) {
  switch (state?.status) {
    case "available":
      return { kind: "download" } as const;
    case "downloading":
      return { kind: "downloading", percent: Math.round(state.downloadPercent ?? 0) } as const;
    case "downloaded":
      return { kind: "install" } as const;
    default:
      return null;
  }
}

function safeString(value: unknown) {
  try {
    return String(value);
  } catch {
    return "";
  }
}

function describeOne(value: unknown) {
  if (value instanceof Error) {
    const header = value.message ? `${value.name}: ${value.message}` : value.name;
    // V8 stacks start with the header; Safari and Firefox stacks do not.
    const stack = typeof value.stack === "string" ? value.stack : "";
    return stack === header || stack.startsWith(`${header}\n`)
      ? stack
      : [header, stack].filter(Boolean).join("\n");
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? safeString(value);
  } catch {
    return safeString(value);
  }
}

/** Hosts can name private machines, and pairing tokens live in query strings and hashes. */
function redact(text: string) {
  return text
    .replace(/\b[a-z][\w+.-]*:\/\/[^\s/?#'"()]+/gi, "")
    .replace(/[?#][^\s'"()]*=[^\s'"()]*?((?::\d+){1,2})?(?=[\s'"()]|$)/g, "$1");
}

export interface BootErrorEnvironment {
  readonly version: string;
  readonly channel: string;
  readonly surface: "desktop" | "web";
  readonly platform: string;
  readonly userAgent: string;
  readonly time: string;
}

/** Plain text that is shown and copied as-is, so users see exactly what they share. */
export function buildErrorReport(error: unknown, environment: BootErrorEnvironment) {
  const parts: Array<string> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && parts.length <= MAX_CAUSES) {
    seen.add(current);
    const text = describeOne(current);
    parts.push(parts.length === 0 ? text : `Caused by: ${text}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  let details = redact(parts.join("\n") || "(no error message)");
  if (details.length > MAX_ERROR_CHARS) {
    details = `${details.slice(0, MAX_ERROR_CHARS)}\n[truncated]`;
  }
  return [
    details,
    "",
    `Version: ${environment.version}`,
    `Channel: ${environment.channel}`,
    `Surface: ${environment.surface}`,
    `Platform: ${environment.platform}`,
    `User agent: ${environment.userAgent}`,
    `Time: ${environment.time}`,
  ].join("\n");
}

function clientPlatform(bridge: DesktopBridge | undefined) {
  try {
    return bridge?.getClientPlatform?.() ?? navigator.platform;
  } catch {
    return navigator.platform;
  }
}

function readEnvironment(bridge: DesktopBridge | undefined): BootErrorEnvironment {
  const version = import.meta.env.APP_VERSION;
  return {
    version,
    channel:
      import.meta.env.VITE_RELEASE_CHANNEL || /-(nightly|preview)\./.exec(version)?.[1] || "stable",
    surface: bridge ? "desktop" : "web",
    platform: clientPlatform(bridge),
    userAgent: navigator.userAgent,
    time: new Date().toISOString(),
  };
}

/** Opens More options by default when startup already failed in this tab a moment ago. */
function isRepeatFailure(now: number) {
  try {
    const previous = Number(sessionStorage.getItem(LAST_FAILURE_KEY));
    sessionStorage.setItem(LAST_FAILURE_KEY, String(now));
    return now - previous < REPEAT_FAILURE_MS;
  } catch {
    return false;
  }
}

function appendButton(parent: HTMLElement, label: string, run: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.onclick = run;
  parent.append(button);
  return button;
}

export function showBootError(error: unknown) {
  console.error("Supaterm failed to start.", error);
  const shell = document.getElementById("boot-shell");
  if (!shell) return;
  const bridge = window.desktopBridge;
  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.textContent = "Supaterm could not load.";
  content.append(title);
  appendButton(content, "Reload", () => window.location.reload());
  const details = document.createElement("details");
  details.open = isRepeatFailure(Date.now());
  const summary = document.createElement("summary");
  summary.textContent = "Recovery and error details";
  const guidance = document.createElement("p");
  guidance.textContent =
    "If reloading does not help, run the diagnostic command below. It creates a report you can review before sharing.";
  const command = document.createElement("code");
  command.textContent = FALLBACK_TRIAGE_COMMAND;
  void resolveTriageCommand(bridge).then((value) => {
    command.textContent = value;
  });
  const report = document.createElement("textarea");
  report.readOnly = true;
  report.value = buildErrorReport(error, readEnvironment(bridge));
  report.setAttribute("aria-label", "Error report");
  details.append(summary, guidance, command, report);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  appendButton(details, "Copy report", () => {
    void navigator.clipboard.writeText(report.value).then(
      () => {
        status.textContent = "Copied.";
      },
      () => {
        report.focus();
        report.select();
        status.textContent = COPY_BLOCKED;
      },
    );
  });
  const issue = document.createElement("a");
  issue.href = ISSUE_URL;
  issue.textContent = "Report an issue";
  issue.target = "_blank";
  issue.rel = "noopener noreferrer";
  const download = document.createElement("a");
  download.href = DOWNLOAD_URL;
  download.textContent = "Download Supaterm";
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  details.append(status, issue, document.createTextNode(" "), download);
  if (bridge) {
    const update = appendButton(details, "Check for updates", () => {
      void bridge.checkForUpdate().catch(() => {
        status.textContent = "Could not check for updates.";
      });
    });
    const applyUpdate = (state: DesktopUpdateState) => {
      const action = updateActionFor(state);
      if (action?.kind === "download") {
        update.textContent = "Download update";
        update.onclick = () => {
          void bridge.downloadUpdate().catch(() => {
            status.textContent = UPDATE_DOWNLOAD_FAILED;
          });
        };
      } else if (action?.kind === "install") {
        update.textContent = "Restart to update";
        update.onclick = () => {
          void bridge.installUpdate().catch(() => {
            status.textContent = UPDATE_INSTALL_FAILED;
          });
        };
      } else if (action?.kind === "downloading") {
        update.textContent = `Downloading ${action.percent}%`;
        update.disabled = true;
      } else {
        update.textContent = "Check for updates";
        update.disabled = false;
      }
    };
    void bridge
      .getUpdateState()
      .then(applyUpdate)
      .catch(() => {});
    bridge.onUpdateState(applyUpdate);
  }
  content.append(details);
  shell.replaceChildren(content);
}
