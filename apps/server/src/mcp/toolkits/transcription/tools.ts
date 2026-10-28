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
    "Transcribe a recording with the named provider instance's own login, which spends that account. Only Claude subscription and ChatGPT logins can transcribe. Prepare a file upload named *.wav with mimeType audio/wav through supaterm_attachment_prepare_upload, POST a 16 kHz mono 16-bit WAV of at most 5 minutes, then pass its attachmentId. Only the caller that prepared an upload can transcribe or cancel it. Repeating a call for the same upload joins the running work or returns its outcome; after a failure only retry: true transcribes again. Context defaults to the calling thread and biases recognition toward its project and branch names. A successful run deletes the upload.",
  parameters: TranscriptionTranscribeInput,
  success: TranscriptionTranscribeResult,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const CancelTool = Tool.make("supaterm_transcription_cancel", {
  ...shared,
  description:
    "Stop transcribing an upload and delete it, including its recorded outcome. Later transcribe calls for it fail because the recording is gone.",
  parameters: TranscriptionCancelInput,
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
export const TranscriptionToolkit = Toolkit.make(TranscribeTool, CancelTool);
