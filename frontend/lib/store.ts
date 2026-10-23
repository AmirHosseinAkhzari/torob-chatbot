"use client";

import { useEffect, useState } from "react";
import { fetchConversation, listConversations, putConversation } from "./api";
import { getSession, SESSION_EVENT, type Session } from "./session";
import type { Conversation, ProductCard, UserLocation } from "./types";

const LOC_KEY = "torob-chat:location:v1";
const EVENT = "torob-chat:changed";

// Chat history lives on the account (Postgres). Saves for one conversation go out in order.
const saving = new Map<string, Promise<unknown>>();

export async function getConversation(id: string): Promise<Conversation | null> {
  try {
    return await fetchConversation(id);
  } catch {
    return null;
  }
}

export function saveConversation(conv: Conversation) {
  const prev = saving.get(conv.id) ?? Promise.resolve();
  const next = prev.then(() => putConversation(conv)).then(() => window.dispatchEvent(new Event(EVENT))).catch(() => {});
  saving.set(conv.id, next);
}

export function useConversations(): Conversation[] {
  const [list, setList] = useState<Conversation[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!getSession()) return setList([]);
      listConversations().then((r) => alive && setList(r.conversations)).catch(() => {});
    };
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener(SESSION_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, load);
      window.removeEventListener(SESSION_EVENT, load);
    };
  }, []);
  return list;
}

/** A first message handed from the home page to the new chat page. */
export type Pending = { text: string; attachments: ProductCard[] };

export function setPending(id: string, p: Pending) {
  try {
    sessionStorage.setItem(`torob-chat:pending:${id}`, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function takePending(id: string): Pending | null {
  try {
    const k = `torob-chat:pending:${id}`;
    const raw = sessionStorage.getItem(k);
    sessionStorage.removeItem(k);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

export function getSavedLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    return raw ? (JSON.parse(raw) as UserLocation) : null;
  } catch {
    return null;
  }
}

export function saveLocation(loc: UserLocation | null) {
  try {
    if (loc) localStorage.setItem(LOC_KEY, JSON.stringify(loc));
    else localStorage.removeItem(LOC_KEY);
  } catch {
    /* ignore */
  }
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/* Login session: stored by lib/session.ts; this hook re-renders when it changes. */
export { getSession, saveSession, type Session } from "./session";

export function useSession(): Session | null {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    const read = () => setS(getSession());
    read();
    window.addEventListener(SESSION_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(SESSION_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return s;
}
