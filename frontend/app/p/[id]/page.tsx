"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import StoresView from "@/components/stores/StoresView";
import { getProduct } from "@/lib/api";
import { money } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";

/** A product's in-person shops, with one shop selected: the link in the store-inquiry SMS (/p/<id>?shop=<shop id>). */
function ProductStores() {
  const { id } = useParams<{ id: string }>();
  const shop = useSearchParams().get("shop");
  const [p, setP] = useState<ProductDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getProduct(id, ctrl.signal).then(setP).catch((e) => { if (e.name !== "AbortError") setError(true); });
    return () => ctrl.abort();
  }, [id]);

  return (
    <main className="chat-scroll">
      <div style={{ width: "100%", maxWidth: "var(--size-column)", display: "flex", flexDirection: "column", gap: 16 }}>
        {error ? (
          <div className="answer-error">این کالا پیدا نشد. <Link href="/">برگرد به ترب‌چت</Link></div>
        ) : !p ? (
          <div className="searching" role="status"><img className="pixel" src="/brand/searching.gif" width={64} height={64} alt="" /></div>
        ) : (
          <>
            <header style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {p.image ? <img src={p.image} alt="" width={64} height={64} referrerPolicy="no-referrer" style={{ borderRadius: 8, objectFit: "contain", background: "#fff" }} /> : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: 17, lineHeight: "28px" }}>{p.title}</h1>
                {p.price.min ? <span className="row-sub">از {money(p.price.min)} تومان</span> : null}
              </div>
            </header>
            <StoresView productId={p.id} productTitle={p.title} productImage={p.image} focusShop={shop} />
          </>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ProductStores />
      </Suspense>
    </AppShell>
  );
}
