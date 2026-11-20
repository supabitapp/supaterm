// @effect-diagnostics nodeBuiltinImport:off -- The SDK's protobuf runtime loads from disk beside it.
import type { Run, SDKAgent, SendOptions } from "@cursor/sdk";
import * as NodeAsyncHooks from "node:async_hooks";
import * as NodeModule from "node:module";

interface ProtobufRuntime {
  readonly proto3: {
    readonly util: {
      initPartial: (
        source:
          | {
              readonly action?: {
                readonly case?: unknown;
                readonly value?: { readonly userMessage?: { readonly text?: unknown } };
              };
            }
          | undefined,
        target: { getType(): { readonly typeName: string } },
      ) => void;
    };
  };
}

const resumeRequests = new NodeAsyncHooks.AsyncLocalStorage<{ pending: boolean }>();
let resumeActionInstalled = false;

// @cursor/sdk has no public resume: it sends Cursor's ResumeAction only to retry a failed attempt,
// and a patch would rewrite multi-megabyte minified lines. Its local runs build each
// ConversationAction through the @bufbuild/protobuf it requires, so resumeCursorRun's empty
// message becomes a ResumeAction there.
function installResumeAction() {
  if (resumeActionInstalled) return;
  const requireFromSdk = NodeModule.createRequire(
    NodeModule.createRequire(import.meta.url).resolve("@cursor/sdk"),
  );
  const { util } = (requireFromSdk("@bufbuild/protobuf") as ProtobufRuntime).proto3;
  const initPartial = util.initPartial;
  util.initPartial = (source, target) => {
    const request = resumeRequests.getStore();
    if (
      request?.pending === true &&
      source?.action?.case === "userMessageAction" &&
      source.action.value?.userMessage?.text === "" &&
      target.getType().typeName === "agent.v1.ConversationAction"
    ) {
      request.pending = false;
      return initPartial.call(util, { action: { case: "resumeAction", value: {} } }, target);
    }
    return initPartial.call(util, source, target);
  };
  resumeActionInstalled = true;
}

/** Continues the agent's latest checkpoint with Cursor's ResumeAction, sending no user message. */
export async function resumeCursorRun(agent: SDKAgent, options: SendOptions): Promise<Run> {
  installResumeAction();
  const request = { pending: true };
  const run = await resumeRequests.run(request, () => agent.send("", options));
  if (request.pending) {
    await run.cancel();
    throw new Error("This Cursor SDK sent the resume as an empty message.");
  }
  return run;
}
