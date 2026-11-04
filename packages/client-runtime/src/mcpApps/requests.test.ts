import {
  EnvironmentId,
  ThreadId,
  TurnItemId,
  type McpAppReadResourceInput,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { makeMcpAppRequests } from "./requests.ts";

it.each(["confirmation", "first save"])(
  "keeps the download target while awaiting %s",
  async (pause) => {
    const targetA = {
      environmentId: EnvironmentId.make("environment-a"),
      threadId: ThreadId.make("thread-a"),
      conversationThreadId: ThreadId.make("conversation-a"),
      itemId: TurnItemId.make("item-a"),
    };
    const targetB = {
      environmentId: EnvironmentId.make("environment-b"),
      threadId: ThreadId.make("thread-b"),
      conversationThreadId: ThreadId.make("conversation-b"),
      itemId: TurnItemId.make("item-b"),
    };
    let target = targetA;
    const confirmation = Promise.withResolvers<boolean>();
    const saveStarted = Promise.withResolvers<void>();
    const finishSave = Promise.withResolvers<void>();
    const reads: Array<{ environmentId: EnvironmentId; input: McpAppReadResourceInput }> = [];
    const files: Array<{ name: string; mimeType: string; bytes: Uint8Array }> = [];
    const requests = makeMcpAppRequests({
      target: () => target,
      commands: () => ({
        callTool: async () => AsyncResult.success({ content: [] }),
        toolInfo: async () => AsyncResult.success({ callable: true, readOnly: true }),
        updateModelContext: async () => AsyncResult.success(undefined),
        readResource: async (request) => {
          reads.push(request);
          return AsyncResult.success({
            contents: [
              {
                text: `${request.environmentId}/${request.input.uri}`,
                mimeType: "text/plain",
              },
            ],
          });
        },
      }),
      confirmTool: async () => true,
      confirmDownload: () => confirmation.promise,
      saveFile: async (file) => {
        files.push(file);
        if (pause === "first save" && files.length === 1) {
          saveStarted.resolve();
          await finishSave.promise;
        }
      },
    });
    const downloads = ["first", "second"].map((name) => ({
      _tag: "link" as const,
      name: `${name}.txt`,
      uri: `resource://${name}`,
    }));

    const download = requests.downloadFile(downloads);
    expect(reads).toEqual([]);
    expect(files).toEqual([]);
    if (pause === "confirmation") {
      target = targetB;
      confirmation.resolve(true);
    } else {
      confirmation.resolve(true);
      await saveStarted.promise;
      target = targetB;
      finishSave.resolve();
    }
    await download;

    expect(reads).toEqual(
      downloads.map(({ uri }) => ({
        environmentId: targetA.environmentId,
        input: { threadId: targetA.threadId, itemId: targetA.itemId, uri },
      })),
    );
    expect(files).toEqual(
      downloads.map(({ name, uri }) => ({
        name,
        mimeType: "text/plain",
        bytes: new TextEncoder().encode(`${targetA.environmentId}/${uri}`),
      })),
    );

    await requests.downloadFile(downloads.slice(0, 1));
    expect(reads.at(-1)).toEqual({
      environmentId: targetB.environmentId,
      input: { threadId: targetB.threadId, itemId: targetB.itemId, uri: downloads[0]!.uri },
    });
  },
);
