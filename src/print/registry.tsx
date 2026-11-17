// سجل أنواع المستندات: النوع ← دالة ترسم بياناته. نوع واحد حالياً ('invoice').
// لإضافة مستند جديد: مكوّن في documents/ + سطر هنا.

import type { ReactNode } from "react";
import { InvoiceA4, type InvoiceA4Data } from "./documents/InvoiceA4.tsx";

type Renderer = (data: unknown) => ReactNode;

const renderers: Readonly<Record<string, Renderer>> = {
  invoice: (data) => <InvoiceA4 data={data as InvoiceA4Data} />,
};

export function hasDocumentType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(renderers, type);
}

export function renderDocument(type: string, data: unknown): ReactNode {
  return hasDocumentType(type) ? renderers[type](data) : null;
}
