import { render as renderUi } from "../../../test/render";
import "../../index.css";

import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@supaterm/shared/usageLimits";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const clipboard = vi.hoisted(() => ({ writes: [] as string[] }));
vi.mock(import("../../hooks/useCopyToClipboard"), async (importOriginal) => ({
  ...(await importOriginal()),
  writeTextToClipboard: (async (value: string) => {
    clipboard.writes.push(value);
    return true;
  }) as never,
}));

import { ThreadErrorBanner } from "./ThreadErrorBanner";

it("expands even a short JSON error to its exact diagnostics and collapses back to its message", async () => {
  const error = '  {"error": {"message":"Turn failed", "code":"unsupported_value"}}\t ';

  await using screen = await renderUi(<ThreadErrorBanner error={error} />);
  const { container } = screen;

  await expect.element(page.getByText("Turn failed", { exact: true })).toBeVisible();
  expect(container.textContent).not.toContain("unsupported_value");

  await page.getByRole("button", { name: "Show full error" }).click();

  const diagnostics = page.getByText(error, { exact: true });
  await expect.element(diagnostics).toBeVisible();
  expect(diagnostics.element().textContent).toBe(error);

  await page.getByRole("button", { name: "Show less" }).click();

  await expect.element(page.getByText("Turn failed", { exact: true })).toBeVisible();
  expect(container.textContent).not.toContain("unsupported_value");
});

it("offers a workspace limit's admin request and a personal limit's usage settings", async () => {
  clipboard.writes = [];
  await using screen = await renderUi(
    <ThreadErrorBanner error="Usage limit" errorCode={CHATGPT_WORKSPACE_USAGE_LIMIT_CODE} />,
  );

  await expect.element(page.getByText("ChatGPT usage limit reached")).toBeVisible();
  expect(page.getByRole("button", { name: "Manage usage" }).elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Copy request for admin" }).click();
  expect(clipboard.writes).toEqual([CHATGPT_WORKSPACE_ADMIN_REQUEST]);

  await screen.rerender(
    <ThreadErrorBanner error="Usage limit" errorCode={CHATGPT_USAGE_LIMIT_CODE} />,
  );
  await expect.element(page.getByRole("button", { name: "Manage usage" })).toBeVisible();
  expect(page.getByRole("button", { name: "Copy request for admin" }).elements()).toHaveLength(0);
});
