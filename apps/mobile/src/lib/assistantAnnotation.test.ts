import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@supaterm/contracts";
import {
  parseAssistantCitationHref,
  formatAssistantCitationHref,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@supaterm/shared/assistantCitations";
import { expect, it } from "vite-plus/test";

import { assistantCitationFromSelection, assistantCitationFromToken } from "./assistantAnnotation";

const source = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
};

it("turns a renderer selection into a quote the composer token round-trips", () => {
  const citation = assistantCitationFromSelection(source, {
    text: " exist upstream\uFFFC too.\nI did not report them. \n",
    start: 12,
  });
  expect(citation).toEqual({
    version: 1,
    ...source,
    text: "exist upstream too.\nI did not report them.",
    start: 12,
    end: 54,
    prefix: "",
    suffix: "",
  });
  if (typeof citation === "string") return;
  expect(parseAssistantCitationHref(formatAssistantCitationHref(citation))).toEqual(citation);
  const annotated = withAssistantCitationComment(citation, "Report them (please)");
  expect(assistantCitationFromToken(serializeAssistantCitation(annotated))).toEqual(annotated);
  expect(assistantCitationFromToken(`${serializeAssistantCitation(annotated)} more`)).toBeNull();

  expect(assistantCitationFromSelection(source, { text: " \uFFFC\n", start: 0 })).toBe("empty");
  expect(
    assistantCitationFromSelection(source, {
      text: "a".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1),
      start: 0,
    }),
  ).toBe("too-long");
});
