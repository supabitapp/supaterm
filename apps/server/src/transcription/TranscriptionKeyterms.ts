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

export function keytermCandidates(input: {
  readonly projectTitle: string | undefined;
  readonly branch: string | undefined;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}): ReadonlyArray<string> {
  const projectTitle = input.projectTitle?.trim();
  return [
    ...(projectTitle && projectTitle.length > 2 && projectTitle.length <= 50 ? [projectTitle] : []),
    ...(input.branch ? splitWords(input.branch) : []),
    ...FIXED_TERMS,
    ...input.skills.filter(isSingleWordSkill).map((skill) => skill.name),
  ];
}
