import { expect, it, vi } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";

import {
  remarkKeepWindowsPathDestinations,
  remarkKeepWindowsProsePaths,
} from "./markdownWindowsPaths.ts";

const plugins = [
  ["paths and destinations", remarkKeepWindowsPathDestinations],
  ["prose paths", remarkKeepWindowsProsePaths],
] as const;

it.each(plugins)("%s limits drive-path checks to the word containing each escape", (_, plugin) => {
  const processor = unified().use(remarkParse).use(plugin);
  const identifiers = Array.from({ length: 200 }, (_, index) => `metric_name_${index}`);
  const markdown = `Supported metrics: ${identifiers.map((name) => name.replaceAll("_", "\\_")).join(", ")}.`;
  const pattern = /(?:^|\W)[A-Za-z]:(?:[\\/]\S*)?$/.source;
  using test = vi.spyOn(RegExp.prototype, "test");

  const tree = processor.parse(markdown);
  const inspectedCharacters = test.mock.calls.reduce((total, [value], index) => {
    const context = test.mock.contexts[index];
    return context instanceof RegExp && context.source === pattern ? total + value.length : total;
  }, 0);
  expect(tree).toMatchObject({
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: `Supported metrics: ${identifiers.join(", ")}.` }],
      },
    ],
  });
  expect(inspectedCharacters).toBeGreaterThan(0);
  expect(inspectedCharacters).toBeLessThan(markdown.length * 2);
});

it.each(plugins)(
  "%s preserves prose paths and ordinary escapes across whitespace boundaries",
  (_, plugin) => {
    const processor = unified().use(remarkParse).use(plugin);
    for (const whitespace of [" ", "\t", "\u00a0", "\u2003", "\u202f", "\ufeff"]) {
      const markdown = String.raw`Before${whitespace}C:\Users\me\_build${whitespace}\*literal\*`;
      expect(processor.parse(markdown)).toMatchObject({
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: String.raw`Before${whitespace}C:\Users\me\_build${whitespace}*literal*`,
              },
            ],
          },
        ],
      });
    }
  },
);

it.each(plugins)("%s finds each escape's word after earlier escapes in the text", (_, plugin) => {
  const processor = unified().use(remarkParse).use(plugin);
  const markdown = String.raw`one\_two C:\a\_b \*x\* three\_four&#x20;D:\c\_d \*y\* *em*E:\e\_f \*z\*`;
  expect(processor.parse(markdown)).toMatchObject({
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: String.raw`one_two C:\a\_b *x* three_four D:\c\_d *y* ` },
          { type: "emphasis" },
          { type: "text", value: String.raw`E:\e\_f *z*` },
        ],
      },
    ],
  });
});

it.each([
  [String.raw`C:\R&D folder\.supaterm\shot.png`, String.raw`C:\R&D folder\.supaterm\shot.png`],
  [String.raw`C:\R&amp;D folder\.supaterm\shot.png`, String.raw`C:\R&D folder\.supaterm\shot.png`],
  [String.raw`C:\work\&stuff\.supaterm\shot.png`, String.raw`C:\work\&stuff\.supaterm\shot.png`],
  [String.raw`C:\work\&amp;lt;\.supaterm\shot.png`, String.raw`C:\work\&lt;\.supaterm\shot.png`],
])("preserves separators and decodes references once in %s", (authored, expected) => {
  const parser = unified().use(remarkParse).use(remarkKeepWindowsPathDestinations);
  for (const prefix of ["", "!"]) {
    expect(parser.parse(`${prefix}[shot](<${authored}>)`)).toMatchObject({
      children: [{ children: [{ url: expected }] }],
    });
  }
  expect(parser.parse(`[shot]: <${authored}>`)).toMatchObject({
    children: [{ type: "definition", url: expected }],
  });
});
