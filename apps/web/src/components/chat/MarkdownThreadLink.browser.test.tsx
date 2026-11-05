import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { MarkdownThreadLink } from "./MarkdownThreadLink";

import "~/index.css";

const state = vi.hoisted(() => ({
  childTitles: new Map<string, string>(),
  shellOmitsThreads: false,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: () => null,
  useThreadRefs: () => [],
  useProject: () => null,
  useSubagentChildTitles: ((ref: unknown) =>
    ref === null ? new Map() : state.childTitles) as never,
  useShellOmitsThreads: (() => state.shellOmitsThreads) as never,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PARENT_ID = ThreadId.make("parent");
const CHILD_ID = ThreadId.make("thread:delegated-task:command%3Amcp%3Areview");

function setup(input: { childTitles: Record<string, string>; shellOmitsThreads: boolean }) {
  state.childTitles = new Map(Object.entries(input.childTitles));
  state.shellOmitsThreads = input.shellOmitsThreads;
}

describe("MarkdownThreadLink", () => {
  it.each([
    {
      name: "an idle subagent the shell omits takes its title from the open thread",
      childTitles: { [CHILD_ID]: "Correctness review" },
      shellOmitsThreads: true,
      chip: "Thread, Correctness review",
    },
    {
      name: "an unknown thread stays openable when the shell can omit it",
      childTitles: {},
      shellOmitsThreads: true,
      chip: "Thread, Thread",
    },
    {
      name: "an unknown thread is unavailable when the shell holds every thread",
      childTitles: {},
      shellOmitsThreads: false,
      chip: "Unavailable context, Thread no longer available",
    },
  ])("$name", async ({ childTitles, shellOmitsThreads, chip }) => {
    setup({ childTitles, shellOmitsThreads });
    await using _screen = await render(
      <MarkdownThreadLink
        environmentId={ENVIRONMENT_ID}
        threadRef={{ environmentId: ENVIRONMENT_ID, threadId: PARENT_ID }}
        link={{ environmentId: ENVIRONMENT_ID, threadId: CHILD_ID }}
        label={null}
      />,
    );
    await expect.element(page.getByLabelText(chip)).toBeVisible();
  });
});
