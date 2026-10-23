"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ProductCard } from "@/lib/types";
import ProductPopup from "./ProductPopup";

type UI = {
  /** pay: show only sellers that accept this installment provider ("any" = any of them). */
  openProduct: (id: string, tab?: "sellers" | "map", pay?: string | null) => void;
  /** Put a product into the message box as an attachment. */
  attachToComposer: (p: ProductCard) => void;
};

const Ctx = createContext<UI>({ openProduct: () => {}, attachToComposer: () => {} });
export const useUI = () => useContext(Ctx);

export const ATTACH_EVENT = "torob-chat:attach";

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [popup, setPopup] = useState<{ id: string; tab: "sellers" | "map"; pay: string | null } | null>(null);

  const attachToComposer = useCallback((p: ProductCard) => {
    window.dispatchEvent(new CustomEvent<ProductCard>(ATTACH_EVENT, { detail: p }));
  }, []);

  const value = useMemo<UI>(
    () => ({ openProduct: (id, tab = "sellers", pay = null) => setPopup({ id, tab, pay }), attachToComposer }),
    [attachToComposer],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {popup ? (
        <ProductPopup
          id={popup.id}
          initialTab={popup.tab}
          pay={popup.pay}
          onClose={() => setPopup(null)}
          onAsk={(p) => {
            setPopup(null);
            attachToComposer(p);
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}
