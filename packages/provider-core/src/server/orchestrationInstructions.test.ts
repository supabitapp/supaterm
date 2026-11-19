import { assert, describe, it } from "@effect/vitest";

import {
  SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
  SUPATERM_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  SUPATERM_ORCHESTRATION_INSTRUCTIONS,
  supatermAcpPromptWithInstructions,
  supatermOrchestrationPrompt,
  supatermOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("Supaterm device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(SUPATERM_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(SUPATERM_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__supaterm__device_list,mcp__supaterm__device_open,mcp__supaterm__device_screenshot,mcp__supaterm__device_close`.";
    assert.include(SUPATERM_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      SUPATERM_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    assert.include(
      SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when the session holds device access", () => {
    assert.include(
      supatermOrchestrationSystemPrompt(true, true),
      SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
    );
    assert.notInclude(supatermOrchestrationSystemPrompt(true, false), "## Supaterm devices");
    assert.isUndefined(supatermOrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean) =>
      supatermOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasSupatermMcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), SUPATERM_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(false), "## Supaterm devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      supatermOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasSupatermMcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), SUPATERM_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), SUPATERM_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the login screen.");
  });

  it("reach ACP agents again when device access changes mid-thread", () => {
    const state = {
      interactionMode: "default",
      hasSupatermMcp: true,
      hasDeviceTools: false,
    } as const;
    const withDevices = supatermAcpPromptWithInstructions({
      prompt: "Check the login screen.",
      state: { ...state, hasDeviceTools: true },
      previousState: state,
    });
    assert.include(withDevices, SUPATERM_DEVICE_TOOL_INSTRUCTIONS);
    assert.equal(
      supatermAcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.notInclude(
      supatermAcpPromptWithInstructions({ prompt: "Hi.", state }),
      "## Supaterm devices",
    );
  });
});
