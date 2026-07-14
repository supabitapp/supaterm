import { filesystemSource } from "blume/sources/filesystem.ts";
import type { ContentSource, SourceEntry } from "blume/sources/types.ts";

const titlePattern = /^# (?<title>[^\r\n]+)\r?\n(?:\r?\n)?/u;

const prepareEntry = (entry: SourceEntry, skillsRef: string): SourceEntry => {
  const match = titlePattern.exec(entry.body.text);
  const title = match?.groups?.title;
  if (!match || !title) {
    throw new Error(`CLI reference ${entry.ref} must start with a title`);
  }

  const body = entry.body.text.slice(match[0].length);

  return {
    ...entry,
    body: {
      ...entry.body,
      text: body,
    },
    data: { ...entry.data, title },
    editUrl: `https://github.com/supabitapp/supaterm-skills/edit/${skillsRef}/skill-data/core/references/${entry.ref}`,
    raw: `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`,
  };
};

export const makeCliReferenceSource = (
  repositoryRoot: string,
  skillsRef: string,
): ContentSource => {
  const files = filesystemSource({
    exclude: [],
    include: ["**/*.md"],
    name: "cli-reference",
    prefix: "guides/cli/reference",
    projectRoot: repositoryRoot,
    root: "integrations/supaterm-skills/skill-data/core/references",
  });

  return {
    load: async () => {
      const result = await files.load();
      return {
        ...result,
        entries: result.entries.map((entry) => prepareEntry(entry, skillsRef)),
      };
    },
    name: files.name,
    prefix: files.prefix,
    staged: true,
    validate: files.validate,
    watch: files.watch,
  };
};
