"use client";

import { useEffect, useMemo, useState } from "react";
import { getAreas } from "@/lib/api";
import { faDigits } from "@/lib/format";
import { getSavedLocation, saveLocation } from "@/lib/store";
import type { Area, Block, UserLocation } from "@/lib/types";
import { PinIcon, SearchIcon, TargetIcon } from "../icons";
import { useChat } from "./ChatContext";

/** تربچه needs to know where you are before answering (nearest shop, in person): GPS or a Tehran neighborhood.
    Choosing one saves it and sends the question on, so the answer uses it. */
export default function LocationRequest({ block, active }: { block: Extract<Block, { kind: "location_request" }>; active: boolean }) {
  const { send, busy } = useChat();
  const [areas, setAreas] = useState<Area[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"ask" | "locating" | "areas" | "done">("ask");
  const [message, setMessage] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (!active) setState("done");
  }, [active]);

  function choose(l: UserLocation) {
    saveLocation(l);
    setChosen(l.label);
    setState("done");
    send(`موقعیتم: ${l.label}`);
  }

  function useGps() {
    if (!("geolocation" in navigator)) {
      setMessage("مرورگرت موقعیت رو پشتیبانی نمی‌کنه؛ محله‌ت رو انتخاب کن.");
      openAreas();
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "موقعیت فعلی تو" }),
      () => {
        setMessage("اجازه‌ی موقعیت داده نشد؛ محله‌ت رو انتخاب کن.");
        openAreas();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  function openAreas() {
    setState("areas");
    if (!areas.length) getAreas().then((r) => setAreas(r.areas)).catch(() => setMessage("فهرست محله‌ها رو نتونستم بیارم."));
  }

  const list = useMemo(() => areas.filter((a) => !query || a.name.includes(query.trim())), [areas, query]);
  const saved = getSavedLocation();

  if (state === "done") {
    return (
      <div className="loc-req is-done">
        <PinIcon className="icon-sm" />
        <span>{chosen ? `موقعیت: ${chosen}` : block.reason}</span>
      </div>
    );
  }

  return (
    <section className="loc-req" aria-label="درخواست موقعیت">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span className="loc-icon"><PinIcon /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <b style={{ fontSize: 15, lineHeight: "24px" }}>{block.reason}</b>
          <span className="row-sub">موقعیتت فقط برای همین جست‌وجو استفاده می‌شه.</span>
        </div>
      </div>
      {message ? <div className="answer-error">{message}</div> : null}
      {state === "areas" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="picker-search">
            <SearchIcon className="muted" />
            <span className="sr-only">جست‌وجوی محله</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی محله در تهران" autoFocus />
          </label>
          <div className="chips">
            {list.map((a) => (
              <button key={a.name} className="chip" disabled={busy} onClick={() => choose({ area: a.name, label: `${a.name}، تهران` })}>
                {a.name} <span className="row-sub">· {faDigits(a.shops)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="loc-req-acts">
          <button className="btn btn-primary" disabled={busy || state === "locating"} onClick={useGps}>
            <TargetIcon className="icon-sm" />
            {state === "locating" ? "در حال گرفتن موقعیت…" : "موقعیتم رو بفرست"}
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={openAreas}>محله‌م رو انتخاب می‌کنم</button>
          {saved ? <button className="btn btn-ghost" disabled={busy} onClick={() => choose(saved)}>همون قبلی: {saved.label}</button> : null}
        </div>
      )}
    </section>
  );
}
