import { useMemo } from "react";
import { Image } from "react-native";
import type { LinkPillContent, MarkdownStyle } from "react-native-enriched-markdown";
import { changeRequestReferenceLabel } from "@supaterm/client-runtime/change-request-links";
import type { ComposerContextRecord } from "@supaterm/contracts";
import { contextChipAccent, contextChipPresentation } from "../lib/composerChipPresentation";
import { CONTEXT_CHIP_ICON_SOURCES } from "../lib/contextChipIcons.generated";
import { SYSTEM_FONT_FAMILY } from "../lib/fonts";
import { contextChipIconSource } from "../lib/contextChipIconSource";
import { markdownFileIconSource } from "../lib/markdownFileIcons";
import { markdownLinkIcon } from "../lib/markdownLinkIcons";
import { useUniwindTheme } from "../lib/useUniwindTheme";
import { resolveMarkdownFileIcon, resolveMarkdownLinkPresentation } from "../lib/markdownLinks";
import type {
  MarkdownLinkCustomization,
  SelectableMarkdownTextProps,
} from "./SelectableMarkdownText.types";
import {
  enrichedContextLinkPresentation,
  enrichedLinkVariantPattern,
  enrichedSkillDisplayName,
  enrichedSkillReference,
  enrichedThreadLinkPresentation,
} from "../lib/enrichedLinkPresentation";

function chipCustomization(
  chip: ReturnType<typeof enrichedContextLinkPresentation>,
): MarkdownLinkCustomization | undefined {
  if (!chip) return undefined;
  return {
    label: chip.label,
    icon: contextChipIconSource(chip.icon),
    chip: { accent: chip.accent, tintsIcon: chip.icon.kind === "chip" },
  };
}

export function enrichedContextLinkCustomization(
  href: string,
  records?: ReadonlyArray<ComposerContextRecord>,
) {
  return chipCustomization(enrichedContextLinkPresentation(href, records));
}

export function enrichedThreadLinkCustomization(href: string) {
  return chipCustomization(enrichedThreadLinkPresentation(href));
}

export function withChipIcon(
  customization: MarkdownLinkCustomization | undefined,
  iconUri: string | undefined,
): MarkdownLinkCustomization | undefined {
  return iconUri && customization?.chip
    ? {
        ...customization,
        icon: { uri: iconUri },
        chip: { ...customization.chip, tintsIcon: false },
      }
    : customization;
}

function presentation(
  url: string,
  bare: boolean,
  props: Pick<
    SelectableMarkdownTextProps,
    "linkCustomization" | "repositoryIdentity" | "skills" | "textStyle"
  >,
): MarkdownLinkCustomization | undefined {
  const custom = props.linkCustomization?.(url);
  if (custom) return custom;
  const context = enrichedContextLinkCustomization(url);
  if (context) return context;
  const skill = enrichedSkillReference(url, props.skills);
  if (skill)
    return {
      label: enrichedSkillDisplayName(skill),
      icon: CONTEXT_CHIP_ICON_SOURCES.skill,
      chip: { accent: contextChipPresentation("skill").accent, tintsIcon: true },
    };
  const link = resolveMarkdownLinkPresentation(url);
  if (link.kind === "file")
    return {
      label: link.label,
      icon: markdownFileIconSource(link.icon),
      chip: { accent: contextChipPresentation("mention").accent, tintsIcon: false },
    };
  if (link.kind !== "external") return undefined;
  const icon = markdownLinkIcon(link.host);
  const label = bare ? changeRequestReferenceLabel(url, props.repositoryIdentity) : null;
  if (!icon && !label) return undefined;
  return {
    color: props.textStyle.linkColor,
    ...(label ? { label } : {}),
    ...(icon ? { icon: icon.source } : {}),
    ...(icon?.tints ? { iconTintColor: props.textStyle.linkColor } : {}),
  };
}

export function useEnrichedLinkVariants(
  urls: ReadonlyArray<string>,
  bareUrls: ReadonlyArray<string>,
  props: SelectableMarkdownTextProps,
  fileHrefs: ReadonlySet<string>,
) {
  const { linkCustomization, repositoryIdentity, skills, textStyle, fileEmbedLabel } = props;
  const theme = useUniwindTheme();
  const links = useMemo(() => {
    const byUrl = new Map<string, MarkdownLinkCustomization>();
    for (const url of urls) {
      if (byUrl.has(url)) continue;
      const label = fileHrefs.has(url) ? fileEmbedLabel?.(url, false) : null;
      const value = label
        ? {
            label,
            color: textStyle.fileTextColor,
            icon: markdownFileIconSource(resolveMarkdownFileIcon(label)),
          }
        : presentation(url, bareUrls.includes(url), {
            linkCustomization,
            repositoryIdentity,
            skills,
            textStyle,
          });
      if (value) byUrl.set(url, value);
    }
    return byUrl;
  }, [
    urls,
    bareUrls,
    linkCustomization,
    repositoryIdentity,
    skills,
    textStyle,
    fileHrefs,
    fileEmbedLabel,
  ]);
  const chipForegrounds = useMemo(
    () =>
      new Map(
        [...links].map(([url, link]) => [
          url,
          link.chip
            ? (contextChipAccent(link.chip.accent, theme, textStyle.color) ?? textStyle.color)
            : undefined,
        ]),
      ),
    [links, textStyle, theme],
  );
  const linkVariants = useMemo<MarkdownStyle["linkVariants"]>(
    () =>
      Object.fromEntries(
        [...links].map(([url, link]) => {
          const chipForeground = chipForegrounds.get(url);
          return [
            enrichedLinkVariantPattern(url),
            {
              pill: {
                borderColor: "transparent",
                borderWidth: 0,
                borderRadius: 6,
                paddingHorizontal: 5,
                paddingVertical: 2,
              },
              fontFamily: chipForeground ? SYSTEM_FONT_FAMILY : textStyle.fontFamily,
              color: chipForeground ?? link.color ?? textStyle.fileTextColor,
              underline: resolveMarkdownLinkPresentation(url).kind === "external",
              backgroundColor: "transparent",
            },
          ];
        }),
      ),
    [chipForegrounds, links, textStyle],
  );
  const linkPillContent = useMemo<Record<string, LinkPillContent>>(
    () =>
      Object.fromEntries(
        [...links].map(([url, link]) => [
          url,
          {
            label: link.label,
            iconUri: link.icon ? Image.resolveAssetSource(link.icon)?.uri : undefined,
            iconTintColor: link.chip?.tintsIcon ? chipForegrounds.get(url) : link.iconTintColor,
          },
        ]),
      ),
    [chipForegrounds, links],
  );
  return { linkVariants, linkPillContent };
}
