import type {
  EnvironmentId,
  McpAppCallToolInput,
  McpAppCallToolResult,
  McpAppReadResourceInput,
  McpAppReadResourceResult,
  McpAppToolInfo,
  McpAppToolInfoInput,
  McpAppUpdateModelContextInput,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import { squashAtomCommandFailure, type AtomCommandResult } from "../state/runtime.ts";
import {
  McpAppHostRefusal,
  mcpResourceBytes,
  type McpAppDownload,
  type McpAppHostOptions,
} from "./host.ts";

type Command<Input, Output> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) => Promise<AtomCommandResult<Output, unknown>>;

interface McpAppCommands {
  readonly callTool: Command<McpAppCallToolInput, McpAppCallToolResult>;
  readonly toolInfo: Command<McpAppToolInfoInput, McpAppToolInfo>;
  readonly readResource: Command<McpAppReadResourceInput, McpAppReadResourceResult>;
  readonly updateModelContext: Command<McpAppUpdateModelContextInput, void>;
}

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function commandValue<Value>(result: AtomCommandResult<Value, unknown>): Value {
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw new McpAppHostRefusal(
    error instanceof Error && error.message.trim() !== "" ? error.message : "Request failed.",
  );
}

export function makeMcpAppRequests(options: {
  readonly target: () => {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly conversationThreadId: ThreadId;
    readonly itemId: TurnItemId;
  };
  readonly commands: () => McpAppCommands;
  readonly confirmTool: (input: {
    readonly name: string;
    readonly title: string | undefined;
    readonly arguments: Record<string, unknown>;
  }) => Promise<boolean>;
  readonly confirmDownload: (files: ReadonlyArray<McpAppDownload>) => Promise<boolean>;
  readonly saveFile: (file: {
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }) => void | Promise<void>;
}): Pick<McpAppHostOptions, "callTool" | "readResource" | "updateModelContext" | "downloadFile"> {
  const scope = () => {
    const { environmentId, threadId, itemId } = options.target();
    return { environmentId, input: { threadId, itemId } };
  };
  return {
    callTool: async ({ name, arguments: args }) => {
      const { environmentId, input } = scope();
      const info = commandValue(
        await options.commands().toolInfo({ environmentId, input: { ...input, name } }),
      );
      if (!info.callable) throw new McpAppHostRefusal("This app cannot call that tool.");
      if (
        !info.readOnly &&
        !(await options.confirmTool({ name, title: info.title, arguments: args }))
      ) {
        throw new McpAppHostRefusal("Declined by the user.");
      }
      return commandValue(
        await options.commands().callTool({
          environmentId,
          input: { ...input, name, arguments: args },
        }),
      );
    },
    readResource: async ({ uri }) => {
      const { environmentId, input } = scope();
      return commandValue(
        await options.commands().readResource({ environmentId, input: { ...input, uri } }),
      );
    },
    updateModelContext: async (context) => {
      const { environmentId, input } = scope();
      commandValue(
        await options.commands().updateModelContext({
          environmentId,
          input: {
            ...input,
            ...context,
            conversationThreadId: options.target().conversationThreadId,
          },
        }),
      );
    },
    downloadFile: async (files) => {
      const { environmentId, input } = scope();
      if (!(await options.confirmDownload(files))) {
        throw new McpAppHostRefusal("Declined by the user.");
      }
      for (const file of files) {
        let bytes: Uint8Array | undefined;
        let mimeType = file.mimeType ?? "application/octet-stream";
        if (file._tag === "embedded") {
          bytes = file.bytes;
        } else {
          const read = commandValue(
            await options
              .commands()
              .readResource({ environmentId, input: { ...input, uri: file.uri } }),
          );
          const content = read.contents[0];
          bytes = mcpResourceBytes(content);
          const declared = (content as { readonly mimeType?: unknown } | undefined)?.mimeType;
          if (typeof declared === "string") mimeType = declared;
        }
        if (bytes === undefined) throw new McpAppHostRefusal(`${file.name} has no contents.`);
        if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
          throw new McpAppHostRefusal(`${file.name} is too large to save.`);
        }
        await options.saveFile({ name: file.name, mimeType, bytes });
      }
    },
  };
}
