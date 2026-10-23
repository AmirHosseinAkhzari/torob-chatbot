"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, logout } from "@/lib/api";
import { faDigits } from "@/lib/format";
import { getSession, saveSession, useConversations, useSession, type Session } from "@/lib/store";
import { applyTheme, currentTheme, cycleTheme, THEME_EVENT, THEME_LABEL, type Theme } from "@/lib/theme";
import type { Conversation } from "@/lib/types";
import { CloseIcon, HistoryIcon, MenuIcon, PanelIcon, PlusIcon, SunMoonIcon, UserIcon } from "./icons";
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

/** The signed-in number in the sidebar, with a way out. */
function Account({ session }: { session: Session | null }) {
  if (!session) return null;
  return (
    <div className="side-account">
      <UserIcon />
      <span className="num" dir="ltr">{faDigits(session.phone)}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { logout(); saveSession(null); location.href = "/login"; }}>خروج</button>
    </div>
  );
}

function useThemeLabel() {
  const [t, setT] = useState<Theme>("system");
  useEffect(() => {
    const read = () => setT(currentTheme());
    read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);
  return THEME_LABEL[t];
}

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const currentId = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const router = useRouter();
  const list = useConversations();
  const session = useSession();
  const themeLabel = useThemeLabel();
  const [ready, setReady] = useState(false);

  // Everything needs a login: without a session, go to /login and come back here after.
  useEffect(() => {
    if (!getSession()) {
      router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setReady(true);
    // Settings (the theme) come from the account.
    getMe().then((me) => {
      const s = getSession();
      if (s) saveSession({ ...s, settings: me.settings });
      applyTheme(me.settings?.theme);
    }).catch(() => {});
  }, [router]);
  const [expanded, setExpanded] = useState(!isHome);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setExpanded(!isHome), [isHome]);
  useEffect(() => setDrawer(false), [pathname]);

  if (!ready) return <div className="app" aria-busy="true" />;

  return (
    <UIProvider>
      <div className="app">
        {expanded ? (
          <nav className="sidebar desktop-only" aria-label="گفت‌وگوها">
            <div className="side-head">
              <Link href="/" className="wordmark"><img className="pixel" src="/brand/radish.png" width={28} height={28} alt="" />تربچه</Link>
              <button className="btn btn-ghost btn-icon" onClick={() => setExpanded(false)} aria-label="بستن فهرست"><PanelIcon /></button>
            </div>
            <Link className="btn btn-secondary" href="/"><PlusIcon />گفت‌وگوی جدید</Link>
            <div className="side-scroll"><ConversationList list={list} currentId={currentId} /></div>
            <div className="side-foot">
              <Account session={session} />
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={cycleTheme}><SunMoonIcon />{themeLabel}</button>
            </div>
          </nav>
        ) : (
          <nav className="sidebar is-rail desktop-only" aria-label="منو">
            <Link href="/" aria-label="تربچه" style={{ display: "flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <img className="pixel" src="/brand/radish.png" width={32} height={32} alt="" />
            </Link>
            <Link className="btn btn-ghost btn-icon" href="/" aria-label="گفت‌وگوی جدید" style={{ width: 44, height: 44 }}><PlusIcon /></Link>
            <button className="btn btn-ghost btn-icon" onClick={() => setExpanded(true)} aria-label="گفت‌وگوهای قبلی" style={{ width: 44, height: 44 }}><HistoryIcon /></button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-icon" onClick={cycleTheme} aria-label={themeLabel} style={{ width: 44, height: 44 }}><SunMoonIcon /></button>
          </nav>
        )}

        <div className="main">
          <header className="topbar mobile-only">
            <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label="گفت‌وگوها" style={{ width: 44, height: 44 }}><MenuIcon /></button>
            {title ? <span className="topbar-title">{title}</span> : <Link href="/" className="wordmark" style={{ fontSize: 17 }}><img className="pixel" src="/brand/radish.png" width={24} height={24} alt="" />تربچه</Link>}
            <Link className="btn btn-ghost btn-icon" href="/" aria-label="گفت‌وگوی جدید" style={{ width: 44, height: 44 }}><PlusIcon /></Link>
          </header>
          {children}
        </div>

        {drawer ? (
          <>
            <div className="drawer-scrim mobile-only" onClick={() => setDrawer(false)} />
            <nav className="sidebar drawer mobile-only" aria-label="گفت‌وگوها">
              <div className="side-head">
                <Link href="/" className="wordmark"><img className="pixel" src="/brand/radish.png" width={24} height={24} alt="" />تربچه</Link>
                <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(false)} aria-label="بستن" style={{ width: 44, height: 44 }}><CloseIcon /></button>
              </div>
              <Link className="btn btn-secondary btn-lg" href="/"><PlusIcon />گفت‌وگوی جدید</Link>
              <div className="side-scroll"><ConversationList list={list} currentId={currentId} onNavigate={() => setDrawer(false)} /></div>
              <div className="side-foot">
                <Account session={session} />
                <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={cycleTheme}><SunMoonIcon />{themeLabel}</button>
              </div>
            </nav>
          </>
        ) : null}
      </div>
    </UIProvider>
  );
}
