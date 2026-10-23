"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Offer } from "@/lib/types";

type Props = {
  stores: Offer[];
  selectedId: string | null;
  pickId?: string | null;
  me: { lat: number; lng: number } | null;
  center: { lat: number; lng: number } | null;
  onSelect: (offerId: string) => void;
};

// OpenStreetMap tiles (Persian street names in Tehran). globals.css softens them, and darkens them in dark mode.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const STORE_GLYPH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16M9 20v-5h6v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pinHtml(o: Offer, active: boolean, picked: boolean) {
  const open = o.shop.hours.open_now;
  const status = open == null ? "" : `<span class="pin2-status ${open ? "is-open" : "is-closed"}"></span>`;
  const label = active ? `<span class="pin2-label">${picked ? '<i class="pin2-star">پیشنهاد ترب</i>' : ""}${escapeHtml(o.shop.name)}</span>` : "";
  return `<div class="pin2${active ? " is-active" : ""}${picked ? " is-pick" : ""}">
    <svg class="pin2-shape" viewBox="0 0 36 46" aria-hidden="true"><path d="M18 45C18 45 34 29.6 34 17.5A16 16 0 0 0 2 17.5C2 29.6 18 45 18 45z"/></svg>
    <span class="pin2-glyph">${STORE_GLYPH}</span>${status}${label}
  </div>`;
}

/** Store map: price-free teardrop pins (selected one is larger, red, and named), the user's spot as a blue dot. */
export default function LeafletMap({ stores, selectedId, pickId = null, me, center, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || mapRef.current) return;
      const map = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
      L.control.zoom({ position: "topleft", zoomInTitle: "بزرگ‌نمایی", zoomOutTitle: "کوچک‌نمایی" }).addTo(map);
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

      map.setView([center?.lat ?? 35.6892, center?.lng ?? 51.389], 14);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      draw(L);
      // The map often mounts inside a sheet that is still sizing: re-measure whenever the box changes.
      resize = new ResizeObserver(() => map.invalidateSize());
      resize.observe(el.current);
      setTimeout(() => map.invalidateSize(), 150);
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      fitted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      draw(L);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, selectedId, pickId, me]);

  function draw(L: typeof import("leaflet")) {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points: [number, number][] = [];
    if (me) {
      L.marker([me.lat, me.lng], {
        icon: L.divIcon({ className: "me-marker", html: '<span class="me-halo"></span><span class="me-core"></span>', iconSize: [44, 44], iconAnchor: [22, 22] }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 500,
      }).addTo(layer);
      points.push([me.lat, me.lng]);
    }
    for (const o of stores) {
      if (o.shop.lat == null || o.shop.lng == null) continue;
      const active = o.offer_id === selectedId;
      const m = L.marker([o.shop.lat, o.shop.lng], {
        icon: L.divIcon({
          className: "pin2-wrap",
          html: pinHtml(o, active, o.offer_id === pickId),
          iconSize: active ? [44, 56] : [34, 44],
          iconAnchor: active ? [22, 56] : [17, 44],
        }),
        title: o.shop.name,
        alt: o.shop.name,
        riseOnHover: true,
        zIndexOffset: active ? 1000 : 0,
      });
      m.on("click", () => onSelect(o.offer_id));
      m.addTo(layer);
      points.push([o.shop.lat, o.shop.lng]);
    }
    if (!fitted.current && points.length) {
      fitted.current = true;
      if (points.length === 1) map.setView(points[0], 16);
      else map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 16 });
    } else if (selectedId) {
      const s = stores.find((x) => x.offer_id === selectedId);
      if (s?.shop.lat != null && s.shop.lng != null) map.panTo([s.shop.lat, s.shop.lng], { animate: true });
    }
  }

  return <div ref={el} style={{ width: "100%", height: "100%" }} />;
}
