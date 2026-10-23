"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Roles } from "@/lib/api";
import { DatabaseIcon, InboxIcon } from "../icons";
import PanelShell from "./PanelShell";

/** پنل فروشگاه: the shop comes from ?shop=… or the signed-in staff's (first) shop. */
function Inner({ children, badge }: { children: (shopId: string, roles: Roles) => React.ReactNode; badge?: number }) {
  const params = useSearchParams();
  const wanted = params.get("shop");
  return (
    <PanelShell kind="store" title="پنل فروشگاه" nav={[]}>
      {(roles) => {
        const shop = roles.shops.find((s) => s.id === wanted) ?? (wanted && roles.admin ? { id: wanted, name: "", area: null } : roles.shops[0]);
        if (!shop) return <p className="row-sub" style={{ fontSize: 14 }}>فروشگاهی برای این شماره ثبت نشده. مدیرها از پنل مدیریت › فروشگاه‌ها، پنل هر فروشگاه رو باز می‌کنن.</p>;
        return <ShopNav shopId={shop.id} name={shop.name} roles={roles} badge={badge}>{children(shop.id, roles)}</ShopNav>;
      }}
    </PanelShell>
  );
}

/** PanelShell draws the menu before the shop is known, so the shop's own menu is drawn here. */
function ShopNav({ shopId, name, roles, children }: { shopId: string; name: string; roles: Roles; badge?: number; children: React.ReactNode }) {
  const q = `?shop=${encodeURIComponent(shopId)}`;
  const path = usePathname();
  return (
    <>
      <nav aria-label="بخش‌های پنل فروشگاه" className="tabs">
        <a href={`/store${q}`} role="tab" aria-selected={path === "/store" || path.startsWith("/store/requests")} className="store-tab">
          <InboxIcon className="icon-sm" />درخواست‌های تأیید
        </a>
        <a href={`/store/offers${q}`} role="tab" aria-selected={path === "/store/offers"} className="store-tab">
          <DatabaseIcon className="icon-sm" />کالاها و قیمت‌ها
        </a>
        {roles.shops.length > 1 ? (
          <label className="store-switch">
            <span className="sr-only">فروشگاه</span>
            <select className="select is-sm" value={shopId} onChange={(e) => { location.href = `${location.pathname}?shop=${encodeURIComponent(e.target.value)}`; }}>
              {roles.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : name ? <span className="store-switch row-sub" style={{ fontSize: 14 }}>{name}</span> : null}
      </nav>
      {children}
    </>
  );
}

export default function StorePanel(props: { children: (shopId: string, roles: Roles) => React.ReactNode }) {
  return <Suspense fallback={<div className="panel" aria-busy="true" />}><Inner {...props} /></Suspense>;
}
