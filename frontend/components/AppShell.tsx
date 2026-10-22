"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useConversations } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { CloseIcon, HistoryIcon, MenuIcon, PanelIcon, PlusIcon, SunMoonIcon, TorobLogo } from "./icons";
import { UIProvider } from "./UIContext";

function groupLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days <= 0) return "امروز";
  if (days === 1) return "دیروز";
  if (days < 7) return "هفته‌ی گذشته";
  return "قبل‌تر";
}

function ConversationList({ list, currentId, onNavigate }: { list: Conversation[]; currentId: string | null; onNavigate?: () => void }) {
  if (!list.length) return <p className="row-sub" style={{ padding: "8px", margin: 0 }}>گفت‌وگوهات اینجا روی همین دستگاه ذخیره می‌شه.</p>;
  const groups: { label: string; items: Conversation[] }[] = [];
  for (const c of list) {
    const label = groupLabel(c.updatedAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="side-group">{g.label}</div>
          <ul className="side-list">
            {g.items.map((c) => (
              <li key={c.id}>
                <Link className="side-item" href={`/c/${c.id}`} aria-current={c.id === currentId ? "page" : undefined} onClick={onNavigate}>
                  {c.title || "گفت‌وگوی جدید"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("torob-chat:theme", next); } catch { /* ignore */ }
}

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const currentId = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const list = useConversations();
  const [expanded, setExpanded] = useState(!isHome);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setExpanded(!isHome), [isHome]);
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <UIProvider>
      <div className="app">
        {expanded ? (
          <nav className="sidebar desktop-only" aria-label="گفت‌وگوها">
            <div className="side-head">
              <Link href="/" className="wordmark"><TorobLogo size={28} />تربچت</Link>
              <button className="btn btn-ghost btn-icon" onClick={() => setExpanded(false)} aria-label="بستن فهرست"><PanelIcon /></button>
            </div>
            <Link className="btn btn-secondary" href="/"><PlusIcon />گفت‌وگوی جدید</Link>
            <div className="side-scroll"><ConversationList list={list} currentId={currentId} /></div>
            <div className="side-foot">
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={toggleTheme}><SunMoonIcon />تم روشن / تیره</button>
            </div>
          </nav>
        ) : (
          <nav className="sidebar is-rail desktop-only" aria-label="منو">
            <Link href="/" aria-label="تربچت" style={{ display: "flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <img className="pixel" src="/brand/radish.png" width={32} height={32} alt="" />
            </Link>
            <Link className="btn btn-ghost btn-icon" href="/" aria-label="گفت‌وگوی جدید" style={{ width: 44, height: 44 }}><PlusIcon /></Link>
            <button className="btn btn-ghost btn-icon" onClick={() => setExpanded(true)} aria-label="گفت‌وگوهای قبلی" style={{ width: 44, height: 44 }}><HistoryIcon /></button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-icon" onClick={toggleTheme} aria-label="تم روشن / تیره" style={{ width: 44, height: 44 }}><SunMoonIcon /></button>
          </nav>
        )}

        <div className="main">
          <header className="topbar mobile-only">
            <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label="گفت‌وگوها" style={{ width: 44, height: 44 }}><MenuIcon /></button>
            {title ? <span className="topbar-title">{title}</span> : <Link href="/" className="wordmark" style={{ fontSize: 17 }}><TorobLogo size={24} />تربچت</Link>}
            <Link className="btn btn-ghost btn-icon" href="/" aria-label="گفت‌وگوی جدید" style={{ width: 44, height: 44 }}><PlusIcon /></Link>
          </header>
          {children}
        </div>

        {drawer ? (
          <>
            <div className="drawer-scrim mobile-only" onClick={() => setDrawer(false)} />
            <nav className="sidebar drawer mobile-only" aria-label="گفت‌وگوها">
              <div className="side-head">
                <Link href="/" className="wordmark"><TorobLogo size={24} />تربچت</Link>
                <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(false)} aria-label="بستن" style={{ width: 44, height: 44 }}><CloseIcon /></button>
              </div>
              <Link className="btn btn-secondary btn-lg" href="/"><PlusIcon />گفت‌وگوی جدید</Link>
              <div className="side-scroll"><ConversationList list={list} currentId={currentId} onNavigate={() => setDrawer(false)} /></div>
              <div className="side-foot">
                <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={toggleTheme}><SunMoonIcon />تم روشن / تیره</button>
              </div>
            </nav>
          </>
        ) : null}
      </div>
    </UIProvider>
  );
}
