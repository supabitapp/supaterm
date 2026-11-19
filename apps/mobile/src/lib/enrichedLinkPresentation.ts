import type { ComposerContextRecord, EnvironmentId, ThreadId } from "@supaterm/contracts";
import {
  composerChipSizeSuffix,
  contextChipIcon,
  contextChipPresentation,
  contextRecordFileName,
  type ContextChipIconRef,
  UNAVAILABLE_CONTEXT_CHIP_PRESENTATION,
} from "./composerChipPresentation";
import type { SelectableMarkdownSkill } from "../native/SelectableMarkdownText.types";
import {
  formatComposerContextHref,
  parseComposerContextHref,
} from "@supaterm/shared/composerContextReferences";
import { hasThreadLinks, parseThreadLinkHref } from "@supaterm/shared/threadLinks";
import { EXTENSIONLESS_FILE_NAMES } from "@supaterm/shared/markdownLinks";

export function enrichedContextLinkPresentation(
  href: string,
  records?: ReadonlyArray<ComposerContextRecord>,
) {
  const reference = parseComposerContextHref(href);
  if (!reference)
    return undefined satisfies
      | { accent?: string; icon: ContextChipIconRef; label?: string }
      | undefined;
  const record = records?.find((candidate) => candidate.contextId === reference.contextId);
  const presentation =
    records && !record
      ? UNAVAILABLE_CONTEXT_CHIP_PRESENTATION
      : contextChipPresentation(reference.kind, record);
  const size = composerChipSizeSuffix(record);
  return {
    ...(presentation.accent ? { accent: presentation.accent } : {}),
    icon: contextChipIcon(presentation, contextRecordFileName(record)),
    ...(record && size ? { label: `${record.label} · ${size}` } : {}),
  } satisfies { accent?: string; icon: ContextChipIconRef; label?: string } | undefined;
}

export function enrichedThreadLinkPresentation(href: string) {
  if (!parseThreadLinkHref(href))
    return undefined satisfies { accent?: string; icon: ContextChipIconRef } | undefined;
  const presentation = contextChipPresentation("thread");
  return {
    ...(presentation.accent ? { accent: presentation.accent } : {}),
    icon: contextChipIcon(presentation, ""),
  } satisfies { accent?: string; icon: ContextChipIconRef } | undefined;
}

export interface ThreadChipTarget {
  readonly href: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly link: boolean;
}

export function threadChipTargets(
  environmentId: EnvironmentId,
  markdown: string,
  records?: ReadonlyArray<ComposerContextRecord>,
) {
  const targets = new Map<string, ThreadChipTarget>();
  if (hasThreadLinks(markdown)) {
    for (const [, href = ""] of markdown.matchAll(
      /\]\(<?(supaterm-thread:\/\/v[12]\/[^\s>)]+)>?\)/g,
    )) {
      const link = parseThreadLinkHref(href);
      if (link) {
        targets.set(href, {
          href,
          environmentId: link.environmentId ?? environmentId,
          threadId: link.threadId,
          link: true,
        });
      }
    }
  }
  for (const record of records ?? []) {
    if (record.kind !== "thread" || !("threadId" in record)) continue;
    const href = formatComposerContextHref("thread", record.contextId);
    targets.set(href, {
      href,
      environmentId: record.environmentId,
      threadId: record.threadId,
      link: false,
    });
  }
  return [...targets.values()];
}

export function enrichedLinkVariantPattern(url: string) {
  return `^${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

const EXTENSIONLESS_FILE_NAME_PATTERN = [...EXTENSIONLESS_FILE_NAMES]
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export const ENRICHED_INLINE_FILE_LINK_REGEX = new RegExp(
  String.raw`^(?!\S*:\/\/)(?:(?:\.{1,2}[\\/]|~[\\/]|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private|root|usr|bin|sbin|lib|lib64|srv|dev|proc|sys|run|boot|media|workspace|workspaces)\/|[A-Za-z]:[\\/])[^\s\x60]+|(?:[\p{L}\p{M}\p{N}._-]+[\\/])+(?:[\p{L}\p{M}\p{N}._-]+\.[A-Za-z0-9_-]+|(?:${EXTENSIONLESS_FILE_NAME_PATTERN}))(?::\d+(?::\d+|-\d+)?)?|[\p{L}\p{M}\p{N}._-]+\.[A-Za-z0-9_-]+:\d+(?::\d+|-\d+)?)$`,
  "u",
);

export function enrichedSkillLinkRegex(skills?: ReadonlyArray<SelectableMarkdownSkill>) {
  const names = [...new Set(skills?.map((skill) => skill.name) ?? [])].filter(Boolean);
  if (names.length === 0) return null;
  names.sort((a, b) => b.length - a.length);
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `(?<![A-Za-z0-9_-])(?<!\\p{Sc})\\p{Sc}(?:${alternatives.join("|")})(?![A-Za-z0-9_-])`,
    "u",
  );
}

export function enrichedSkillReference(
  url: string,
  skills?: ReadonlyArray<SelectableMarkdownSkill>,
) {
  const match = /^\p{Sc}(.+)$/u.exec(url);
  return match ? skills?.find((skill) => skill.name === match[1]) : undefined;
}

export function enrichedSkillInstructionsPath(skill: SelectableMarkdownSkill) {
  return skill.path && !/^[a-z][a-z\d+.-]*:\/\//i.test(skill.path) ? skill.path : undefined;
}
