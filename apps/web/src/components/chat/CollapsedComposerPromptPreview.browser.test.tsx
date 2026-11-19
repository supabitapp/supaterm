import "~/index.css";

import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import { threadContextRecord } from "@supaterm/shared/composerContextReferences";
import { expect, it } from "vite-plus/test";

import { formatInlineContextReference } from "~/lib/composerContextReferences";
import { referenceContextReference } from "~/lib/composerContextRecords";
import {
  composerContextRecordsFromDraft,
  EMPTY_COMPOSER_CONTEXT_RECORDS,
} from "../composerContextPresentation";
import { render } from "../../../test/render";
import { CollapsedComposerPromptPreview } from "./CollapsedComposerPromptPreview";

function quote(text: string, comment?: string) {
  return serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment:test"),
    threadId: ThreadId.make("thread:test"),
    messageId: MessageId.make("message:assistant"),
    text,
    start: 0,
    end: text.length,
    prefix: "",
    suffix: "",
    ...(comment === undefined ? {} : { comment }),
  });
}

it("shows quotes, file mentions, context references and skills as chips", async () => {
  const buildThread = threadContextRecord(
    scopeThreadRef(EnvironmentId.make("environment:test"), ThreadId.make("thread:build")),
    "Build thread",
  );
  const terminal = formatInlineContextReference({
    kind: "terminal",
    contextId: "terminal_1",
    label: "Terminal 1",
  });
  const thread = formatInlineContextReference(referenceContextReference(buildThread));
  const prompt = `${quote("Cache the parsed config.")} vs ${quote("Retry on 503.", "Also on 429?")} in [package.json](package.json) and [file.txt](C:\\dir\\file.txt) per ${terminal} on ${thread} with $review-pr please`;

  await using screen = await render(
    <CollapsedComposerPromptPreview
      prompt={prompt}
      skills={[
        { name: "review-pr", displayName: "Review PR", path: "/skills/review-pr", enabled: true },
      ]}
      contextRecords={composerContextRecordsFromDraft({
        terminalContexts: [],
        referenceContexts: [buildThread],
      })}
      theme="light"
    />,
    { router: false },
  );
  const { container } = screen;

  const chips = [...container.querySelectorAll('[data-slot="context-chip"]')];
  expect(chips.map((chip) => chip.textContent)).toEqual([
    "Cache the parsed config.",
    "Also on 429?",
    "package.json",
    "file.txt",
    "Terminal 1",
    "Build thread",
    "Review PR",
  ]);
  expect(
    chips.flatMap((chip) =>
      chip.getAttribute("data-state") === "unresolved" ? [chip.textContent] : [],
    ),
  ).toEqual(["Terminal 1"]);
  expect(chips.every((chip) => chip.querySelector("svg") !== null)).toBe(true);
  expect(container.textContent).toBe(
    "Cache the parsed config. vs Also on 429? in package.json and file.txt per Terminal 1 on Build thread with Review PR please",
  );
  expect(container.querySelector("button, a, [tabindex]")).toBeNull();
});

it("leaves unknown skills as the text the user typed", async () => {
  await using screen = await render(
    <CollapsedComposerPromptPreview
      prompt="run $missing now"
      skills={[]}
      contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
      theme="dark"
    />,
    { router: false },
  );
  const { container } = screen;

  expect(container.querySelector('[data-slot="context-chip"]')).toBeNull();
  expect(container.textContent).toBe("run $missing now");
});
