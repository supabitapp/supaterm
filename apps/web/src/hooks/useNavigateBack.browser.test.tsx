import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useEscapeToGoBack } from "./useNavigateBack";

function Page({ onEscape }: { onEscape?: () => void }) {
  useEscapeToGoBack(onEscape);
  return <main>Utility page</main>;
}

it("uses the router's history when Escape leaves a utility page", async () => {
  await using screen = await render(<Page />, { router: "/first" });
  await screen.router!.navigate({ href: "/pull-requests" });
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(screen.router!.state.location.pathname).toBe("/first"));
});

it("falls back to the workspace and honors a replacement close handler", async () => {
  await using screen = await render(<Page />, { router: "/pull-requests" });
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(screen.router!.state.location.pathname).toBe("/"));
  const onEscape = vi.fn();
  await screen.rerender(<Page onEscape={onEscape} />);
  await userEvent.keyboard("{Escape}");
  expect(onEscape).toHaveBeenCalledOnce();
});
