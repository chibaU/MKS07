// التخزين المحلي على الهاتف (IndexedDB). كل كتابة تُعتبَر ناجحة فقط بعد
// tx.oncomplete (أي بعد ثبوتها فعلياً)، فإغلاق المتصفح لا يُفقِد فاتورة (المتطلب 9).
// لا يوجد هنا أي حذف تلقائي: الفاتورة لا تُحذَف إلا بفعل صريح من المستخدم،
// وبعد التأكيد النهائي فقط للمُرسَلة (المتطلب 18).

const DB_NAME = "mks-phone";
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) return reject(new Error("المتصفح لا يدعم التخزين المحلي"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
        if (!db.objectStoreNames.contains("invoices")) db.createObjectStore("invoices", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("تعذر فتح التخزين المحلي"));
      req.onblocked = () => reject(new Error("التخزين المحلي محجوز بنافذة أخرى"));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

function run(storeName, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("أُلغيت عملية التخزين"));
        const r = work(tx.objectStore(storeName));
        if (r) r.onsuccess = () => { result = r.result; };
      }),
  );
}

export const kv = {
  get: (k) => run("kv", "readonly", (s) => s.get(k)).then((r) => (r ? r.v : undefined)),
  set: (k, v) => run("kv", "readwrite", (s) => s.put({ k, v })),
};

export const invoices = {
  all: () => run("invoices", "readonly", (s) => s.getAll()).then((r) => r || []),
  get: (id) => run("invoices", "readonly", (s) => s.get(id)),
  put: (inv) => run("invoices", "readwrite", (s) => s.put(inv)),
  remove: (id) => run("invoices", "readwrite", (s) => s.delete(id)),
};

// طلب تخزين «دائم» كي لا يمسح المتصفح البيانات عند ضيق المساحة. لا يضمنه المتصفح،
// فنعرض حالته للمستخدم في صفحة الإعدادات بدل افتراض نجاحه.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* تجاهل */ }
  return false;
}
