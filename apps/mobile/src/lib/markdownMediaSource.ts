import { classifyMarkdownImageSource } from "@supaterm/client-runtime/markdown-images";
import {
  resolveMediaSource,
  type ResolveMediaSourceInput,
} from "@supaterm/client-runtime/media-source";

export function resolveMobileMarkdownMediaSource(href: string, input: ResolveMediaSourceInput) {
  const media = resolveMediaSource(href, input);
  if (media?.access !== "unavailable" || !input.workspaceRoot) return media;
  const projectRoot = input.projectRoot === undefined ? input.workspaceRoot : input.projectRoot;
  const source = classifyMarkdownImageSource(href, input.workspaceRoot, projectRoot);
  if (source._tag !== "WorkspaceFile") return media;
  return {
    ...media,
    access: "environment" as const,
    resource: {
      _tag: "draft-workspace-file" as const,
      cwd: projectRoot ?? input.workspaceRoot,
      path: source.path,
    },
  };
}
