export interface DraftBox {
  id: number;
  name: string;
  emptyWeight: number;
  grossInput: number;
}

export interface DraftRowBox {
  id: number;
  boxCount: number;
}

export interface DraftRow {
  id: number;
  product: string;
  productId: number | null;
  weight: number;
  price: number;
  boxesSnapshot: DraftRowBox[];
}

export interface Draft {
  id: string;
  merchantName: string;
  merchantId?: number;
  invoiceType: "DATES" | "VEG_FRUIT"; // we have only 2 types of invoices
  productId?: number;
  weightInput: string;
  priceInput: string;
  boxes: DraftBox[];
  rows: DraftRow[];
}

