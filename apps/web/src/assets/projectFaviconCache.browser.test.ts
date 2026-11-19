import { EnvironmentId } from "@supaterm/contracts";
import { getProjectFaviconResourceKey } from "@supaterm/shared/projectFavicon";
import { expect, it } from "vite-plus/test";

import { randomUUID } from "../lib/utils";

import { createBrowserProjectFaviconCache } from "./projectFaviconCache";

it("persists and removes project icons after the database silently closes", async () => {
  const closing = { next: false };
  const cache = createBrowserProjectFaviconCache({
    begin: (database, stores, mode) => {
      if (closing.next) {
        closing.next = false;
        database.close();
      }
      return database.transaction(stores, mode);
    },
  });
  const target = {
    environmentId: EnvironmentId.make(randomUUID()),
    cwd: "/workspace",
  };
  const image = "data:image/svg+xml;base64,PHN2Zy8+";
  await cache.hydrate();

  closing.next = true;
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
    expect(await read()).toMatchObject({ ...target, dataUrl: image });
    await cache.clearEnvironment(target.environmentId);
    expect(await read()).toBeUndefined();
  } finally {
    closing.next = false;
    database.close();
    await cache.clearEnvironment(target.environmentId);
  }
});
