import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { MerchantsPage } from "./components/MerchantsPage";
import { ProductsPage } from "./components/ProductsPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { BoxesPage } from "./components/BoxesPage";
import { SettingsPage } from "./components/SettingsPage";

type Page = "home" | "merchants" | "products" | "invoices" | "boxes" | "settings";

export interface SharedBox {
  id: number;
  name: string;
  emptyWeight: number;
  visible: boolean;
}

const INITIAL_BOXES: SharedBox[] = [
  { id: 1, name: "صندوق A", emptyWeight: 2.5, visible: true },
  { id: 2, name: "صندوق B", emptyWeight: 3.0, visible: true },
  { id: 3, name: "صندوق C", emptyWeight: 2.0, visible: true },
  { id: 4, name: "صندوق D", emptyWeight: 1.5, visible: true },
  { id: 5, name: "صندوق E", emptyWeight: 2.0, visible: true },
  { id: 6, name: "صندوق خاص", emptyWeight: 5.5, visible: true },
];

const SIDEBAR_WIDTH = 240;

export default function App() {
  const [activePage, setActivePage] = useState<Page>("home");
  const [sharedBoxes, setSharedBoxes] = useState<SharedBox[]>(INITIAL_BOXES);

  const renderPage = () => {
    switch (activePage) {
      case "home":     return <HomePage sharedBoxes={sharedBoxes} />;
      case "merchants": return <MerchantsPage />;
      case "products":  return <ProductsPage />;
      case "invoices":  return <InvoicesPage />;
      case "boxes":     return <BoxesPage sharedBoxes={sharedBoxes} setSharedBoxes={setSharedBoxes} />;
      case "settings":  return <SettingsPage />;
    }
  };

  return (
    <div
      style={{
        direction: "rtl",
        fontFamily: "'Cairo', sans-serif",
        backgroundColor: "#F8FAFC",
        minHeight: "100vh",
        display: "flex",
      }}
    >
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main
        style={{
          marginRight: `${SIDEBAR_WIDTH}px`,
          flex: 1,
          minHeight: "100vh",
          backgroundColor: "#F8FAFC",
          overflowY: "auto",
        }}
      >
        {renderPage()}
      </main>
    </div>
  );
}
