import { useLocation } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../index.css";
import { act, render } from "../../test/render";
import { AppRouteModal, AppRouteModalClose } from "./AppRouteModal";
import { MainAppLocationTracker } from "./sidebar/mainAppLocation";

function ModalRoutes() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <>
      <MainAppLocationTracker />
      {pathname.startsWith("/settings") ? (
        <AppRouteModal label="Settings">
          <AppRouteModalClose />
        </AppRouteModal>
      ) : null}
    </>
  );
}

describe("AppRouteModal", () => {
  it.each(["button", "escape"] as const)(
    "returns to the opening utility page and search parameters on %s close",
    async (close) => {
      await using screen = await render(<ModalRoutes />, {
        router: "/pull-requests?state=open",
      });
      await act(() => screen.router!.navigate({ href: "/settings/appearance" }));
      await expect.element(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

      if (close === "button") await userEvent.click(page.getByRole("button", { name: "Close" }));
      else await userEvent.keyboard("{Escape}");

      await vi.waitFor(() =>
        expect(screen.router!.state.location.href).toBe("/pull-requests?state=open"),
      );
    },
  );
});
