"use client";

import { DatabaseIcon, GridIcon, PlusIcon, StoreIcon } from "../icons";
import PanelShell from "./PanelShell";

const NAV = [
  { href: "/admin", label: "داشبورد", icon: <GridIcon className="icon-sm" />, exact: true },
  { href: "/admin/stores", label: "فروشگاه‌ها", icon: <StoreIcon className="icon-sm" />, exact: true },
  { href: "/admin/stores/new", label: "افزودن فروشگاه", icon: <PlusIcon className="icon-sm" />, exact: true },
  { href: "/admin/data", label: "داده‌ها: کالا و قیمت", icon: <DatabaseIcon className="icon-sm" /> },
];

/** پنل مدیریت (admin.<domain>, or /admin). */
export default function AdminPanel({ children }: { children: React.ReactNode }) {
  return <PanelShell kind="admin" title="تربچه" subtitle="پنل مدیریت" nav={NAV}>{() => children}</PanelShell>;
}
