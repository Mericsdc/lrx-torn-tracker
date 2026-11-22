/* Holdings day records: one compact per-item record per Torn day, so the Holdings card can split a value change into
   Torn's price moves and the player's buying / selling (Finance › Networth › Holdings › Change, public/finance.js).
   Pure: src/server/server.js reads and writes data/holdings-days.json and passes the file object in.
   File: { v: 1, ownerId, names: { id: [name, type] }, days: { 'YYYY-MM-DD': { at, nw?, places: { place: { id: [qty, unit] } } } } }
   Spec: docs/superpowers/specs/2026-11-22-holdings-price-split-design.md */
'use strict';

const FM = require('../../public/finance-math');

const KEEP_DAYS = 366; // 1Y always has its start record
const PERIODS = Object.freeze([1, 7, 30, 90, 365]); // the Networth tab's period bar
const DAY = 86400_000;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const empty = (ownerId) => ({ v: 1, ownerId, names: {}, days: {} });
// The file only counts for the player it was written for; a broken or foreign file is an empty one.
function forOwner(file, ownerId) {
  return isObj(file) && file.v === 1 && file.ownerId === ownerId && isObj(file.days) && isObj(file.names) ? file : empty(ownerId);
}

// A loadHoldings() reply as a record: only places that loaded in full (a partial list would read as items sold).
function snapshot(h) {
  const places = {}, names = {};
  for (const [k, p] of Object.entries(h?.places || {})) {
    if (!p?.ok || p.partial) continue;
    const rows = {};
    for (const r of p.rows || []) {
      const qty = num(r?.qty);
      if (!(qty > 0)) continue;
      rows[r.id] = [qty, Math.round((num(r.value) / qty) * 100) / 100];
      names[r.id] = [String(r.name ?? ''), String(r.type ?? '')];
    }
    places[k] = rows;
  }
  return { at: h?.at, places, names };
}

// The file with snap merged into that day: loaded places replace theirs, the rest keep the day's earlier list.
// nw is the networth of this moment; an older one is dropped (it would not match the updated places).
function record(file, day, snap, { nw } = {}) {
  if (!Object.keys(snap?.places || {}).length) return file;
  const old = file.days[day];
  const days = { ...file.days, [day]: { at: snap.at, ...(Number.isFinite(nw) ? { nw } : {}), places: { ...old?.places, ...snap.places } } };
  const from = isoDay(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * DAY);
  for (const d of Object.keys(days)) if (d < from) delete days[d];
  const all = { ...file.names, ...snap.names }, names = {};
  for (const rec of Object.values(days)) for (const rows of Object.values(rec.places || {})) for (const id of Object.keys(rows)) if (all[id]) names[id] = all[id];
  return { ...file, days, names };
}

// The start record each period uses (the networth rule, FM.periodStart), oldest first, never today's own record,
// plus the names of every id in them (a sold-out item is no longer in the current reply).
function starts(file, today, periods = PERIODS) {
  const hist = Object.keys(file.days).filter((d) => d < today).sort().map((date) => ({ date, ...file.days[date] }));
  const picked = new Map();
  for (const p of periods) {
    const s = FM.periodStart([...hist, { date: today }], p);
    if (s) picked.set(s.date, s);
  }
  const list = [...picked.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const names = {};
  for (const s of list) for (const rows of Object.values(s.places || {})) for (const id of Object.keys(rows)) if (file.names[id]) names[id] = file.names[id];
  return { today, starts: list, names };
}

module.exports = { empty, forOwner, snapshot, record, starts, KEEP_DAYS, PERIODS };
