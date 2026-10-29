import {
  createDialKit,
  createDialRoot,
  type DialConfig,
  type DialKitValueUpdates,
  type ResolvedValues,
} from "dialkit/vanilla";

import { BOLT_COMPUTER_STATES, type BoltComputerState } from "./boltComputer/faces";
import {
  DEFAULT_SETTINGS,
  mountBoltComputer,
  type BoltComputerSettings,
} from "./boltComputer/mount";

export const STATE_COPY: Record<
  BoltComputerState,
  { readonly name: string; readonly hint: string }
> = {
  idle: { name: "Idle", hint: "The bolt, steady. It turns to follow your cursor; click it." },
  thinking: { name: "Thinking", hint: "Leans in, side to side, while the bolt flickers." },
  working: { name: "Working", hint: "Current runs down the bolt. A busy bob, a hop now and then." },
  error: { name: "Error", hint: "Red phosphor, a torn screen and a shake of the head." },
};

const MIN_SPEED = 0.25;
const MAX_SPEED = 2;

const PANEL = {
  screen: {
    type: "select",
    options: BOLT_COMPUTER_STATES.map((state) => ({ value: state, label: STATE_COPY[state].name })),
    default: DEFAULT_SETTINGS.state,
  },
  shell: { type: "color", default: DEFAULT_SETTINGS.shell },
  phosphor: { type: "color", default: DEFAULT_SETTINGS.phosphor },
  knobs: {
    visible: DEFAULT_SETTINGS.controls,
    color: { type: "color", default: DEFAULT_SETTINGS.knobs },
  },
  speed: [DEFAULT_SETTINGS.speed, MIN_SPEED, MAX_SPEED, 0.25],
  paused: DEFAULT_SETTINGS.paused,
  followPointer: DEFAULT_SETTINGS.interactive,
  floorShadow: DEFAULT_SETTINGS.floorShadow,
} satisfies DialConfig;

type PanelValues = ResolvedValues<typeof PANEL>;

const HEX = /^#?([0-9a-f]{6})$/i;

const isState = (value: string | null): value is BoltComputerState =>
  BOLT_COMPUTER_STATES.some((state) => state === value);

const colour = (value: string | null, fallback: string) => {
  const hex = value?.match(HEX)?.[1];
  return hex ? `#${hex.toLowerCase()}` : fallback;
};

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour the panel's picker emits (OKLCH, P3, alpha), as the `#rrggbb` the renderer reads. */
function opaqueHex(css: string, fallback: string) {
  if (HEX.test(css)) return colour(css, fallback);
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Settings from a studio URL's query, defaulting anything missing or malformed. */
export function settingsFromSearch(search: string): BoltComputerSettings {
  const query = new URLSearchParams(search);
  const state = query.get("state");
  const speed = Number(query.get("speed"));
  return {
    state: isState(state) ? state : DEFAULT_SETTINGS.state,
    shell: colour(query.get("shell"), DEFAULT_SETTINGS.shell),
    phosphor: colour(query.get("phosphor"), DEFAULT_SETTINGS.phosphor),
    knobs: colour(query.get("knobs"), DEFAULT_SETTINGS.knobs),
    controls: query.get("controls") !== "0",
    speed: speed >= MIN_SPEED && speed <= MAX_SPEED ? speed : DEFAULT_SETTINGS.speed,
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
  if (settings.knobs !== DEFAULT_SETTINGS.knobs) query.set("knobs", settings.knobs.slice(1));
  if (!settings.controls) query.set("controls", "0");
  if (settings.speed !== DEFAULT_SETTINGS.speed) query.set("speed", String(settings.speed));
  if (settings.paused) query.set("paused", "1");
  if (!settings.interactive) query.set("follow", "0");
  if (!settings.floorShadow) query.set("shadow", "0");
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const panelValuesOf = (settings: BoltComputerSettings) =>
  ({
    screen: settings.state,
    shell: settings.shell,
    phosphor: settings.phosphor,
    knobs: { visible: settings.controls, color: settings.knobs },
    speed: settings.speed,
    paused: settings.paused,
    followPointer: settings.interactive,
    floorShadow: settings.floorShadow,
  }) satisfies DialKitValueUpdates<typeof PANEL>;

export const settingsOfPanel = (
  values: PanelValues,
  previous: BoltComputerSettings,
): BoltComputerSettings => ({
  state: isState(values.screen) ? values.screen : previous.state,
  shell: opaqueHex(values.shell, previous.shell),
  phosphor: opaqueHex(values.phosphor, previous.phosphor),
  knobs: opaqueHex(values.knobs.color, previous.knobs),
  controls: values.knobs.visible,
  speed: values.speed,
  paused: values.paused,
  interactive: values.followPointer,
  floorShadow: values.floorShadow,
});

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

/** Wires the studio page under `root`: the stage, the state picker and the DialKit panel. */
export function startStudio(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>("[data-stage]");
  const panel = root.querySelector<HTMLElement>("[data-panel]");
  if (!stage || !panel) return;
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

  const query = () => `${location.pathname}${searchFromSettings(settings)}`;
  // Browsers cap how often history can be rewritten, and dragging a colour fires on every step.
  let urlWrite = 0;
  const writeUrl = () => {
    clearTimeout(urlWrite);
    urlWrite = window.setTimeout(() => history.replaceState(null, "", query()), 250);
  };

  const text = (selector: string, value: string) => {
    const el = root.querySelector(selector);
    if (el) el.textContent = value;
  };

  const render = () => {
    computer?.update(settings);
    for (const { state, thumb } of thumbs) thumb.update(thumbSettings(state));
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-screen]")) {
      button.setAttribute("aria-pressed", String(button.dataset.screen === settings.state));
    }
    text("[data-caption-name]", STATE_COPY[settings.state].name);
    text("[data-caption-hint]", STATE_COPY[settings.state].hint);
    root
      .querySelector('[data-action="reset"]')
      ?.toggleAttribute("hidden", searchFromSettings(settings) === "");
    stage.classList.toggle("is-interactive", settings.interactive && !settings.paused);
    writeUrl();
  };

  createDialRoot({ mode: "inline", target: panel, theme: "dark", versions: "menu" });
  const kit = createDialKit("Bolt computer", PANEL);
  kit.setValues(panelValuesOf(settings));
  kit.subscribe((values) => {
    settings = settingsOfPanel(values, settings);
    render();
  });

  const flash = (button: HTMLElement, label: string) => {
    button.dataset.label ??= button.textContent ?? "";
    const original = button.dataset.label;
    button.textContent = label;
    setTimeout(() => (button.textContent = original), 1400);
  };

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const screen = target?.closest<HTMLButtonElement>("button[data-screen]")?.dataset.screen;
    if (screen !== undefined) {
      kit.setValue("screen", screen);
      return;
    }
    const action = target?.closest<HTMLButtonElement>("[data-action]");
    switch (action?.dataset.action) {
      case "reset":
        kit.resetValues();
        break;
      case "copy":
        void navigator.clipboard.writeText(new URL(query(), location.origin).href).then(
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
}
