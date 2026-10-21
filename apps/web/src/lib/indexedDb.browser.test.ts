import { describe, expect, it, vi } from "vite-plus/test";

import { createIndexedDbTransaction } from "./indexedDb";
import { randomUUID } from "./utils";

function fixture() {
  const name = randomUUID();
  const databases = new Set<IDBDatabase>();
  const originalOpen = indexedDB.open;
  const open = vi.spyOn(indexedDB, "open").mockImplementation(function (name, version) {
    const request = originalOpen.call(indexedDB, name, version);
    request.addEventListener("success", () => databases.add(request.result));
    return request;
  });
  const create = (version: number) =>
    createIndexedDbTransaction({
      name,
      version,
      upgrade: (database) => {
        if (!database.objectStoreNames.contains("values")) database.createObjectStore("values");
      },
      blockedMessage: "Storage is blocked.",
    });
  const begin = create(1);
  const read = () => begin("values", "readonly");
  return {
    name,
    begin,
    read,
    create,
    async [Symbol.asyncDispose]() {
      open.mockRestore();
      for (const database of databases) database.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.addEventListener("success", () => resolve());
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("blocked", () =>
          reject(new Error("A test connection was left open.")),
        );
      });
    },
  };
}

function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

describe("IndexedDB transaction recovery", () => {
  it("shares a fresh connection between concurrent accesses after a silent close", async () => {
    await using storage = fixture();
    const { begin, read } = storage;
    const saved = await begin("values", "readwrite");
    saved.objectStore("values").put("queued message", "message");
    await completed(saved);
    saved.db.close();

    const transactions = await Promise.all([read(), read()]);
    expect(transactions[0]!.db).toBe(transactions[1]!.db);
    expect(transactions[0]!.db).not.toBe(saved.db);
    const values = transactions.map((transaction) => {
      const request = transaction.objectStore("values").get("message");
      return completed(transaction).then(() => request.result);
    });
    expect(await Promise.all(values)).toEqual(["queued message", "queued message"]);
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
  });

  it("forgets closed connections without letting a stale close discard their replacement", async () => {
    await using storage = fixture();
    const { read } = storage;
    const first = await read();
    await completed(first);
    first.db.close();
    first.db.dispatchEvent(new Event("close"));

    const second = await read();
    await completed(second);
    first.db.dispatchEvent(new Event("close"));
    const third = await read();
    await completed(third);
    expect(third.db).toBe(second.db);
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
  });

  it("retries transaction creation only once and allows a later operation to recover", async () => {
    await using storage = fixture();
    const { read } = storage;
    const initial = await read();
    await completed(initial);
    const original = IDBDatabase.prototype.transaction;
    using closing = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      stores,
      mode,
      options,
    ) {
      this.close();
      return original.call(this, stores, mode, options);
    });
    await expect(read()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(closing).toHaveBeenCalledTimes(2);
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
    closing.mockRestore();
    await completed(await read());
    expect(indexedDB.open).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failed open and can reopen on a later operation", async () => {
    await using storage = fixture();
    const { read } = storage;
    vi.mocked(indexedDB.open).mockImplementationOnce(() => {
      throw new DOMException("Storage is unavailable.", "InvalidStateError");
    });
    await expect(read()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(indexedDB.open).toHaveBeenCalledOnce();
    await completed(await read());
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
  });

  it("does not reopen for transaction creation errors unrelated to closure", async () => {
    await using storage = fixture();
    const { read } = storage;
    await completed(await read());
    using _quota = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(() => {
      throw new DOMException("Disk is full.", "QuotaExceededError");
    });
    await expect(read()).rejects.toMatchObject({ name: "QuotaExceededError" });
    await completed(await read());
    expect(indexedDB.open).toHaveBeenCalledOnce();
  });

  it("closes its connection so another tab can upgrade the schema", async () => {
    await using storage = fixture();
    const { name, read } = storage;
    const initial = await read();
    await completed(initial);
    const request = indexedDB.open(name, 2);
    await new Promise<void>((resolve, reject) => {
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () => reject(new Error("Schema upgrade was blocked.")));
    });
    expect(request.result.version).toBe(2);
    expect(() => initial.db.transaction("values")).toThrow();
  });

  it("reopens after a blocked open and closes its abandoned result", async () => {
    await using storage = fixture();
    const { read } = storage;
    const initial = await read();
    await completed(initial);
    const beginUpgrade = storage.create(2);
    const upgraded = () => beginUpgrade("values", "readonly");
    using blocker = vi.spyOn(initial.db, "close").mockImplementation(() => {});
    await expect(upgraded()).rejects.toThrow("Storage is blocked.");
    const blockedRequest = vi.mocked(indexedDB.open).mock.results[1]!.value;
    const retry = upgraded();
    blocker.mockRestore();
    initial.db.close();
    await completed(await retry);
    expect(() => blockedRequest.result.transaction("values")).toThrow();
    expect(indexedDB.open).toHaveBeenCalledTimes(3);
  });
});
