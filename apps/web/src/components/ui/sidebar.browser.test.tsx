import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider, SidebarTrigger } from "./sidebar";

it("announces desktop visibility changes without moving focus into the sidebar", async () => {
  await page.viewport(1280, 900);
  await using screen = await render(
    <SidebarProvider>
      <SidebarTrigger />
    </SidebarProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

  await userEvent.click(trigger);
  await expect.element(page.getByText("Sidebar hidden", { exact: true })).toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();

  await userEvent.click(trigger);
  await expect.element(page.getByText("Sidebar shown", { exact: true })).toBeInTheDocument();

  await userEvent.click(trigger);
  await expect.element(page.getByText("Sidebar hidden", { exact: true })).toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});
