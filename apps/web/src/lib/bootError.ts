import type { DesktopBridge } from "@supaterm/contracts";
import {
  Check,
  Copy,
  ICON_SVG_ROOT_ATTRIBUTES,
  iconSvgElements,
  type IconNode,
} from "@supaterm/icons/nodes";

const FALLBACK_TRIAGE_COMMAND = "npx supaterm triage";

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

// The boot screen renders before React, so it takes the icons as SVG markup.
const icon = (node: IconNode) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" ${ICON_SVG_ROOT_ATTRIBUTES} aria-hidden="true">${iconSvgElements(node)}</svg>`;
const COPY_ICON = icon(Copy);
const CHECK_ICON = icon(Check);

export function showBootError(error: unknown) {
  console.error("Supaterm failed to start.", error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const title = document.createElement("h1");
  title.textContent = "Supaterm could not load";
  content.append(title);

  if (import.meta.env.DEV && error instanceof Error) {
    const detail = document.createElement("p");
    detail.append(Object.assign(document.createElement("code"), { textContent: error.message }));
    content.append(detail);
  }

  const reload = document.createElement("button");
  reload.id = "boot-error-reload";
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());

  const hint = document.createElement("p");
  hint.textContent = "If reloading does not help, run this in a terminal to find the cause:";

  const command = document.createElement("code");
  command.textContent = FALLBACK_TRIAGE_COMMAND;
  const commandRow = document.createElement("div");
  commandRow.id = "boot-error-command";
  commandRow.append(command);
  // The clipboard API exists only in secure contexts, such as HTTPS and the desktop app.
  if (window.isSecureContext) {
    const copy = document.createElement("button");
    copy.id = "boot-error-copy";
    copy.type = "button";
    copy.title = "Copy command";
    copy.setAttribute("aria-label", "Copy command");
    copy.innerHTML = COPY_ICON;
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(command.textContent ?? "").then(
        () => {
          copy.innerHTML = CHECK_ICON;
          copy.setAttribute("aria-label", "Copied");
        },
        (copyError) => console.warn("Could not copy the triage command.", copyError),
      );
    });
    commandRow.append(copy);
  }

  const triage = document.createElement("div");
  triage.id = "boot-error-triage";
  triage.append(hint, commandRow);

  content.append(reload, triage);
  bootShell.replaceChildren(content);

  void resolveTriageCommand(window.desktopBridge).then((value) => (command.textContent = value));
}
