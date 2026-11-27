// @effect-diagnostics-next-line nodeBuiltinImport:off -- The fixture holds Git's HTTP request open.
import * as NodeHttp from "node:http";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { CommandId, ProjectId } from "@supaterm/contracts";
import { expect } from "e2e";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Stream from "effect/Stream";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { rpcClient, runPromise, test, WEB } from "./supaterm.ts";

test(
  "Dismissing clone progress leaves the later failure notification visible",
  WEB,
  async ({ supaterm, app, screen, browser }) => {
    const project = await supaterm.project("demo");
    const thread = await supaterm.thread({ project, title: "Other work", messages: ["Start"] });
    const gitRequest = Promise.withResolvers<NodeHttp.ServerResponse>();
    const remote = NodeHttp.createServer((_request, response) => {
      gitRequest.resolve(response);
    });
    const uuid = SecureRandom.SecureRandom.pipe(
      Effect.flatMap((random) => random.uuidV4()),
      Effect.provide(NodeCrypto.layer),
    );
    const projectId = ProjectId.make(await runPromise(uuid));
    const origin = app.baseUrl ?? "";

    try {
      await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
      const address = remote.address();
      if (!address || typeof address === "string") throw new Error("No Git fixture port");
      const name = "pending-clone";
      await supaterm.open(thread);
      await screen.getByText("Start", { exact: true }).waitFor();

      await runPromise(
        Effect.gen(function* () {
          const client = yield* rpcClient(SCENARIO_HOME, origin);
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          yield* client["projectClone.start"]({
            projectId,
            title: name,
            createdAt,
            remoteUrl: `http://127.0.0.1:${address.port}/${name}.git`,
            destinationPath: `${project}/../${name}`,
          });
        }).pipe(Effect.scoped),
      );
      const response = await gitRequest.promise;

      const toastTitle = (title: string) =>
        browser.locator(`[data-slot="toast-title"]:text-is("${title}")`);
      const dismiss = async (title: string) => {
        await browser
          .locator(
            `[data-position]:has(> div > [data-slot="toast-close"]):has([data-slot="toast-title"]:text-is("${title}"))`,
          )
          .getByRole("button", "Dismiss notification", { exact: true })
          .tap();
        await toastTitle(title).waitFor({ state: "detached" });
      };
      const progress = toastTitle(`Cloning ${name}`);
      const failure = toastTitle(`Failed to clone ${name}`);

      await progress.waitFor();
      await dismiss(`Cloning ${name}`);

      response.writeHead(404).end();
      await runPromise(
        Effect.gen(function* () {
          const client = yield* rpcClient(SCENARIO_HOME, origin);
          yield* client.subscribeProjectClones({}).pipe(
            Stream.filter((clones) =>
              clones.some((clone) => clone.projectId === projectId && clone.phase === "failed"),
            ),
            Stream.runHead,
          );
        }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
      );

      try {
        await expect(failure).toBeVisible();
      } finally {
        await app.screenshot("after-background-clone-fails");
      }

      await dismiss(`Failed to clone ${name}`);

      const retryRequest = Promise.withResolvers<NodeHttp.ServerResponse>();
      remote.once("request", (_request, response) => retryRequest.resolve(response));
      const retry = await runPromise(
        Effect.gen(function* () {
          const client = yield* rpcClient(SCENARIO_HOME, origin);
          return yield* client["projectClone.retry"]({ projectId });
        }).pipe(Effect.scoped),
      );
      await expect(retry.applied).toBe(true);
      const retryResponse = await retryRequest.promise;
      await expect(progress).toBeVisible();
      retryResponse.writeHead(404).end();
      await expect(failure).toBeVisible();
    } finally {
      remote.close();
      remote.closeAllConnections();
      // A failed clone outlives the test until its project goes, and every later page shows it.
      await runPromise(
        Effect.gen(function* () {
          const client = yield* rpcClient(SCENARIO_HOME, origin);
          yield* client["projects.mutate"]({
            type: "project.delete",
            commandId: CommandId.make(yield* uuid),
            projectId,
            force: true,
          });
        }).pipe(Effect.scoped),
      );
    }
  },
);
