import { EnvironmentId } from "@supaterm/contracts";
import { getProjectFaviconResourceKey } from "@supaterm/shared/projectFavicon";
import { expect, it, vi } from "vite-plus/test";

import { randomUUID } from "../lib/utils";

import { projectFaviconCache as cache } from "./projectFaviconCache";

it("persists and removes project icons after the database silently closes", async () => {
  const target = {
    environmentId: EnvironmentId.make(randomUUID()),
    cwd: "/workspace",
  };
  const image = "data:image/svg+xml;base64,PHN2Zy8+";
  await cache.hydrate();

  const original = IDBDatabase.prototype.transaction;
  const closing = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(function (
    this: IDBDatabase,
    stores,
    mode,
    options,
  ) {
    this.close();
    return original.call(this, stores, mode, options);
  });
  const request = indexedDB.open("supaterm:project-favicons", 2);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
  const read = () =>
    new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("images", "readonly");
      const value = transaction
        .objectStore("images")
        .get(getProjectFaviconResourceKey(target.environmentId, target.cwd));
      transaction.addEventListener("complete", () => resolve(value.result));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  try {
    expect(await cache.resolve(target, image, new AbortController().signal)).toBe(image);
    await cache.flush();
    closing.mockRestore();
    expect(await read()).toMatchObject({ ...target, dataUrl: image });
    await cache.clearEnvironment(target.environmentId);
    expect(await read()).toBeUndefined();
  } finally {
    closing.mockRestore();
    database.close();
    await cache.clearEnvironment(target.environmentId);
  }
});
