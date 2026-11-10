export type KitchenEvent = {
  id: string;
  kind: string;
  entityId: string;
  at: number;
  data: any;
};
export type KitchenState = {
  events: KitchenEvent[];
  source: any[];
  acked: string[];
  cursor: number;
  owner: string | null;
  autoSync: boolean;
  postings: Record<string, any>;
  draft: any;
  [key: string]: any;
};
export const emptyState = (): KitchenState => ({
  events: [],
  source: [],
  acked: [],
  cursor: 0,
  owner: null,
  autoSync: true,
  postings: {},
  draft: null,
});
let connection: Promise<IDBDatabase> | undefined;
export function openDB() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const r = indexedDB.open("scottys-vision-kitchen", 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("state"))
          r.result.createObjectStore("state");
        if (!r.result.objectStoreNames.contains("files"))
          r.result.createObjectStore("files", { keyPath: "id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return connection;
}
export async function readLocal(store: string, key?: string) {
  const db = await openDB();
  return new Promise<any>((resolve, reject) => {
    const t = db.transaction(store),
      r =
        key === undefined
          ? t.objectStore(store).getAll()
          : t.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function writeLocal(store: string, value: any, key?: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    if (key === undefined) t.objectStore(store).put(value);
    else t.objectStore(store).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () =>
      reject(Error("Device storage is full or unavailable. Export a backup."));
    t.onabort = () =>
      reject(Error("Device save did not complete. Keep this screen open."));
  });
}
export function uid() {
  return crypto.randomUUID();
}
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export function download(name: string, value: any, mime = "application/json") {
  const data =
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    url = URL.createObjectURL(new Blob([data], { type: mime })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const money = (n: any) =>
  n == null
    ? "Needs price"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        maximumFractionDigits: 2,
      }).format(n);
export const unitMoney = (n: any) =>
  n == null
    ? "Needs price"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(n);
export const date = (n: number) =>
  new Date(n).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  });
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
