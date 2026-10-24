import { BOLT_COMPUTER_STATES, type BoltComputerState } from "./boltComputer/faces";
import {
  DEFAULT_SETTINGS,
  mountBoltComputer,
  type BoltComputerSettings,
} from "./boltComputer/mount";

export const SHELLS = [
  ["Cream", "#e2dbca"],
  ["Sage", "#8fa58a"],
  ["Teal", "#1f8189"],
  ["Tangerine", "#e2762a"],
  ["Rose", "#d98c9a"],
  ["Graphite", "#3a3d44"],
] as const;

// The first three are the bolt's colours on the Latest, Nightly and Dev app icons.
export const PHOSPHORS = [
  ["Latest", "#fff06a"],
  ["Nightly", "#da6aff"],
  ["Dev", "#6adaff"],
  ["Green", "#7dff9a"],
  ["Amber", "#ffb347"],
  ["White", "#eef2ff"],
] as const;

export const SPEEDS = [0.5, 1, 1.5, 2] as const;

export const STATE_COPY: Record<
  BoltComputerState,
  { readonly name: string; readonly hint: string }
> = {
  idle: { name: "Idle", hint: "The bolt, steady. It turns to follow your cursor; click it." },
  thinking: { name: "Thinking", hint: "Leans in, side to side, while the bolt flickers." },
  working: { name: "Working", hint: "Current runs down the bolt. A busy bob, a hop now and then." },
  error: { name: "Error", hint: "Red phosphor, a torn screen and a shake of the head." },
};

const HEX = /^[0-9a-f]{6}$/i;

const isState = (value: string | null): value is BoltComputerState =>
  BOLT_COMPUTER_STATES.some((state) => state === value);

const colour = (value: string | null, fallback: string) =>
  value !== null && HEX.test(value) ? `#${value.toLowerCase()}` : fallback;

/** Settings from a studio URL's query, defaulting anything missing or malformed. */
export function settingsFromSearch(search: string): BoltComputerSettings {
  const query = new URLSearchParams(search);
  const state = query.get("state");
  const speed = Number(query.get("speed"));
  return {
    state: isState(state) ? state : DEFAULT_SETTINGS.state,
    shell: colour(query.get("shell"), DEFAULT_SETTINGS.shell),
    phosphor: colour(query.get("phosphor"), DEFAULT_SETTINGS.phosphor),
    speed: SPEEDS.some((s) => s === speed) ? speed : DEFAULT_SETTINGS.speed,
    paused: query.get("paused") === "1",
    interactive: query.get("follow") !== "0",
    floorShadow: query.get("shadow") !== "0",
  };
}

/** The query that reproduces `settings`, naming only what differs from the defaults. */
export function searchFromSettings(settings: BoltComputerSettings): string {
  const query = new URLSearchParams();
  if (settings.state !== DEFAULT_SETTINGS.state) query.set("state", settings.state);
  if (settings.shell !== DEFAULT_SETTINGS.shell) query.set("shell", settings.shell.slice(1));
  if (settings.phosphor !== DEFAULT_SETTINGS.phosphor) {
    query.set("phosphor", settings.phosphor.slice(1));
  }
  if (settings.speed !== DEFAULT_SETTINGS.speed) query.set("speed", String(settings.speed));
  if (settings.paused) query.set("paused", "1");
  if (!settings.interactive) query.set("follow", "0");
  if (!settings.floorShadow) query.set("shadow", "0");
  const text = query.toString();
  return text ? `?${text}` : "";
}

const isDefault = (settings: BoltComputerSettings) => searchFromSettings(settings) === "";

/** `settings` with one control's value applied, as written in the page's markup. */
function withSetting(
  settings: BoltComputerSettings,
  key: string,
  raw: string,
): BoltComputerSettings {
  switch (key) {
    case "state":
      return isState(raw) ? { ...settings, state: raw } : settings;
    case "shell":
      return { ...settings, shell: raw };
    case "phosphor":
      return { ...settings, phosphor: raw };
    case "speed":
      return { ...settings, speed: Number(raw) };
    case "interactive":
      return { ...settings, interactive: raw === "true" };
    case "floorShadow":
      return { ...settings, floorShadow: raw === "true" };
    default:
      return settings;
  }
}

const nameOf = (swatches: ReadonlyArray<readonly [string, string]>, hex: string) =>
  swatches.find(([, value]) => value === hex)?.[0] ?? hex;

/** `canvas` cropped to what is drawn on it, with a little room round it, as a PNG. */
function croppedPng(canvas: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
  const { width, height } = canvas;
  const alpha = canvas.getContext("2d")?.getImageData(0, 0, width, height).data;
  if (!alpha) return callback(null);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[(y * width + x) * 4 + 3] ?? 0) < 8) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return callback(null);
  const margin = Math.round(width * 0.03);
  const out = document.createElement("canvas");
  out.width = right - left + 1 + margin * 2;
  out.height = bottom - top + 1 + margin * 2;
  out.getContext("2d")?.drawImage(canvas, margin - left, margin - top);
  out.toBlob(callback, "image/png");
}

/** Wires the studio page under `root`: the stage, the state picker and the controls. */
export function startStudio(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>("[data-stage]");
  if (!stage) return;
  let settings = settingsFromSearch(location.search);
  const computer = mountBoltComputer(stage, settings);
  const thumbSettings = (state: BoltComputerState): BoltComputerSettings => ({
    ...settings,
    state,
    paused: true,
    interactive: false,
    floorShadow: false,
  });
  const thumbs = Array.from(root.querySelectorAll<HTMLElement>("[data-thumb]")).flatMap((el) => {
    const state = el.dataset.thumb ?? null;
    if (!isState(state)) return [];
    const thumb = mountBoltComputer(el, thumbSettings(state));
    return thumb ? [{ state, thumb }] : [];
  });

  const text = (selector: string, value: string) => {
    const el = root.querySelector(selector);
    if (el) el.textContent = value;
  };

  const render = () => {
    computer?.update(settings);
    for (const { state, thumb } of thumbs) thumb.update(thumbSettings(state));
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-setting]")) {
      const key = button.dataset.setting as keyof BoltComputerSettings;
      button.setAttribute("aria-pressed", String(String(settings[key]) === button.dataset.value));
    }
    for (const input of root.querySelectorAll<HTMLInputElement>("input[data-setting]")) {
      const key = input.dataset.setting === "shell" ? "shell" : "phosphor";
      const custom =
        root.querySelector(`button[data-setting="${key}"][aria-pressed="true"]`) === null;
      input.value = settings[key];
      input.parentElement?.setAttribute("data-active", String(custom));
      input.parentElement?.style.setProperty("--custom", custom ? settings[key] : "");
    }
    text("[data-caption-name]", STATE_COPY[settings.state].name);
    text("[data-caption-hint]", STATE_COPY[settings.state].hint);
    text('[data-value-of="shell"]', nameOf(SHELLS, settings.shell));
    text('[data-value-of="phosphor"]', nameOf(PHOSPHORS, settings.phosphor));
    text('[data-action="pause"]', settings.paused ? "Play" : "Pause");
    root.querySelector('[data-action="reset"]')?.toggleAttribute("hidden", isDefault(settings));
    stage.classList.toggle("is-interactive", settings.interactive && !settings.paused);
    history.replaceState(null, "", `${location.pathname}${searchFromSettings(settings)}`);
  };

  const flash = (button: HTMLElement, label: string) => {
    const original = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = original), 1400);
  };

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest<HTMLButtonElement>("button[data-setting]");
    if (option?.dataset.setting && option.dataset.value !== undefined) {
      settings = withSetting(settings, option.dataset.setting, option.dataset.value);
      render();
      return;
    }
    const action = target?.closest<HTMLButtonElement>("[data-action]");
    switch (action?.dataset.action) {
      case "pause":
        settings = { ...settings, paused: !settings.paused };
        render();
        break;
      case "reset":
        settings = DEFAULT_SETTINGS;
        render();
        break;
      case "copy":
        void navigator.clipboard.writeText(location.href).then(
          () => flash(action, "Copied"),
          () => flash(action, "Copy failed"),
        );
        break;
      case "download":
        if (!computer) break;
        croppedPng(computer.canvas, (blob) => {
          if (!blob) return;
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "supaterm-bolt-computer.png";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        });
        break;
    }
  });

  root.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.dataset.setting) return;
    settings = withSetting(settings, input.dataset.setting, input.value);
    render();
  });

  render();
}
