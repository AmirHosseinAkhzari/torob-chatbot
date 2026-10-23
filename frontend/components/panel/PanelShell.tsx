"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, logout, type Roles } from "@/lib/api";
import { faDigits } from "@/lib/format";
import { getSession, saveSession } from "@/lib/session";
import { applyTheme } from "@/lib/theme";
import { CloseIcon, MenuIcon, UserIcon } from "../icons";

export type NavItem = { href: string; label: string; icon?: React.ReactNode; badge?: number; exact?: boolean };

type Props = {
  kind: "admin" | "store";
  /** Sidebar title under the logo, e.g. «پنل مدیریت» or the shop's name. */
  title?: string;
  subtitle?: string;
  nav: NavItem[];
  children: (roles: Roles) => React.ReactNode;
};

/** Layout of the admin and store panels: side menu (a drawer on phones) + content. Needs a login, and the
    admin role (admin) or staff of at least one shop (store); the server checks every request again. */
export default function PanelShell({ kind, title, subtitle, nav, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [roles, setRoles] = useState<Roles | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setPhone(s.phone);
    getMe().then((me) => {
      applyTheme(me.settings?.theme);
      setRoles(me.roles ?? { admin: false, shops: [] });
    }).catch((e) => setError(e.message));
  }, [router]);
  useEffect(() => setDrawer(false), [pathname]);

  if (error) return <main className="panel-gate"><p>{error}</p></main>;
  if (!roles) return <div className="panel" aria-busy="true" />;
  const allowed = kind === "admin" ? roles.admin : roles.admin || roles.shops.length > 0;
  if (!allowed) {
    return (
      <main className="panel-gate">
        <img className="pixel" src="/brand/radish.png" width={48} height={48} alt="" />
        <h1>{kind === "admin" ? "این بخش فقط برای مدیرهاست" : "پنل فروشگاه برای این شماره فعال نیست"}</h1>
        <p className="row-sub" style={{ fontSize: 14 }}>
          {kind === "admin" ? "با شماره‌ی مدیر وارد شو." : "از مدیر تربچه بخواه شماره‌ی تو رو به فروشگاهت اضافه کنه."}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-secondary" href="/">برگشت به تربچه</Link>
          <button className="btn btn-ghost" onClick={() => { logout(); saveSession(null); location.href = "/login"; }}>ورود با شماره‌ی دیگه</button>
        </div>
      </main>
    );
  }

  const side = (
    <>
      <div className="panel-brand">
        <img className="pixel" src="/brand/radish.png" width={32} height={32} alt="" />
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <b className="panel-brand-title">{title ?? "تربچه"}</b>
          <span className="row-sub">{subtitle ?? (kind === "admin" ? "پنل مدیریت" : "پنل فروشگاه")}</span>
        </span>
      </div>
      <nav aria-label="بخش‌ها">
        <ul className="panel-nav">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.href.split("?")[0] : pathname.startsWith(n.href.split("?")[0]);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? "page" : undefined}>
                  {n.icon}<span style={{ flex: 1 }}>{n.label}</span>
                  {n.badge ? <span className="badge badge-brand num">{faDigits(n.badge)}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="panel-foot">
        <UserIcon className="icon-sm" />
        <span className="num" dir="ltr" style={{ flex: 1, textAlign: "right" }}>{faDigits(phone)}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { logout(); saveSession(null); location.href = "/login"; }}>خروج</button>
      </div>
    </>
  );

  return (
    <div className="panel">
      <aside className="panel-side desktop-only">{side}</aside>
      <header className="topbar mobile-only">
        <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label="منو" style={{ width: 44, height: 44 }}><MenuIcon /></button>
        <span className="topbar-title">{title ?? (kind === "admin" ? "پنل مدیریت" : "پنل فروشگاه")}</span>
        <span style={{ width: 44 }} />
      </header>
      {drawer ? (
        <>
          <div className="drawer-scrim mobile-only" onClick={() => setDrawer(false)} />
          <aside className="panel-side drawer mobile-only">
            <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(false)} aria-label="بستن" style={{ width: 44, height: 44, alignSelf: "flex-end" }}><CloseIcon /></button>
            {side}
          </aside>
        </>
      ) : null}
      <main className="panel-main">{children(roles)}</main>
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "brand" }) {
  return (
    <section className={`kpi ${tone === "brand" ? "is-brand" : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      {sub ? <span className="row-sub">{sub}</span> : null}
    </section>
  );
}

export function Bars({ items, total, tone }: { items: { label: string; n: number }[]; total: number; tone?: "success" }) {
  if (!items.length) return <p className="row-sub" style={{ margin: 0, fontSize: 14 }}>هنوز موردی ثبت نشده.</p>;
  return (
    <ul className="bars">
      {items.map((it) => (
        <li key={it.label}>
          <span>{it.label}</span>
          <span className="bar-track"><span className={`bar-fill ${tone === "success" ? "is-success" : ""}`}
            style={{ width: `${Math.max(3, Math.round((it.n / Math.max(1, total)) * 100))}%` }} /></span>
          <span className="num" style={{ fontWeight: 700, textAlign: "left" }}>{faDigits(it.n)}</span>
        </li>
      ))}
    </ul>
  );
}
