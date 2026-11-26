import { getReactI18nCache, msg } from "gt-react";
import { expect, it } from "vite-plus/test";

import de from "../../../mobile/src/i18n/translations/de.json";
import { m, setActiveLocale } from "./messages";

// The mobile test build of GT only knows English; this browser runtime hashes source and context.
it("names the mobile settings archive page with the noun in German", () => {
  getReactI18nCache().updateTranslations({
    de: Object.fromEntries(
      Object.entries(de).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  });
  setActiveLocale("de");
  using _locale = { [Symbol.dispose]: () => setActiveLocale("en") };
  expect(m(msg("Archive", { $context: "noun, settings page of archived threads" }))).toBe("Archiv");
});
