import { describe } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CodexOrchestratorReplayHarness } from "../Adapters/CodexAdapterV2.testkit.ts";
import { materializeReplayTranscriptWorkspace } from "@supaterm/provider-testing/replayTranscript";
import { itRunsReplayFixtures, runReplayFixture } from "./ProviderReplayFixtures.ts";

describe("Codex replay fixtures", () => {
  itRunsReplayFixtures("codex", (input) =>
    runReplayFixture({
      ...input,
      harness: CodexOrchestratorReplayHarness,
      materializeWorkspace: (transcript, workspace) =>
        Effect.succeed(materializeReplayTranscriptWorkspace(transcript, workspace)),
    }),
  );
});
