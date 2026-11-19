import { SourceControlProviderKind } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { PublishRepositoryDialog } from "./GitActionsControl";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const publish = vi.hoisted(() => ({ run: fake() }));

vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      versionControlSystems: [],
      sourceControlProviders: [
        {
          kind: SourceControlProviderKind.make("github"),
          label: "GitHub",
          status: "available",
          version: Option.none(),
          installHint: "Install gh",
          detail: Option.none(),
          auth: {
            status: "authenticated",
            account: Option.none(),
            host: Option.none(),
            detail: Option.none(),
          },
        },
      ],
    },
  }),
}));

vi.mock("~/state/sourceControlActions", () => ({
  useGitStackedAction: vi.fn(),
  useSourceControlActionRunning: vi.fn(),
  useVcsInitAction: vi.fn(),
  useVcsPullAction: vi.fn(),
  useSourceControlPublishRepositoryAction: () => ({
    isAllowed: true,
    isPending: false,
    run: publish.run,
  }),
}));

function setup() {
  publish.run.reset();
  publish.run.implement(() => new Promise(() => {}));
}

it("keeps composition Enter in the repository path from publishing", async () => {
  setup();
  await using _screen = await render(
    <PublishRepositoryDialog
      open
      onOpenChange={() => {}}
      environmentId={null}
      threadRef={null}
      gitCwd="/repo"
    />,
  );
  await page.getByRole("button", { name: "Next" }).click();
  const path = page.getByRole("textbox", { name: "Repository" });
  await path.fill("octo/repo");

  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ...nativeEvent,
      bubbles: true,
      cancelable: true,
    });
    await act(() => path.element().dispatchEvent(event));
    expect(publish.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  }

  await userEvent.keyboard("{Enter}");
  expect(publish.run).toHaveBeenCalledOnce();
});
