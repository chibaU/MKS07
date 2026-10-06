// تخزين محلي دائم على الهاتف عبر IndexedDB — يبقى بعد إغلاق المتصفح/التطبيق.
//   kv        إعدادات + نسخة الكتالوج + حالة الواجهة
//   invoices  فاتورة لكل uid (المعرّف الفريد المستقل عن رقم MKS النهائي)
// أي فشل كتابة يُرمى كخطأ ليظهر للمستخدم (لا نبتلع أخطاء التخزين أبداً).

const DB_NAME = "mks-phone";
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("IndexedDB request failed"));
  });
}

export function createDb(idb = globalThis.indexedDB) {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!idb) return reject(new Error("المتصفح لا يدعم التخزين المحلي (IndexedDB)"));
      const r = idb.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
        if (!db.objectStoreNames.contains("invoices")) db.createObjectStore("invoices", { keyPath: "uid" });
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      r.onerror = () => reject(r.error || new Error("تعذّر فتح قاعدة بيانات الهاتف"));
      r.onblocked = () => reject(new Error("قاعدة بيانات الهاتف مقفلة بتبويب آخر — أغلقه وأعد المحاولة"));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error("فشلت عملية التخزين"));
      t.onabort = () => reject(t.error || new Error("أُلغيت عملية التخزين"));
      Promise.resolve(fn(t.objectStore(store))).then((v) => { result = v; }, reject);
    });
  }

  return {
    open,
    async kvGet(k) {
      const row = await tx("kv", "readonly", (s) => req(s.get(k)));
      return row ? row.v : undefined;
    },
    async kvSet(k, v) {
      await tx("kv", "readwrite", (s) => req(s.put({ k, v })));
    },
    async allInvoices() {
      const rows = await tx("invoices", "readonly", (s) => req(s.getAll()));
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    },
    async getInvoice(uid) {
      return (await tx("invoices", "readonly", (s) => req(s.get(uid)))) || null;
    },
    async putInvoice(inv) {
      await tx("invoices", "readwrite", (s) => req(s.put(inv)));
    },
    async deleteInvoice(uid) {
      await tx("invoices", "readwrite", (s) => req(s.delete(uid)));
    },
  };
}
