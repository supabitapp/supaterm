export type LinuxPasswordStorePreference =
  | "auto"
  | "gnome-libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6";
export type LinuxPasswordStoreSwitch = Exclude<LinuxPasswordStorePreference, "auto">;

export const DEFAULT_LINUX_PASSWORD_STORE: LinuxPasswordStorePreference = "auto";

const ELECTRON_LIBSECRET_DESKTOPS = new Set([
  "Deepin",
  "GNOME",
  "Pantheon",
  "UKUI",
  "Unity",
  "X-Cinnamon",
  "XFCE",
]);
const ELECTRON_KDE_DESKTOP = "KDE";
const ELECTRON_UNPROTECTED_DESKTOPS = new Set(["LXQt"]);

export function normalizeLinuxPasswordStorePreference(
  value: unknown,
): LinuxPasswordStorePreference {
  return value === "gnome-libsecret" ||
    value === "kwallet" ||
    value === "kwallet5" ||
    value === "kwallet6"
    ? value
    : DEFAULT_LINUX_PASSWORD_STORE;
}

export function resolveLinuxPasswordStoreSwitch(input: {
  readonly preference: LinuxPasswordStorePreference;
  readonly env: NodeJS.ProcessEnv;
}): LinuxPasswordStoreSwitch | null {
  if (input.preference !== "auto") {
    return input.preference;
  }

  return electronSelectsProtectedBackend(input.env) ? null : "gnome-libsecret";
}

function electronSelectsProtectedBackend(env: NodeJS.ProcessEnv): boolean {
  for (const name of splitDesktopNameList(env.XDG_CURRENT_DESKTOP)) {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed === ELECTRON_KDE_DESKTOP || ELECTRON_LIBSECRET_DESKTOPS.has(trimmed)) {
      return true;
    }
    if (ELECTRON_UNPROTECTED_DESKTOPS.has(trimmed)) {
      return false;
    }
  }

  return false;
}

function splitDesktopNameList(value: string | undefined): string[] {
  return value?.split(":") ?? [];
}
