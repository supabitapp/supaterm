import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Moves Playwright's mouse off the page. */
    resetPointer: () => Promise<void>;
  }
}

beforeEach(async () => {
  await commands.resetPointer();
});
