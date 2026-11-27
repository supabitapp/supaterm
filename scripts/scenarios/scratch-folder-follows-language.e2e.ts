/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "The project folder for threads without a project follows the app language",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    const project = await supaterm.project("scenario-scratch");
    const thread = await supaterm.thread({ project, title: "Scratch work", messages: ["Start"] });

    // The scenario home is inside a Git checkout, where the server disables native scratch.
    // Advertise the seeded workspace as scratch while leaving the real project and thread in place.
    await browser.addInitScript((scratchWorkspaceRoot) => {
      const configRequests = new WeakMap<WebSocket, string>();
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string") {
          for (const request of [JSON.parse(data)].flat()) {
            if (request?._tag === "Request" && request.tag === "subscribeServerConfig") {
              configRequests.set(this, String(request.id));
            }
          }
        }
        return send.call(this, data);
      };
      const addEventListener = WebSocket.prototype.addEventListener;
      WebSocket.prototype.addEventListener = function (
        this: WebSocket,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type !== "message" || typeof listener !== "function") {
          return addEventListener.call(this, type, listener, options);
        }
        let pending = "";
        return addEventListener.call(
          this,
          type,
          (event: Event) => {
            const data = (event as MessageEvent).data;
            if (typeof data !== "string") return listener.call(this, event);
            // The server splits a large frame into parts; all but the last start with this mark.
            if (data.startsWith("\u001e")) {
              pending += data.slice(1);
              return;
            }
            const joined = pending !== "";
            const parsed = JSON.parse(pending + data);
            pending = "";
            let changed = joined;
            for (const message of [parsed].flat()) {
              if (
                message?._tag !== "Chunk" ||
                String(message.requestId) !== configRequests.get(this)
              )
                continue;
              for (const value of message.values) {
                if (value.type === "snapshot") {
                  value.config.scratchWorkspaceRoot = scratchWorkspaceRoot;
                  changed = true;
                }
              }
            }
            return listener.call(
              this,
              changed ? new MessageEvent("message", { data: JSON.stringify(parsed) }) : event,
            );
          },
          options,
        );
      } as typeof WebSocket.prototype.addEventListener;
    }, project);

    // The sidebar's project filter names each project group, the scratch one included.
    const projectFilter = async () => {
      await screen.getByRole("button", /^(?:Thread list options|スレッド一覧のオプション)$/).tap();
      await screen.getByRole("menuitem").first().tap();
      return screen.getByRole("menuitemradio").filter({ hasText: /No project|プロジェクトなし/ });
    };

    await supaterm.open(thread);
    await expect(await projectFilter()).toContainText("No project", { timeout: 60_000 });
    await browser.keyboard.press("Escape");
    await browser.keyboard.press("Escape");
    await screen.getByRole("menu").first().waitFor({ state: "hidden" });

    // Settings opens over the mounted sidebar, which must follow the switch without a reload.
    await screen.getByRole("button", "Settings", { exact: true }).tap();
    await screen.getByLabel("Language", { exact: true }).tap();
    await screen.getByText("日本語", { exact: true }).tap();
    await screen.getByLabel("言語", { exact: true }).waitFor();
    await browser.keyboard.press("Escape");
    await screen.getByRole("dialog").waitFor({ state: "hidden" });

    const scratch = await projectFilter();
    await scratch.waitFor({ timeout: 60_000 });
    await app.screenshot("scratch-folder-in-japanese");
    await expect(scratch).toContainText("プロジェクトなし");
  },
);
