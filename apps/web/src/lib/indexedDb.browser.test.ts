import { describe, expect, it } from "vite-plus/test";

import { createIndexedDbTransaction } from "./indexedDb";
import { randomUUID } from "./utils";

function fixture() {
  const name = randomUUID();
  const databases = new Set<IDBDatabase>();
  const opens: Array<IDBOpenDBRequest> = [];
  const openFailures: Array<DOMException> = [];
  const begins: Array<IDBDatabase> = [];
  const interruptions: {
    next: Array<(database: IDBDatabase) => void>;
    always: ((database: IDBDatabase) => void) | null;
  } = { next: [], always: null };
  const create = (version: number) =>
    createIndexedDbTransaction({
      name,
      version,
      upgrade: (database) => {
        if (!database.objectStoreNames.contains("values")) database.createObjectStore("values");
      },
      blockedMessage: "Storage is blocked.",
      open: (databaseName, databaseVersion) => {
        const failure = openFailures.shift();
        if (failure) throw failure;
        const request = indexedDB.open(databaseName, databaseVersion);
        opens.push(request);
        request.addEventListener("success", () => databases.add(request.result));
        return request;
      },
      begin: (database, stores, mode) => {
        begins.push(database);
        (interruptions.next.shift() ?? interruptions.always)?.(database);
        return database.transaction(stores, mode);
      },
    });
  const begin = create(1);
  const read = () => begin("values", "readonly");
  return {
    name,
    begin,
    read,
    create,
    opens,
    openFailures,
    begins,
    interruptions,
    async [Symbol.asyncDispose]() {
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
    expect(storage.opens).toHaveLength(2);
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
    expect(storage.opens).toHaveLength(2);
  });

  it("retries transaction creation only once and allows a later operation to recover", async () => {
    await using storage = fixture();
    const { read } = storage;
    const initial = await read();
    await completed(initial);
    storage.begins.length = 0;
    storage.interruptions.always = (database) => database.close();
    await expect(read()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(storage.begins).toHaveLength(2);
    expect(storage.opens).toHaveLength(2);
    storage.interruptions.always = null;
    await completed(await read());
    expect(storage.opens).toHaveLength(3);
  });

  it("does not retry a failed open and can reopen on a later operation", async () => {
    await using storage = fixture();
    const { read } = storage;
    storage.openFailures.push(new DOMException("Storage is unavailable.", "InvalidStateError"));
    await expect(read()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(storage.opens).toHaveLength(0);
    await completed(await read());
    expect(storage.opens).toHaveLength(1);
  });

  it("does not reopen for transaction creation errors unrelated to closure", async () => {
    await using storage = fixture();
    const { read } = storage;
    await completed(await read());
    storage.interruptions.next.push(() => {
      throw new DOMException("Disk is full.", "QuotaExceededError");
    });
    await expect(read()).rejects.toMatchObject({ name: "QuotaExceededError" });
    await completed(await read());
    expect(storage.opens).toHaveLength(1);
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
    using _upgraded = { [Symbol.dispose]: () => request.result.close() };
    expect(request.result.version).toBe(2);
    expect(() => initial.db.transaction("values")).toThrow();
  });

  it("reopens after a blocked open and closes its abandoned result", async () => {
    await using storage = fixture();
    const { name, read } = storage;
    const initial = await read();
    await completed(initial);
    const blocking = indexedDB.open(name, 1);
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      blocking.addEventListener("success", () => resolve(blocking.result));
      blocking.addEventListener("error", () => reject(blocking.error));
    });
    const beginUpgrade = storage.create(2);
    const upgraded = () => beginUpgrade("values", "readonly");
    await expect(upgraded()).rejects.toThrow("Storage is blocked.");
    const blockedRequest = storage.opens[1]!;
    const retry = upgraded();
    blocker.close();
    await completed(await retry);
    expect(() => blockedRequest.result.transaction("values")).toThrow();
    expect(storage.opens).toHaveLength(3);
  });
});
