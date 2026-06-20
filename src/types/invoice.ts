export interface DraftBox {
  id: number;
  name: string;
  emptyWeight: number;
  grossInput: number;
}

export interface DraftRow {
  id: number;
  product: string;
  weight: number;
  price: number;
}

export interface Draft {
  id: string;
  merchantName: string;
  productInput: string;
  weightInput: string;
  priceInput: string;
  boxes: DraftBox[];
  rows: DraftRow[];
}
