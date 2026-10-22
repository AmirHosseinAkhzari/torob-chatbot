"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import BlockView from "@/components/chat/Blocks";
import { ChatContext } from "@/components/chat/ChatContext";
import RichText from "@/components/chat/RichText";
import SearchProgress from "@/components/chat/SearchProgress";
import { ClockIcon, CopyIcon } from "@/components/icons";
import { streamChat, type ChatEvent } from "@/lib/api";
import { shortTitle } from "@/lib/format";
import { getConversation, getSavedLocation, newId, saveConversation, takePending } from "@/lib/store";
import type { Conversation, Message, ProductCard } from "@/lib/types";

type Assistant = Extract<Message, { role: "assistant" }>;

function historyOf(messages: Message[]) {
  return messages.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.text + (m.attachments.length ? `\n[پیوست: ${m.attachments.map((a) => a.title).join("، ")}]` : "") }
      : {
          role: "assistant",
          content: m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n") + (m.memo ? `\n${m.memo}` : ""),
        },
  ).filter((m) => m.content.trim());
}

function apply(msg: Assistant, e: ChatEvent): Assistant {
  switch (e.type) {
    case "text": {
      const parts = [...msg.parts];
      const last = parts[parts.length - 1];
      if (last && last.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + e.delta };
      else parts.push({ type: "text", text: e.delta });
      return { ...msg, parts };
    }
    case "block":
      return { ...msg, parts: [...msg.parts, { type: "block", block: e.block }] };
    case "status": {
      const status = msg.status.filter((s) => s.id !== e.id);
      status.push({ id: e.id, state: e.state, text: e.text, count: e.count });
      status.sort((a, b) => a.id - b.id);
      return { ...msg, status };
    }
    case "sources":
      return { ...msg, sources: { searches: e.searches, items: e.items } };
    case "memo":
      return { ...msg, memo: e.text };
    case "error":
      return { ...msg, error: e.message };
    case "done":
      return { ...msg, done: true };
  }
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const convRef = useRef<Conversation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef<string | null>(null);

  const commit = useCallback((next: Conversation, persist = false) => {
    convRef.current = next;
    setConv(next);
    if (persist) saveConversation(next);
  }, []);

  const send = useCallback(
    async (text: string, attachments: ProductCard[] = []) => {
      const base = convRef.current;
      if (!base || abortRef.current) return;
      const user: Message = { id: newId(), role: "user", text, attachments };
      const assistant: Assistant = { id: newId(), role: "assistant", parts: [], status: [], sources: null, memo: null, error: null, done: false };
      const history = historyOf(base.messages);
      commit({ ...base, title: base.title || shortTitle(text, 60), updatedAt: Date.now(), messages: [...base.messages, user, assistant] }, true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      const loc = getSavedLocation();
      const update = (e: ChatEvent) => {
        const cur = convRef.current!;
        const msgs = cur.messages.map((m) => (m.id === assistant.id && m.role === "assistant" ? apply(m, e) : m));
        commit({ ...cur, messages: msgs }, e.type === "done" || e.type === "block");
      };
      try {
        await streamChat(
          { message: text, history, attachments: attachments.map((a) => a.id), location: loc ? { lat: loc.lat, lng: loc.lng, area: loc.area } : null },
          update,
          ctrl.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") update({ type: "error", message: "به سرور تربچت وصل نشدم. بک‌اند رو بررسی کن و دوباره بفرست." });
      } finally {
        const cur = convRef.current!;
        const last = cur.messages.find((m) => m.id === assistant.id) as Assistant | undefined;
        if (last && !last.done) update({ type: "done" });
        abortRef.current = null;
        setBusy(false);
      }
    },
    [commit],
  );

  useEffect(() => {
    if (started.current === id) return;
    started.current = id;
    const existing = getConversation(id) ?? { id, title: "", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    // An answer cut off by a reload is closed so the page never shows it as still running.
    const fixed = {
      ...existing,
      messages: existing.messages.map((m) => (m.role === "assistant" && !m.done ? { ...m, done: true, error: m.parts.length ? null : "پاسخ کامل نشد." } : m)),
    };
    commit(fixed);
    const pending = takePending(id);
    if (pending) send(pending.text, pending.attachments);
  }, [id, commit, send]);

  // Follow the answer while it streams, unless the reader scrolled up.
  const lastLen = useMemo(() => JSON.stringify(conv?.messages[conv.messages.length - 1] ?? "").length, [conv]);
  useEffect(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 240;
    if (nearBottom) window.scrollTo({ top: document.body.scrollHeight });
  }, [lastLen]);

  const stop = () => abortRef.current?.abort();
  const ctx = useMemo(() => ({ send: (t: string, a?: ProductCard[]) => send(t, a ?? []), busy }), [send, busy]);
  const messages = conv?.messages ?? [];

  return (
    <AppShell title={conv?.title || undefined}>
      <ChatContext.Provider value={ctx}>
        <main className="chat-scroll">
          <div className="turns">
            {messages.length === 0 ? (
              <div className="searching"><img className="pixel" src="/brand/radish.gif" width={56} height={56} alt="" /><b>چی می‌خوای بخری؟</b></div>
            ) : null}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="user-msg">
                  {m.attachments.length ? (
                    <div className="attach-chips">
                      {m.attachments.map((a) => (
                        <span key={a.id} className="attach-chip" style={{ paddingInlineEnd: 10 }}>
                          {a.image ? <img className="product-img" src={a.image} alt="" referrerPolicy="no-referrer" /> : null}
                          <span>{shortTitle(a.title, 32)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {m.text}
                </div>
              ) : (
                <AssistantView key={m.id} msg={m} isLast={i === messages.length - 1}
                  onRetry={() => {
                    const prev = messages[i - 1];
                    if (prev?.role === "user") send(prev.text, prev.attachments);
                  }} />
              ),
            )}
          </div>
        </main>
        <div className="composer-dock">
          <div>
            <Composer variant="chat" onSend={(t, a) => send(t, a)} onStop={stop} busy={busy} placeholder="سؤال بعدی‌ت رو بنویس" />
            <div className="composer-note">قیمت‌ها از فروشگاه‌های ترب خوانده می‌شه و ممکنه تغییر کرده باشه.</div>
          </div>
        </div>
      </ChatContext.Provider>
    </AppShell>
  );
}

function AssistantView({ msg, isLast, onRetry }: { msg: Assistant; isLast: boolean; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const working = !msg.done && msg.parts.length === 0;
  const text = msg.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n");
  const lastText = [...msg.parts].reverse().findIndex((p) => p.type === "text");
  const lastTextIdx = lastText < 0 ? -1 : msg.parts.length - 1 - lastText;

  return (
    <div className="answer" aria-live={isLast ? "polite" : undefined}>
      <SearchProgress status={msg.status} sources={msg.sources} working={working} />
      {msg.parts.map((p, i) =>
        p.type === "text" ? (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <RichText text={p.text} streaming={!msg.done && i === lastTextIdx && i === msg.parts.length - 1} />
          </div>
        ) : (
          <BlockView key={i} block={p.block} last={isLast} />
        ),
      )}
      {msg.error ? (
        <div className="answer-error" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>{msg.error}</span>
          {isLast ? <button className="btn btn-secondary btn-sm" onClick={onRetry}>دوباره بفرست</button> : null}
        </div>
      ) : null}
      {msg.done && text ? (
        <div className="answer-foot">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ClockIcon className="icon-sm" />قیمت‌ها از داده‌ی فروشگاه‌های ترب؛ تاریخ هر قیمت کنار فروشنده‌ست</span>
          {text ? (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              navigator.clipboard?.writeText(text.replace(/\*\*/g, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
            }}>
              <CopyIcon className="icon-sm" />{copied ? "کپی شد" : "کپی"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
