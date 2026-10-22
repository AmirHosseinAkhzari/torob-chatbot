"use client";

import { useEffect, useState } from "react";
import type { Conversation, ProductCard, UserLocation } from "./types";

const KEY = "torob-chat:conversations:v1";
const LOC_KEY = "torob-chat:location:v1";
const EVENT = "torob-chat:changed";

function readAll(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: Conversation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* storage full or blocked: the chat still works for this session */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function getConversation(id: string): Conversation | null {
  return readAll().find((c) => c.id === id) ?? null;
}

export function saveConversation(conv: Conversation) {
  const list = readAll().filter((c) => c.id !== conv.id);
  writeAll([conv, ...list].sort((a, b) => b.updatedAt - a.updatedAt));
}

export function useConversations(): Conversation[] {
  const [list, setList] = useState<Conversation[]>([]);
  useEffect(() => {
    const load = () => setList(readAll());
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
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
