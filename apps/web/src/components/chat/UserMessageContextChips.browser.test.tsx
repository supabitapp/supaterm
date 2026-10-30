import {
  ComposerContextId,
  EnvironmentId,
  type KnownComposerContextRecord,
} from "@supaterm/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineRowContext";

vi.mock(import("../ChatMarkdown"), () => ({ default: () => null }) as never);
vi.mock(
  import("../files/AttachmentFilePreview"),
  () => ({ ReadOnlySourcePreview: () => null }) as never,
);
vi.mock(
  import("../DiffWorkerPoolProvider"),
  () => ({ DiffWorkerPoolProvider: () => null }) as never,
);
vi.mock(import("@pierre/diffs/react"), () => ({ FileDiff: () => null }) as never);

it("loads the complete sent-message registry and renders machine context", async () => {
  const { UserMessageContextReferenceChip } = await import("./UserMessageContextChips");
  const record = {
    version: 1,
    kind: "environment",
    contextId: ComposerContextId.make("machine-remote"),
    environmentId: EnvironmentId.make("remote"),
    label: "Build machine",
  } satisfies KnownComposerContextRecord;
  const context = { resolvedTheme: "light" } as TimelineRowSharedState;
  await using screen = await render(
    <TimelineRowCtx value={context as TimelineRowSharedState}>
      <UserMessageContextReferenceChip
        reference={{ kind: record.kind, contextId: record.contextId, label: record.label }}
        record={record}
        attachment={null}
        annotationImage={null}
        onExpandImage={() => undefined}
        onExpandVideo={() => undefined}
        onOpenFile={() => undefined}
      />
    </TimelineRowCtx>,
  );
  await expect.element(screen.getByLabelText("Machine, Build machine")).toBeVisible();
  expect(
    screen.container.querySelector("[data-markdown-copy]")?.getAttribute("data-markdown-copy"),
  ).toContain(record.contextId);
});

it("opens sent skill details from the matching workspace skill", async () => {
  const { UserMessageContextReferenceChip } = await import("./UserMessageContextChips");
  const record = {
    version: 1,
    kind: "skill",
    contextId: ComposerContextId.make("build-skill"),
    name: "build",
    label: "Build",
  } satisfies KnownComposerContextRecord;
  const context: Partial<TimelineRowSharedState> = {
    resolvedTheme: "light",
    skills: [
      {
        name: "build",
        path: "/project/build/SKILL.md",
        description: "Build the project",
        enabled: true,
      },
    ],
    threadRef: null,
  };
  await using screen = await render(
    <TimelineRowCtx value={context as TimelineRowSharedState}>
      <UserMessageContextReferenceChip
        reference={{ kind: record.kind, contextId: record.contextId, label: record.label }}
        record={record}
        attachment={null}
        annotationImage={null}
        onExpandImage={() => undefined}
        onExpandVideo={() => undefined}
        onOpenFile={() => undefined}
      />
    </TimelineRowCtx>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Skill Build. Show details" }));
  await expect.element(page.getByText("Build the project")).toBeVisible();
});
