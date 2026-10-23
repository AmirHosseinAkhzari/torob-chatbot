"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const PIN = '<div class="pin2 is-active is-pick"><svg class="pin2-shape" viewBox="0 0 36 46" aria-hidden="true"><path d="M18 45C18 45 34 29.6 34 17.5A16 16 0 0 0 2 17.5C2 29.6 18 45 18 45z"/></svg></div>';

/** Tap the map to put the shop's pin there (or drag it). */
export default function PinMap({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || mapRef.current) return;
      const map = L.map(el.current, { zoomControl: true, scrollWheelZoom: false });
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      map.setView([lat ?? 35.6892, lng ?? 51.389], lat != null ? 16 : 13);
      const icon = L.divIcon({ html: PIN, className: "pin2-wrap", iconSize: [36, 46], iconAnchor: [18, 45] });
      const place = (la: number, ln: number) => {
        if (!markerRef.current) {
          markerRef.current = L.marker([la, ln], { icon, draggable: true, keyboard: false }).addTo(map);
          markerRef.current.on("dragend", () => { const p = markerRef.current!.getLatLng(); pick.current(p.lat, p.lng); });
        } else markerRef.current.setLatLng([la, ln]);
      };
      if (lat != null && lng != null) place(lat, lng);
      map.on("click", (e) => { place(e.latlng.lat, e.latlng.lng); pick.current(e.latlng.lat, e.latlng.lng); });
      mapRef.current = map;
      new ResizeObserver(() => map.invalidateSize()).observe(el.current);
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typed coordinates move the pin too.
  useEffect(() => {
    if (lat == null || lng == null || !mapRef.current) return;
    const m = markerRef.current;
    if (m && (Math.abs(m.getLatLng().lat - lat) > 1e-7 || Math.abs(m.getLatLng().lng - lng) > 1e-7)) m.setLatLng([lat, lng]);
  }, [lat, lng]);

  return <div ref={el} className="map" role="application" aria-label="نقشه: برای گذاشتن نشانی فروشگاه روی نقشه بزن" style={{ height: 300 }} />;
}
