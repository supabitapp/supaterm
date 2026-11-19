import { ChatFileAttachment, ChatImageAttachment } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

export const McpAttachmentInput = Schema.Union([
  ChatImageAttachment.mapFields(Struct.omit(["source"])),
  ChatFileAttachment,
]);
