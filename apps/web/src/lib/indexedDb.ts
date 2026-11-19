export interface IndexedDbAccess {
  readonly open?: (name: string, version: number) => IDBOpenDBRequest;
  readonly begin?: (
    database: IDBDatabase,
    stores: string | string[],
    mode: IDBTransactionMode,
  ) => IDBTransaction;
}

const openIndexedDb = (name: string, version: number) => indexedDB.open(name, version);
const beginIndexedDbTransaction = (
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
) => database.transaction(stores, mode);

export function createIndexedDbTransaction(
  options: {
    readonly name: string;
    readonly version: number;
    readonly upgrade: (database: IDBDatabase) => void;
    readonly blockedMessage: string;
  } & IndexedDbAccess,
) {
  const open = options.open ?? openIndexedDb;
  const begin = options.begin ?? beginIndexedDbTransaction;
  let database: Promise<IDBDatabase> | undefined;
  const forget = (opening: Promise<IDBDatabase>) => {
    if (database === opening) database = undefined;
  };

  function openDatabase() {
    if (database) return database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = open(options.name, options.version);
      let settled = false;
      request.addEventListener("upgradeneeded", () => options.upgrade(request.result));
      request.addEventListener("success", () => {
        const opened = request.result;
        if (settled) {
          opened.close();
          return;
        }
        settled = true;
        opened.addEventListener("close", () => forget(opening));
        opened.addEventListener("versionchange", () => {
          forget(opening);
          opened.close();
        });
        resolve(opened);
      });
      request.addEventListener("error", () => {
        settled = true;
        reject(request.error);
      });
      request.addEventListener("blocked", () => {
        settled = true;
        reject(new Error(options.blockedMessage));
      });
    });
    database = opening;
    void opening.catch(() => forget(opening));
    return opening;
  }

  return async function transaction(stores: string | string[], mode: IDBTransactionMode) {
    for (let attempt = 0; ; attempt++) {
      const opening = openDatabase();
      const opened = await opening;
      try {
        return begin(opened, stores, mode);
      } catch (cause) {
        if (!(cause instanceof DOMException) || cause.name !== "InvalidStateError") throw cause;
        forget(opening);
        opened.close();
        if (attempt > 0) throw cause;
      }
    }
  };
}
