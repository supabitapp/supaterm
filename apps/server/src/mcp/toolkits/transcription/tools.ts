import {
  OrchestratorMcpFailure,
  TranscriptionCancelInput,
  TranscriptionTranscribeInput,
  TranscriptionTranscribeResult,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};
const TranscribeTool = Tool.make("supaterm_transcription_transcribe", {
  ...shared,
  description:
    "Transcribe a recording with a provider instance's own login (Claude subscription or ChatGPT; spends that account). Upload a 16 kHz mono 16-bit WAV, at most 5 minutes, via `supaterm_attachment_prepare_upload` (`*.wav`, `audio/wav`), then pass its `attachmentId`. Only the uploader can transcribe or cancel. A repeat joins the running work or returns its outcome; after a failure pass `retry: true`. Success deletes the upload.",
  parameters: TranscriptionTranscribeInput,
  success: TranscriptionTranscribeResult,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const CancelTool = Tool.make("supaterm_transcription_cancel", {
  ...shared,
  description: "Stop a transcription and delete its upload and outcome.",
  parameters: TranscriptionCancelInput,
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
export const TranscriptionToolkit = Toolkit.make(TranscribeTool, CancelTool);
