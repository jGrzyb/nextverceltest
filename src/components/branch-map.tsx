"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { directionsUrl, formatDistance } from "@/lib/format";
import type { OpenStatus } from "@/lib/opening-hours";

export interface MapBranch {
  number: number;
  lat: number;
  lon: number;
  distanceKm: number | null;
  /** Titles on the shelf there (empty = only borrowed copies). */
  availableTitles: string[];
  status: OpenStatus | null;
}

interface Props {
  origin: { lat: number; lon: number; label: string } | null;
  branches: MapBranch[];
  /** Branch to centre on and open (e.g. clicked in the list). */
  focus: { branch: number } | null;
}

const KRAKOW_CENTRE: [number, number] = [50.0617, 19.9373];

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function popupHtml(branch: MapBranch, origin: Props["origin"]): string {
  const distance = formatDistance(branch.distanceKm);
  const titles = branch.availableTitles;
  const shown = titles.slice(0, 3).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const more = titles.length > 3 ? `<li class="more">i ${titles.length - 3} więcej</li>` : "";
  const status = branch.status
    ? `<p class="status ${branch.status.open ? "open" : "closed"}">${escapeHtml(
        branch.status.label
      )}</p>`
    : "";
  return `
    <div class="branch-popup">
      <p class="name">Filia nr ${branch.number}${distance ? ` · <span>${distance}</span>` : ""}</p>
      ${status}
      ${
        titles.length
          ? `<p class="label">Na półce:</p><ul>${shown}${more}</ul>`
          : `<p class="label">Wszystkie egzemplarze wypożyczone</p>`
      }
      <a href="${escapeHtml(
        directionsUrl(origin, { lat: branch.lat, lon: branch.lon })
      )}" target="_blank" rel="noreferrer">Wyznacz trasę →</a>
    </div>`;
}

function branchIcon(L: typeof Leaflet, branch: MapBranch) {
  const available = branch.availableTitles.length > 0;
  const open = branch.status?.open ?? false;
  return L.divIcon({
    className: "",
    html: `<span class="branch-pin ${available ? "available" : "borrowed"} ${
      open ? "open" : ""
    }">${branch.number}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

interface MapState {
  L: typeof Leaflet;
  map: Leaflet.Map;
  layer: Leaflet.LayerGroup;
  markers: Map<number, Leaflet.Marker>;
  /** What the view was last fitted to; refit only when it changes. */
  framed: string;
}

function drawMap(
  s: MapState | null,
  origin: Props["origin"],
  branches: MapBranch[]
) {
  if (!s) return;
  const { L, map, layer, markers } = s;
  layer.clearLayers();
  markers.clear();

  // Borrowed first so the available pins sit on top.
  const ordered = [...branches].sort(
    (a, b) => a.availableTitles.length - b.availableTitles.length
  );
  for (const branch of ordered) {
    const marker = L.marker([branch.lat, branch.lon], {
      icon: branchIcon(L, branch),
      title: `Filia nr ${branch.number}`,
      riseOnHover: true,
    }).bindPopup(popupHtml(branch, origin), { maxWidth: 260 });
    marker.addTo(layer);
    markers.set(branch.number, marker);
  }

  if (origin) {
    L.marker([origin.lat, origin.lon], {
      icon: L.divIcon({
        className: "",
        html: '<span class="origin-pin"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      title: origin.label,
      zIndexOffset: 1000,
    })
      .bindTooltip(escapeHtml(origin.label))
      .addTo(layer);
  }

  // Frame the user and the nearest branches with the book on the shelf
  // (or all branches when every copy is borrowed). The pins are redrawn
  // every minute ("open now"), so don't undo the user's panning then.
  const framed = JSON.stringify([origin, branches.map((b) => b.number)]);
  if (framed === s.framed) return;
  s.framed = framed;
  const available = branches.filter((b) => b.availableTitles.length > 0);
  const frame = (available.length ? available : branches)
    .slice()
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    .slice(0, 5)
    .map((b) => L.latLng(b.lat, b.lon));
  if (origin) frame.push(L.latLng(origin.lat, origin.lon));
  if (frame.length > 1) {
    map.fitBounds(L.latLngBounds(frame), { padding: [36, 36], maxZoom: 15 });
  } else if (frame.length === 1) {
    map.setView(frame[0], 14);
  }
}

/**
 * Leaflet + OpenStreetMap map of the branches that have the searched book:
 * green = on the shelf, grey = borrowed, ring = open now.
 * Leaflet touches `window`, so it is loaded on the client only.
 */
export default function BranchMap({ origin, branches, focus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const latest = useRef({ origin, branches });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let created: Leaflet.Map | null = null;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const map = L.map(container.current, {
        center: KRAKOW_CENTRE,
        zoom: 12,
        scrollWheelZoom: false,
        attributionControl: false,
      });
      // Leaflet's default attribution prefix carries a flag; keep just the
      // credits (Leaflet + the OpenStreetMap licence requirement).
      L.control
        .attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>' })
        .addTo(map);
      created = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      state.current = { L, map, layer: L.layerGroup().addTo(map), markers: new Map(), framed: "" };
      drawMap(state.current, latest.current.origin, latest.current.branches);
    });
    return () => {
      cancelled = true;
      created?.remove();
      state.current = null;
    };
  }, []);

  // Redraw markers when the results change.
  useEffect(() => {
    latest.current = { origin, branches };
    drawMap(state.current, origin, branches);
  }, [origin, branches]);

  // Fly to a branch picked in the list.
  useEffect(() => {
    const s = state.current;
    if (!s || focus == null) return;
    const marker = s.markers.get(focus.branch);
    if (!marker) return;
    // Open the popup after the flight so it can pan itself into view.
    s.map.once("moveend", () => marker.openPopup());
    s.map.flyTo(marker.getLatLng(), Math.max(s.map.getZoom(), 14), { duration: 0.6 });
  }, [focus]);

  return (
    <div
      ref={container}
      className="branch-map h-72 w-full overflow-hidden rounded-xl border sm:h-80"
      role="region"
      aria-label="Mapa filii z wynikami"
    />
  );
}
