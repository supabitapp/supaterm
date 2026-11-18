import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";

vi.mock(import("../../appearanceFonts"), async (original) => ({
  ...(await original()),
  queryInstalledFontFamilies: async () => ({
    status: "granted" as const,
    families: ["3270 Nerd Font"],
  }),
}));

function GrantedPicker() {
  const enumeration = useFontEnumeration();
  return enumeration.status === "granted" ? (
    <FontFamilyPicker
      ariaLabel="Interface font family"
      defaultFamily="system-ui"
      selectedFamily=""
      onSelect={() => {}}
    />
  ) : null;
}

it("previews an installed family whose name CSS only accepts quoted", async () => {
  discoverInstalledFonts();
  await using _screen = await render(<GrantedPicker />);

  await userEvent.click(page.getByRole("combobox", { name: "Interface font family" }));
  const label = page.getByText("3270 Nerd Font", { exact: true });
  await expect.element(label).toBeVisible();

  expect((label.element() as HTMLElement).style.fontFamily).toBe('"3270 Nerd Font"');
});
