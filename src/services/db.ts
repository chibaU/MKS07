import Database, { type QueryResult } from '@tauri-apps/plugin-sql';

type NullableString = string | null;
type NullableNumber = number | null;
type DatabaseConnection = Awaited<ReturnType<typeof Database.load>>;

export interface Setting {
  key: string;
  value: string;
}

export interface Merchant {
  id: number;
  name: string;
  address: NullableString;
  phone: NullableString;
  created_at: NullableString;
}

export interface Product {
  id: number;
  name: string;
}

export interface Box {
  id: number;
  name: string;
  weight: number;
  is_visible: number;
}

export interface Invoice {
  id: number;
  merchant_id: NullableNumber;
  invoice_date: NullableString;
  total_amount: number;
}

export interface InvoiceDetail {
  id: number;
  invoice_id: number;
  product_name: string; 
  quantity: number;
  price: number;
  subtotal: number;
}

export interface InvoiceDetailBox {
  invoice_detail_id: number;
  box_id: number;
  box_count: number;
}

export interface CreateInvoiceData {
  merchant_id: NullableNumber;
  invoice_date: string;
  total_amount: number;
}

export interface CreateInvoiceDetailBox {
  box_id: number;
  box_count: number;
}

export interface CreateInvoiceDetail {
  product_name: string;       // Elاسم المكتوب مباشرة في حقل الإدخال
  quantity: number;
  price: number;
  subtotal: number;
  boxes: CreateInvoiceDetailBox[];
}

export interface InvoiceWithMerchant extends Invoice {
  merchant_name: NullableString;
}

export interface InvoiceDetailBoxFull extends InvoiceDetailBox {
  box_name: string;
  box_weight: number;
  is_visible: number;
}

export interface InvoiceDetailFull extends InvoiceDetail {
  boxes: InvoiceDetailBoxFull[];
}

export interface InvoiceFullDetails extends InvoiceWithMerchant {
  details: InvoiceDetailFull[];
}

interface InvoiceDetailRow extends InvoiceDetail {}

interface InvoiceDetailBoxRow extends InvoiceDetailBox {
  detail_id: number;
  box_name: string;
  box_weight: number;
  is_visible: number;
}

const DB_PATH = 'sqlite:mks.db';

let dbPromise: Promise<DatabaseConnection> | null = null;

async function getDB(): Promise<DatabaseConnection> {
  dbPromise ??= Database.load(DB_PATH);
  return await dbPromise;
}

function requireLastInsertId(result: QueryResult, entityName: string): number {
  if (typeof result.lastInsertId !== 'number') {
    throw new Error(`Failed to read inserted ${entityName} id.`);
  }

  return result.lastInsertId;
}

async function executeInTransaction(
  db: DatabaseConnection,
  operation: () => Promise<QueryResult>
): Promise<QueryResult> {
  await db.execute('BEGIN TRANSACTION');

  try {
    const result = await operation();
    await db.execute('COMMIT');
    return result;
  } catch (error: unknown) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export const settingsService = {
  async get(key: string): Promise<string | null> {
    const db = await getDB();
    const rows = await db.select<Setting[]>(
      'SELECT key, value FROM settings WHERE key = $1 LIMIT 1',
      [key]
    );

    return rows[0]?.value ?? null;
  },

  async update(key: string, value: string): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }
};

export const merchantService = {
  async getAll(): Promise<Merchant[]> {
    const db = await getDB();
    return await db.select<Merchant[]>(
      'SELECT id, name, address, phone, created_at FROM merchants ORDER BY name ASC'
    );
  },

  async create(
    name: string,
    address: NullableString,
    phone: NullableString
  ): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'INSERT INTO merchants (name, address, phone) VALUES ($1, $2, $3)',
      [name, address, phone]
    );
  },

  async update(
    id: number,
    name: string,
    address: NullableString,
    phone: NullableString
  ): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'UPDATE merchants SET name = $1, address = $2, phone = $3 WHERE id = $4',
      [name, address, phone, id]
    );
  },

  async delete(id: number): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute('DELETE FROM merchants WHERE id = $1', [id]);
  }
};

export const productService = {
  async getAll(): Promise<Product[]> {
    const db = await getDB();
    return await db.select<Product[]>(
      'SELECT id, name FROM products ORDER BY name ASC'
    );
  },

  async create(name: string): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute('INSERT INTO products (name) VALUES ($1)', [name]);
  },

  async update(id: number, name: string): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'UPDATE products SET name = $1 WHERE id = $2',
      [name, id]
    );
  },

  async delete(id: number): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute('DELETE FROM products WHERE id = $1', [id]);
  }
};

export const boxService = {
  async getAll(): Promise<Box[]> {
    const db = await getDB();
    return await db.select<Box[]>(
      'SELECT id, name, weight, is_visible FROM boxes ORDER BY name ASC'
    );
  },

  async getVisible(): Promise<Box[]> {
    const db = await getDB();
    return await db.select<Box[]>(
      'SELECT id, name, weight, is_visible FROM boxes WHERE is_visible = 1 ORDER BY name ASC'
    );
  },

  async create(name: string, weight: number): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'INSERT INTO boxes (name, weight) VALUES ($1, $2)',
      [name, weight]
    );
  },

  async update(
    id: number,
    name: string,
    weight: number,
    is_visible: number
  ): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute(
      'UPDATE boxes SET name = $1, weight = $2, is_visible = $3 WHERE id = $4',
      [name, weight, is_visible, id]
    );
  },

  async delete(id: number): Promise<QueryResult> {
    const db = await getDB();
    return await db.execute('DELETE FROM boxes WHERE id = $1', [id]);
  }
};

export const invoiceService = {
  async createInvoice(
    invoiceData: CreateInvoiceData,
    details: CreateInvoiceDetail[]
  ): Promise<QueryResult> {
    const db = await getDB();

    return await executeInTransaction(db, async () => {
      const invoiceResult = await db.execute(
        'INSERT INTO invoices (merchant_id, invoice_date, total_amount) VALUES ($1, $2, $3)',
        [
          invoiceData.merchant_id,
          invoiceData.invoice_date,
          invoiceData.total_amount
        ]
      );
      const invoiceId = requireLastInsertId(invoiceResult, 'invoice');

      for (const detail of details) {
        // يتم الآن إدخال حقل product_name بشكل مباشر في الجدول لحفظ النص الثابت
        const detailResult = await db.execute(
          'INSERT INTO invoice_details (invoice_id, product_name, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
          [
            invoiceId,
            detail.product_name,
            detail.quantity,
            detail.price,
            detail.subtotal
          ]
        );
        const invoiceDetailId = requireLastInsertId(
          detailResult,
          'invoice detail'
        );

        for (const box of detail.boxes) {
          await db.execute(
            'INSERT INTO invoice_detail_boxes (invoice_detail_id, box_id, box_count) VALUES ($1, $2, $3)',
            [invoiceDetailId, box.box_id, box.box_count]
          );
        }
      }

      return invoiceResult;
    });
  },

  async getInvoicesWithPagination(
    limit: number,
    offset: number
  ): Promise<InvoiceWithMerchant[]> {
    const db = await getDB();
    return await db.select<InvoiceWithMerchant[]>(
      `SELECT
        invoices.id,
        invoices.merchant_id,
        invoices.invoice_date,
        invoices.total_amount,
        merchants.name AS merchant_name
      FROM invoices
      LEFT JOIN merchants ON merchants.id = invoices.merchant_id
      ORDER BY invoices.invoice_date DESC, invoices.id DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  },

  async getMerchantInvoices(merchantId: number): Promise<InvoiceWithMerchant[]> {
    const db = await getDB();
    return await db.select<InvoiceWithMerchant[]>(
      `SELECT
        invoices.id,
        invoices.merchant_id,
        invoices.invoice_date,
        invoices.total_amount,
        merchants.name AS merchant_name
      FROM invoices
      LEFT JOIN merchants ON merchants.id = invoices.merchant_id
      WHERE invoices.merchant_id = $1
      ORDER BY invoices.invoice_date DESC, invoices.id DESC`,
      [merchantId]
    );
  },

  async getInvoiceFullDetails(
    invoiceId: number
  ): Promise<InvoiceFullDetails | null> {
    const db = await getDB();
    const invoices = await db.select<InvoiceWithMerchant[]>(
      `SELECT
        invoices.id,
        invoices.merchant_id,
        invoices.invoice_date,
        invoices.total_amount,
        merchants.name AS merchant_name
      FROM invoices
      LEFT JOIN merchants ON merchants.id = invoices.merchant_id
      WHERE invoices.id = $1
      LIMIT 1`,
      [invoiceId]
    );
    const invoice = invoices[0];

    if (!invoice) {
      return null;
    }

    // هنا قمنا بالاعتماد المباشر على الحقل المخزن بالجدول invoice_details.product_name 
    // دون الحاجة لربط مصلحي (LEFT JOIN products) لإحضار الاسم
    const detailRows = await db.select<InvoiceDetailRow[]>(
      `SELECT
        invoice_details.id,
        invoice_details.invoice_id,
        invoice_details.product_name,
        invoice_details.quantity,
        invoice_details.price,
        invoice_details.subtotal
      FROM invoice_details
      WHERE invoice_details.invoice_id = $1
      ORDER BY invoice_details.id ASC`,
      [invoiceId]
    );

    const boxRows = await db.select<InvoiceDetailBoxRow[]>(
      `SELECT
        invoice_detail_boxes.invoice_detail_id,
        invoice_detail_boxes.invoice_detail_id AS detail_id,
        invoice_detail_boxes.box_id,
        invoice_detail_boxes.box_count,
        boxes.name AS box_name,
        boxes.weight AS box_weight,
        boxes.is_visible
      FROM invoice_detail_boxes
      INNER JOIN invoice_details ON invoice_details.id = invoice_detail_boxes.invoice_detail_id
      INNER JOIN boxes ON boxes.id = invoice_detail_boxes.box_id
      WHERE invoice_details.invoice_id = $1
      ORDER BY invoice_detail_boxes.invoice_detail_id ASC, boxes.name ASC`,
      [invoiceId]
    );

    const details = detailRows.map((detail): InvoiceDetailFull => ({
      ...detail,
      boxes: boxRows
        .filter((box) => box.detail_id === detail.id)
        .map((box): InvoiceDetailBoxFull => ({
          invoice_detail_id: box.invoice_detail_id,
          box_id: box.box_id,
          box_count: box.box_count,
          box_name: box.box_name,
          box_weight: box.box_weight,
          is_visible: box.is_visible
        }))
    }));

    return {
      ...invoice,
      details
    };
  },

  async deleteInvoice(id: number): Promise<QueryResult> {
    const db = await getDB();

    return await executeInTransaction(db, async () => {
      await db.execute(
        `DELETE FROM invoice_detail_boxes
        WHERE invoice_detail_id IN (
          SELECT id FROM invoice_details WHERE invoice_id = $1
        )`,
        [id]
      );
      await db.execute('DELETE FROM invoice_details WHERE invoice_id = $1', [id]);
      return await db.execute('DELETE FROM invoices WHERE id = $1', [id]);
    });
  }
};