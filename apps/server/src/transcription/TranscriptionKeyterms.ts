import type { ServerProviderSkill } from "@supaterm/contracts";

// Claude Code sends this list with every dictation.
const FIXED_TERMS = [
  "MCP",
  "symlink",
  "grep",
  "regex",
  "localhost",
  "codebase",
  "TypeScript",
  "JSON",
  "OAuth",
  "webhook",
  "gRPC",
  "dotfiles",
  "subagent",
  "worktree",
];

// What people name while directing agents here, which a speech model hears as "super term",
// "cloud", or "code X".
const SUPATERM_TERMS = ["Supaterm", "Claude", "Codex", "Opus", "Sonnet", "Haiku", "GPT"];

const isWordLength = (word: string) => word.length > 2 && word.length <= 20;

const splitWords = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_./\s]+/)
    .map((word) => word.trim())
    .filter(isWordLength);

/**
 * Hyphenated skill names split into ordinary words the speech model already
 * knows, and enough of them would crowd everything else out of the cap.
 */
const isSingleWordSkill = (skill: ServerProviderSkill) =>
  skill.enabled && isWordLength(skill.name) && !/[\s\-_.:]/.test(skill.name);

const isProjectName = (name: string | undefined): name is string =>
  name !== undefined && name.length > 2 && name.length <= 50;

export function keytermCandidates(input: {
  readonly projectTitle: string | undefined;
  /** The project root's folder name, which Claude Code sends; a renamed title loses it. */
  readonly projectFolder: string | undefined;
  readonly branch: string | undefined;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}): ReadonlyArray<string> {
  const projectNames = [input.projectTitle?.trim(), input.projectFolder?.trim()].filter(
    isProjectName,
  );
  return [
    ...projectNames,
    ...(input.branch ? splitWords(input.branch) : []),
    ...SUPATERM_TERMS,
    ...FIXED_TERMS,
    ...input.skills.filter(isSingleWordSkill).map((skill) => skill.name),
  ];
}
