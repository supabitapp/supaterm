/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

declare global {
  interface Window {
    voiceSetupDevices: {
      holdNextRefresh: () => void;
      held: Promise<void>;
      replaceMicrophone: () => void;
      releaseOld: () => Promise<void>;
    };
  }
}

test(
  "Voice settings keep the current microphone after an older refresh finishes",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    await supaterm.project("demo");

    await browser.addInitScript(() => {
      const oldMicrophone = { kind: "audioinput", deviceId: "desk", label: "Desk microphone" };
      const newMicrophone = { kind: "audioinput", deviceId: "usb", label: "USB microphone" };
      const { promise: held, resolve: markHeld } = Promise.withResolvers<void>();
      const { promise: old, resolve: release } =
        Promise.withResolvers<Array<typeof oldMicrophone>>();
      let holdNext = false;
      let current = oldMicrophone;
      const media = navigator.mediaDevices;
      Object.defineProperty(media, "enumerateDevices", {
        configurable: true,
        value: () => {
          if (!holdNext) return Promise.resolve([current]);
          holdNext = false;
          markHeld();
          return old;
        },
      });
      window.voiceSetupDevices = {
        holdNextRefresh: () => {
          holdNext = true;
          media.dispatchEvent(new Event("devicechange"));
        },
        held,
        replaceMicrophone: () => {
          current = newMicrophone;
          media.dispatchEvent(new Event("devicechange"));
        },
        releaseOld: async () => {
          release([oldMicrophone]);
          // Let enumeration and its React update settle before inspecting the picker.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        },
      };
    });

    await supaterm.open("/settings/voice");
    const microphone = screen.getByRole("combobox", "Microphone", { exact: true });
    await expect(microphone).toHaveText("System default");
    await browser.evaluate(async () => {
      window.voiceSetupDevices.holdNextRefresh();
      await window.voiceSetupDevices.held;
      window.voiceSetupDevices.replaceMicrophone();
      return null;
    });
    await microphone.tap();
    const connected = screen.getByRole("option", "USB microphone", { exact: true });
    await connected.waitFor();

    await browser.evaluate(async () => {
      await window.voiceSetupDevices.releaseOld();
      return null;
    });
    await app.screenshot("microphones-after-both-refreshes");
    const labels = await browser.evaluate(() =>
      Array.from(
        document.querySelectorAll('[role="listbox"] [role="option"]'),
        (option) =>
          option.querySelector('[data-slot="select-item-text"] > span')?.firstChild?.textContent ??
          "",
      ),
    );
    expect(labels, "The microphone picker lists only the current devices").toEqual([
      "System default",
      "USB microphone",
    ]);
  },
);
