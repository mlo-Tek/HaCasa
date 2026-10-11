// Setup assistant: eight stations (Start, Home page, Rooms, Energy, Cameras, Devices per room, Status, Done).
// Every station has a live preview on the right that renders the REAL panel (cards, nav, popups) from the draft, so what you see is what you get.
// The draft `d` is only written once, by wizardPatch(), into the user settings; the one thing written into Home Assistant itself is the room
// of devices that had none (device/entity registry), and only when the person confirms it.
import { t, LANGUAGES } from "./i18n.js";
import { html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { domain, num } from "./util.js";
import { buildRooms, buildHome, deviceName, isGroup, entitiesByArea, name } from "./model.js";
import { mergeConfig } from "./settings.js";
import { homeCards, SUM_KINDS, sumData } from "./cards.js";
import { renderPopup } from "./popups.js";
import { suggestAreas, applyAreas, energyRoles, energyCandidates, detectEnergy, camDetections } from "./wiz-ha.js";
import "./fit.js";

/** what the ticker line under the greeting can show (home page and rooms) */
export const TICKER_KINDS = { home: { update: t("HaCasa-updates"), energy: t("Energie"), waste: t("Afval"), agenda: t("Agenda"), notifications: t("Meldingen"), attention: t("Aandacht"), doors: t("Open deuren"), weather: t("Weer"), modes: t("Modi"), appliances: t("Huishoudapparaten") }, room: { lights: t("Lampen"), doors: t("Open deuren/ramen"), media: t("Media"), battery: t("Batterij laag"), appliances: t("Huishoudapparaten"), lux: t("Helderheid") } };
const PILLS = ["lights", "doors", "attention"];
const MAX_CHIPS = 3;

/** the key of a card, as the group it is listed under (page popup) */
export function groupOf(key) {
  const d = key.startsWith("device:") ? "device" : key.split(".")[0];
  return d === "light" ? "lights" : d === "climate" ? "climate" : d === "media_player" ? "media" : d === "cover" ? "covers"
    : ["switch", "fan", "humidifier", "vacuum", "input_boolean", "device"].includes(d) ? "switches" : d === "binary_sensor" ? "sensors" : "other";
}
/** name of a card as Home Assistant shows it ("Woonkamer - Apple TV") plus the entity id underneath, for the card pickers */
export function cardTitle(p, c, r) {
  const st = p.hass.states[c.key], dev = c.key.startsWith("device:") ? c.key.slice(7) : null, ap = r?.ents.appliances.find(a => a.id === c.key);
  return { title: p.config.cards?.[c.key]?.name || st?.attributes.friendly_name || (dev ? deviceName(p.hass, dev) : c.label), sub: st ? c.key : ap ? ap.key : "" };
}

/* ============================== draft: defaults and patch ============================== */

const members = (hass, id) => hass.states[id]?.attributes?.entity_id || [];

/** every device of a room, by kind, as the chips of station 6 list them; a group whose members are all listed too starts switched off */
export function roomCats(p, r) {
  const e = r.ents, mk = (list, lbl) => list.map(x => ({ key: x.id, title: lbl ? lbl(x) : cardTitle(p, { key: x.id, label: "" }, r).title, group: !x.id.startsWith("device:") && isGroup(x), sub: x.state?.attributes?.friendly_name ? "" : "" }));
  const dn = x => p.config.cards?.[x.id]?.name || deviceName(p.hass, x.device);
  const cats = [
    { k: "lights", title: t("Lampen"), items: mk(e.lights) },
    { k: "motion", title: t("Bewegingsmelders"), items: mk(e.motion) },
    { k: "openings", title: t("Ramen en deuren"), items: mk([...e.doors, ...e.windows]) },
    { k: "climate", title: t("Klimaat"), items: mk(e.climate) },
    { k: "media", title: t("Media"), items: mk(e.media) },
    { k: "plugs", title: t("Stopcontacten"), items: [...mk(e.switches), ...mk([...e.strips, ...e.appliances], dn)] },
    { k: "covers", title: t("Rolluiken"), items: mk(e.covers) },
    { k: "more", title: t("Overig"), items: mk([...e.fans, ...e.locks, ...e.vacuums, ...e.humidifiers, ...e.cameras, ...e.other]) },
  ];
  const all = new Set(cats.flatMap(c => c.items.map(i => i.key)));
  for (const c of cats) for (const i of c.items) i.dup = i.group && members(p.hass, i.key).length > 0 && members(p.hass, i.key).every(m => all.has(m));
  return cats.filter(c => c.items.length);
}
/** the sensor a room should show for temperature / humidity / brightness: the one that is not part of a motion sensor, else the first */
const bestSource = (p, list) => (list.find(e => !e.reg.device_id || !Object.values(p.hass.entities).some(x => x.device_id === e.reg.device_id && x.entity_id !== e.id && p.hass.states[x.entity_id]?.attributes?.device_class === "motion")) || list[0])?.id;
export const SRC = [["temp", "temp"], ["hum", "hum"], ["lux", "lux"]];

/** a room's starting choice: every device that exists (groups that only repeat their members stay off) and the best source for temperature, humidity, brightness */
export function roomDefault(p, r, pg = {}, cur = false) {
  const cats = roomCats(p, r), keep = cur && pg.shown?.length ? pg.shown : null, sources = { ...(pg.sources || {}) };
  for (const [k, lst] of [["temp", r.ents.temp], ["hum", r.ents.hum], ["lux", r.ents.lux]]) if (!sources[k] && lst.length) sources[k] = bestSource(p, lst);
  return { shown: keep ? [...keep] : cats.flatMap(c => c.items.filter(i => !i.dup).map(i => i.key)), sources };
}

/** what the panel already knows: the starting point of the assistant. Everything that exists is switched on, except groups that only repeat their members. */
export function wizardDefaults(p) {
  const h = p.config.home || {}, cur = !!p.config.curated, pg = p.config.pages || {}, hass = p.hass;
  const cams = Object.values(hass.states).filter(s => domain(s.entity_id) === "camera" && !hass.entities?.[s.entity_id]?.hidden);
  const d = { language: p.config.language, title: p.userConfig?.title, mode: cur ? "curated" : undefined, rooms: p.rooms.map(r => r.id), roomNames: {}, roomImages: {}, roomImage: p.userConfig?.roomImage, homeImage: p.userConfig?.homeImage,
    home: { weather: p.home?.weather?.entity_id, climate: p.home?.climate?.entity_id, alarm: p.home?.alarm?.entity_id, energy: detectEnergy(hass, h.energy), scenes: h.scenes || null },
    pills: cur ? (h.pills || PILLS) : PILLS, people: !cur || h.people !== false,
    tickerHome: Object.keys(TICKER_KINDS.home).filter(k => !cur || pg.home?.ticker?.[k] !== false), tickerRoom: Object.keys(TICKER_KINDS.room).filter(k => !cur || pg[p.rooms[0]?.id]?.ticker?.[k] !== false),
    banner: cur ? (h.bannerSensors || p.rooms.flatMap(r => r.ents.motion.map(e => e.id))) : p.rooms.flatMap(r => r.ents.motion.map(e => e.id)),
    cams: (h.cams || cams.map(s => ({ camera: s.entity_id, carousel: true, popup: camDetections(hass, s.entity_id).filter(x => x.kind !== "animal").map(x => x.id) }))).map(c => ({ ...c })),
    quick: (h.quick || []).map(q => ({ ...q })), never: [...(p.config.neverShow || [])], order: { home: pg.home?.order }, sources: {}, shown: {} };
  // station 2: the four summary tiles, the cameras, and what else exists
  const hm = p.home, has = [];
  for (const k of SUM_KINDS) if (sumData(p, hm, k).all.length) has.push("sum:" + k);
  if (cams.length) has.push("cams");
  if (hm.calendars.length) has.push("agenda");
  if (hm.waste.length) has.push("waste");
  if (hm.energy.power || d.home.energy.power) has.push("energy");
  if (d.home.energy.pv) has.push("pv");
  d.shown.home = cur && pg.home?.shown?.length ? [...pg.home.shown] : has;
  // station 6: per room everything that exists (Empfehlung), or what was chosen before
  for (const r of p.rooms) { const rd = roomDefault(p, r, pg[r.id], cur); d.shown[r.id] = rd.shown; d.sources[r.id] = rd.sources; }
  return d;
}

/** the settings the assistant writes (merged into the user settings by the panel) */
export function wizardPatch(p, d) {
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const ud = p.userConfig || {}, areaOk = id => !!p.hass.areas?.[id];
  const ids = (d.rooms || []).filter(areaOk);
  const rooms = ids.map(id => d.roomNames?.[id] || d.roomImages?.[id] ? clean({ area: id, name: d.roomNames?.[id], image: d.roomImages?.[id] }) : id);
  const en = clean(d.home.energy || {});
  const patch = { ...clean({ language: d.language, title: d.title, roomImage: d.roomImage, homeImage: d.homeImage }), rooms: rooms.length ? rooms : undefined,
    home: { ...(ud.home || {}), ...clean({ weather: d.home.weather, climate: d.home.climate, alarm: d.home.alarm }), energy: { ...(ud.home?.energy || {}), ...en } }, setupDone: true };
  if (!d.mode) return patch;
  patch.curated = d.mode === "auto" ? undefined : true;
  if (d.mode === "auto") return patch;
  const later = d.mode === "later", pages = { ...(ud.pages || {}) };
  const offTicker = (kinds, on) => { const off = Object.keys(kinds).filter(k => !on.includes(k)); return off.length ? Object.fromEntries(off.map(k => [k, false])) : undefined; };
  const cfgOf = (key, shown, tickerKinds, tickerOn, seen, extra = {}) => {
    const pg = { ...(pages[key] || {}) };
    if (shown?.length) pg.shown = shown; else delete pg.shown;
    const tk = offTicker(tickerKinds, tickerOn); if (tk) pg.ticker = tk; else delete pg.ticker;
    if (seen) pg.seen = seen;
    for (const [k, v] of Object.entries(extra)) { if (v && (!Array.isArray(v) || v.length) && (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length)) pg[k] = v; else delete pg[k]; }
    if (Object.keys(pg).length) pages[key] = pg; else delete pages[key];
  };
  cfgOf("home", later ? [] : d.shown?.home, TICKER_KINDS.home, later ? [] : d.tickerHome, undefined, { order: d.order?.home });
  const rb = buildRooms(p.hass, { ...p.config, rooms: ids });
  for (const id of ids) { const r = rb.find(x => x.id === id);
    const rd = r && (d.shown?.[id] === undefined || d.sources?.[id] === undefined) ? roomDefault(p, r) : null;
    cfgOf(id, later ? [] : d.shown?.[id] ?? rd?.shown, TICKER_KINDS.room, later ? [] : d.tickerRoom, r ? p.roomCardKeys(r) : undefined, { sources: later ? undefined : clean(d.sources?.[id] ?? rd?.sources ?? {}), order: d.order?.[id] }); }
  patch.pages = pages;
  const hm = patch.home;
  hm.pills = later ? [] : d.pills; hm.people = later || !d.people ? false : undefined;
  hm.bannerSensors = later ? [] : d.banner;
  if (!later) {
    hm.cams = d.cams?.length ? d.cams : undefined;
    hm.quick = d.quick?.length ? d.quick : undefined; hm.scenes = d.home.scenes || undefined;
  }
  patch.neverShow = d.never?.length ? d.never : undefined;
  return patch;
}

/* ============================== live preview ============================== */

const own = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
/** a stand-in for the panel that renders with the draft settings; clicks do nothing (the preview ignores the pointer) */
export function previewOf(p, d) {
  const cfg = mergeConfig(p.config, wizardPatch(p, { ...d, mode: "curated" })), pv = Object.create(p), rooms = buildRooms(p.hass, cfg);
  own(pv, "config", cfg); own(pv, "rooms", rooms); own(pv, "home", buildHome(p.hass, cfg, rooms, p.notifications || []));
  own(pv, "popup", null); own(pv, "searchOpen", false); own(pv, "drawer", false);
  own(pv, "requestUpdate", () => {});      // pv is not an element: a property set while rendering must never schedule a render of its own
  for (const m of ["openPopup", "call", "go", "moreInfo", "goPath", "wake", "loadHourly", "loadCamEvents", "saveUser"]) own(pv, m, () => {});
  for (const m of ["bgOk", "bgUrl", "bgStyle"]) own(pv, m, (...a) => p[m](...a));
  return pv;
}
const mobile = () => matchMedia("(max-width:900px)").matches;
const VIRT = () => mobile() ? { w: 390, h: 800 } : { w: 1440, h: 860 };
/** the home page (or a room) as the real panel draws it; `ring` = keys of strip cards to circle, `css` = extra rules for the ring */
function stage(pv, { room = null, ring = [], css = "", nav = true, h: hh } = {}) {
  const v = VIRT(), bg = pv.bgUrl(room), u = mobile() ? "" : "--u:1px;--pad:115px;";
  let n = 0;
  if (ring.length && !room) { const keys = pv.applyPage("home", homeCards(pv, pv.home)).map(c => c.key); n = keys.findIndex(k => ring.includes(k)) + 1; }
  return html`<hcn-fit .w=${v.w} .h=${hh || v.h}><div class="wzstage" style="width:${v.w}px;height:${hh || v.h}px;${u}">
    <style>.wzstage .strip>:nth-child(${n || 999}){outline:3px solid #f2b63a;outline-offset:2px} ${css}</style>
    <div class=${classMap({ bg: true, grad: !pv.bgOk(bg) })} style=${pv.bgStyle(bg, room?.slug)}></div>
    ${nav ? pv.renderNav(room, false, null) : nothing}
    ${room ? pv.renderRoom(room) : pv.renderHome(pv.home)}</div></hcn-fit>`;
}
const rt = (a, b) => html`<div class="wzrt"><span>${a}</span>${b ? html`<span class="wztag">${b}</span>` : nothing}</div>`;
/** a real popup of the panel, inside the preview column (no clicks, no close button reaches the assistant) */
const popBox = (pv, pop) => html`<div class="wzpop">${renderPopup(pv, pop)}</div>`;

/* ============================== small building blocks ============================== */

const toggle = (list, k) => list.includes(k) ? list.filter(x => x !== k) : [...list, k];
const chip = (label, on, click, { mark = false, title = "" } = {}) => html`<button class=${classMap({ on, off: !on })} title=${title} @click=${click}>${mark ? (on ? "● " : "○ ") : ""}${label}</button>`;
const capchips = (label, chips) => html`<div class="wzcap"><span>${label}</span><div class="chips">${chips}</div></div>`;
const box = (inner, { sel = false, off = false } = {}) => html`<div class=${classMap({ wzg: true, sel, off })}>${inner}</div>`;
const rowi = ({ icon, title, sub = "", state = "", on = false, click = null }) => html`<li class=${classMap({ on, tap: !!click })} @click=${click || nothing}><ha-icon icon=${icon}></ha-icon><div>${title}${sub ? html`<small>${sub}</small>` : nothing}</div><span class="st">${state}</span></li>`;
const some = (list, fmt, n = MAX_CHIPS) => [...list.slice(0, n).map(fmt), ...(list.length > n ? [html`<span class="wzmore">${t("+ {n} meer", { n: list.length - n })}</span>`] : [])];
const note = txt => html`<div class="wznote">${txt}</div>`;

/** list that can be re-ordered by dragging and by the arrow buttons: items = [{ id, body }], onMove(newIdOrder) */
const dragState = { id: null };
function sortable(items, onMove, { cls = "", extra = () => nothing } = {}) {
  const ids = items.map(i => i.id), mv = (from, to) => { if (to < 0 || to >= ids.length || from === to) return; const l = [...ids]; l.splice(to, 0, l.splice(from, 1)[0]); onMove(l); };
  return html`<ul class=${"wzsort " + cls}>${items.map((it, i) => html`<li class=${classMap({ on: it.on !== false })} draggable="true"
      @dragstart=${e => { dragState.id = it.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); e.currentTarget.classList.add("drag"); }}
      @dragend=${e => { dragState.id = null; e.currentTarget.classList.remove("drag"); }}
      @dragover=${e => { if (dragState.id == null) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.classList.toggle("ins-top", e.clientY < r.top + r.height / 2); e.currentTarget.classList.toggle("ins-bot", e.clientY >= r.top + r.height / 2); }}
      @dragleave=${e => e.currentTarget.classList.remove("ins-top", "ins-bot")}
      @drop=${e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(), after = e.clientY >= r.top + r.height / 2, from = ids.indexOf(dragState.id); e.currentTarget.classList.remove("ins-top", "ins-bot"); if (from < 0) return; let to = i + (after ? 1 : 0); if (from < to) to--; mv(from, to); }}>
      <span class="wzgrip" title=${t("Slepen")}></span><div>${it.body}</div>
      <span class="wzbtns">${extra(it)}<button class="wzarr" title=${t("Omhoog")} ?disabled=${i === 0} @click=${() => mv(i, i - 1)}><ha-icon icon="mdi:chevron-up"></ha-icon></button><button class="wzarr" title=${t("Omlaag")} ?disabled=${i === items.length - 1} @click=${() => mv(i, i + 1)}><ha-icon icon="mdi:chevron-down"></ha-icon></button></span></li>`)}</ul>`;
}

/* ============================== the stations ============================== */

export function renderWizard(p, pop) {
  const hass = p.hass, d = pop.draft || wizardDefaults(p), step = pop.step || 0, mode = d.mode;
  const upd = (patch, extra = {}) => p.openPopup({ ...pop, ...extra, draft: { ...d, ...patch } });
  const upShown = (key, list) => upd({ shown: { ...d.shown, [key]: list } });
  const focus = (k, extra = {}) => p.openPopup({ ...pop, draft: d, focus: k, ...extra });
  const goStep = s => p.openPopup({ ...pop, draft: d, step: s, focus: null });
  const pv = previewOf(p, d), hm = pv.home;
  const areaName = id => hass.areas?.[id]?.name || d.roomNames?.[id] || id;
  const stations = [];

  /* ---- 1 · Start ---- */
  stations.push({ title: t("Welkom"), sub: t("Alles is later aan te passen in de paneelinstellingen."), icon: "mdi:home-outline", tag: t("Taal, titel, weg kiezen"),
    left: html`<div class="form"><label class="f"><span>${t("Taal")}</span><select @change=${e => upd({ language: e.target.value || undefined })}><option value="">${t("automatisch (zoals Home Assistant)")}</option>${Object.entries(LANGUAGES).map(([k, l]) => html`<option value=${k} ?selected=${d.language === k}>${l}</option>`)}</select></label>
        <label class="f"><span>${t("Titel")}<small>${t("linksboven in de navigatie")}</small></span><input type="text" .value=${d.title || ""} placeholder=${t("Thuis") + "."} @change=${e => upd({ title: e.target.value || undefined })}></label></div>
      <div class="wzh">${t("Hoe wil je instellen?")}</div>
      <ul class="wzl">${rowi({ icon: "mdi:robot-outline", title: t("Automatisch"), sub: t("Zoals voorheen: HaCasa toont alles wat het vindt en sorteert zelf in kamers."), on: mode === "auto", state: mode === "auto" ? t("Gekozen") : "", click: () => upd({ mode: "auto" }) })}
        ${rowi({ icon: "mdi:shape-outline", title: t("Zelf kiezen"), sub: t("Niets verschijnt vanzelf. Je kiest in 8 korte stations, elk met voorvertoning."), on: mode === "curated", state: mode === "curated" ? t("Gekozen") : "", click: () => upd({ mode: "curated" }) })}
        ${rowi({ icon: "mdi:clock-outline", title: t("Later"), sub: t("Alleen de kamers aanmaken. Alle pagina's blijven leeg tot je ze vult."), on: mode === "later", state: mode === "later" ? t("Gekozen") : "", click: () => upd({ mode: "later" }) })}</ul>
      ${note(t("Je huidige instellingen worden voor de start bewaard in Home Assistant. Instellingen gelden per gebruiker en de assistent start altijd opnieuw via Installatiehulp."))}`,
    right: html`${rt(t("De 8 stations"), t("ca. 10 minuten"))}<ul class="wzl wzsteps">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => html`<li class=${classMap({ tap: !!mode, on: false })} @click=${mode ? () => goStep(i) : nothing}><b>${i + 1}</b><div>${STEP_NAMES[i]()[0]}<small>${STEP_NAMES[i]()[1]}</small></div></li>`)}</ul>
      ${note(t("Vanaf station 2 zie je rechts altijd een voorvertoning, zoals het straks in HaCasa uitziet."))}` });

  /* ---- 2 · Home page ---- */
  { const f = pop.focus || "sum:lights", sh = d.shown.home || [], on = k => sh.includes(k), fLabel = homeCards(pv, hm).find(c => c.key === f)?.label || f;
    const sumRow = (k, desc, capLabel, names) => { const sd = sumData(p, hm, k); if (!sd.all.length) return nothing;
      return box(html`<ul class="wzl">${rowi({ icon: sd.icon[0], title: sd.title, sub: desc, on: on("sum:" + k), state: on("sum:" + k) ? t("Aan") : t("Uit"), click: () => focus("sum:" + k, { draft: { ...d, shown: { ...d.shown, home: toggle(sh, "sum:" + k) } } }) })}</ul>${capchips(capLabel, some(names, x => html`<span class="wzchip">${x}</span>`))}`, { sel: f === "sum:" + k, off: !on("sum:" + k) }); };
    const byRoom = list => { const m = new Map(); for (const e of list) { const k = e.room?.name || ""; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([n, c]) => `${n} ${c}`); };
    const more = [["climate", t("Thermostaat"), !!hm.climate], ["weather", t("Weer"), !!hm.weather], ["agenda", t("Agenda"), hm.calendars.length > 0], ["waste", t("Afval"), hm.waste.length > 0], ["energy", t("Energie"), !!(hm.energy.power)], ["pv", t("Zonne-energie"), !!hm.energy.pv], ["scenes", t("Scènes"), hm.scenes.length > 0], ["attention", t("Aandacht"), true], ["cams", t("Camera's"), hm.camCarousel.length > 0 || d.cams.length > 0]].filter(x => x[2]);
    const order = (sh || []).map(k => ({ id: k, body: pv.applyPage("home", homeCards(pv, hm)).find(c => c.key === k)?.label || k })).filter(x => pv.applyPage("home", homeCards(pv, hm)).some(c => c.key === x.id));
    stations.push({ title: t("Wat komt er op de startpagina?"), sub: t("Elk soort apparaat wordt één verzamelkaart. De voorvertoning rechts springt naar de gekozen regel."), icon: "mdi:shape-outline", tag: t("Kaarten met voorvertoning"),
      left: html`${sumRow("lights", t("Eén kaart („3 van 33”). Tikken opent de lijst om te schakelen."), t("Kamers"), byRoom(hm.lights))}
        ${sumRow("openings", t("Eén kaart („1 open”). Tikken toont elk raam en elke deur."), t("Kamers"), byRoom([...hm.doors, ...hm.windows]))}
        ${sumRow("climate", t("Eén kaart voor alle klimaatapparaten."), t("Apparaten"), hm.climates.map(e => e.room.name))}
        ${sumRow("media", t("Eén kaart voor alle spelers."), t("Spelers"), hm.media.map(e => name(hass, e)))}
        ${box(capchips(t("Overige kaarten"), more.map(([k, l]) => chip(l, on(k), () => focus(k, { draft: { ...d, shown: { ...d.shown, home: toggle(sh, k) } } })))))}
        ${order.length > 1 ? html`<div class="wzh">${t("Volgorde")}</div>${sortable(order, l => upd({ order: { ...d.order, home: l }, shown: { ...d.shown, home: l } }))}` : nothing}`,
      right: html`${rt(t("Voorvertoning · jouw startpagina"), t("Toont: {n}", { n: fLabel }))}
        <div class="wzpv">${stage(pv, { ring: [f], h: mobile() ? undefined : 760 })}</div>
        ${f.startsWith("sum:") && on(f) ? html`${rt(t("Na het tikken: elke lamp apart schakelen"))}${popBox(pv, { type: "sum", kind: f.slice(4), limit: 4 })}` : nothing}
        ${note(t("Tikken schakelt niets, maar opent dit venster; daar schakel je elke lamp apart of alles tegelijk. Alle aantallen volgen jouw huis: bij 8 thermostaten zijn het 8 regels."))}` }); }

  /* ---- 3 · Rooms ---- */
  { const all = Object.values(hass.areas || {}), counts = new Map([...entitiesByArea(hass)].map(([k, v]) => [k, v.filter(x => !x.reg.entity_category).length]));
    const floorOf = a => hass.floors?.[a.floor_id]?.name || t("zonder verdieping");
    const sel = d.rooms.filter(id => hass.areas?.[id]), off = all.filter(a => !sel.includes(a.area_id)).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    const sug = pop.sug || suggestAreas(hass).filter(x => x.area || x.newArea), admin = !!hass.user?.is_admin, active = sug.filter(x => x.on && (x.area || x.newArea));
    const setSug = (i, patch) => p.openPopup({ ...pop, draft: d, sug: sug.map((x, j) => j === i ? { ...x, ...patch } : x) });
    const f = pop.focus || sel[0];
    const rname = id => d.roomNames[id] || hass.areas[id].name;
    const items = sel.map(id => ({ id, body: html`${pop.rename === id ? html`<input class="wzren" type="text" .value=${rname(id)} @change=${e => upd({ roomNames: { ...d.roomNames, [id]: e.target.value && e.target.value !== hass.areas[id].name ? e.target.value : undefined } }, { rename: null })} @blur=${() => p.openPopup({ ...pop, draft: d, rename: null })}>` : html`<span @dblclick=${() => focus(id, { rename: id })}>${rname(id)}</span>`}<small>${floorOf(hass.areas[id])} · ${t("{n} items", { n: counts.get(id) || 0 })}</small>`,
      eye: true }));
    stations.push({ title: t("Jouw kamers"), sub: t("Kamers komen uit de gebieden in Home Assistant. Zet aan wat in de navigatie moet staan en sleep de volgorde goed."), icon: "mdi:floor-plan", tag: t("Volgorde, apparaten zonder gebied"),
      left: html`${sortable(items, l => upd({ rooms: [...l, ...d.rooms.filter(x => !l.includes(x) && !hass.areas?.[x])] }, { focus: pop.focus }), { extra: it => html`<button class="wzarr" title=${t("Uit de navigatie halen")} @click=${() => upd({ rooms: d.rooms.filter(x => x !== it.id) })}><ha-icon icon="mdi:eye-outline"></ha-icon></button>` })}
        ${off.length ? html`<div class="wzh">${t("Niet in de navigatie")}</div><ul class="wzl">${off.map(a => rowi({ icon: "mdi:eye-off-outline", title: a.name, sub: `${floorOf(a)} · ${t("{n} items", { n: counts.get(a.area_id) || 0 })}`, click: () => { const rb = buildRooms(hass, { ...p.config, rooms: [...d.rooms, a.area_id] }).find(x => x.id === a.area_id), rd = rb ? roomDefault(p, rb) : null; upd({ rooms: [...d.rooms, a.area_id], ...(rd ? { shown: { ...d.shown, [a.area_id]: rd.shown }, sources: { ...d.sources, [a.area_id]: rd.sources } } : {}) }); } }))}</ul>` : nothing}
        ${note(t("Rij slepen of de pijlen gebruiken om te sorteren, dubbelklikken om te hernoemen, het oog haalt een kamer uit de navigatie."))}`,
      right: html`${sug.length ? html`${rt(t("Apparaten zonder gebied gevonden"), t("{n} apparaten", { n: sug.length }))}
          ${note(t("Deze apparaten staan in geen enkele kamer, daarom ontbraken ze daar. Hun naam verraadt de kamer vaak wel."))}
          <ul class="wzl wzsug">${sug.map((x, i) => html`<li class=${classMap({ on: x.on && !!(x.area || x.newArea) })}><input type="checkbox" .checked=${x.on && !!(x.area || x.newArea)} ?disabled=${!(x.area || x.newArea)} @change=${e => setSug(i, { on: e.target.checked })}>
            <div>${x.name}<small>${x.kind === "device" ? t("{n} entiteiten", { n: x.count }) : t("Entiteit zonder apparaat")}</small></div>
            <select @change=${e => { const v = e.target.value; setSug(i, v === "-" ? { area: null, newArea: null, on: false } : v.startsWith("new:") ? { area: null, newArea: v.slice(4), on: true } : { area: v, newArea: null, on: true }); }}>
              <option value="-" ?selected=${!x.area && !x.newArea}>${t("niet toewijzen")}</option>${x.newArea ? html`<option value=${"new:" + x.newArea} selected>${t("Nieuw: {n}", { n: x.newArea })}</option>` : nothing}${all.map(a => html`<option value=${a.area_id} ?selected=${x.area === a.area_id}>${a.name}</option>`)}</select></li>`)}</ul>
          ${admin ? html`<div class="modes n2"><button class="on" ?disabled=${!active.length || pop.busy} @click=${async () => { p.openPopup({ ...pop, draft: d, sug, busy: true }); try { await applyAreas(hass, active); p.showToast?.(t("{n} apparaten toegewezen", { n: active.length })); } catch (e) { console.warn("[hacasa-nova] areas", e); p.showToast?.(t("Toewijzen mislukt")); } p.openPopup({ ...pop, draft: { ...d, rooms: [...d.rooms] }, sug: undefined, busy: false }); }}>${t("Voorstellen overnemen")} (${active.length})</button><button @click=${() => p.openPopup({ ...pop, draft: d, sug: [] })}>${t("Overslaan")}</button></div>
            ${note(t("De toewijzing wordt direct in Home Assistant opgeslagen en geldt dus ook voor andere apps."))}` : note(t("Alleen een beheerder kan gebieden toewijzen. Vraag een beheerder om dit te doen."))}`
        : html`${rt(t("Apparaten zonder gebied"))}${note(t("Alle apparaten staan in een kamer."))}`}
        ${rt(t("Zo ziet de navigatie eruit"), f && hass.areas?.[f] ? t("Toont: {n}", { n: rname(f) }) : "")}
        <div class="wzpv">${stage(pv, { nav: true, h: mobile() ? 160 : 150, css: ".wzstage .title,.wzstage .strip,.wzstage .banner{display:none}" })}</div>` }); }

  /* ---- 4 · Energy ---- */
  { const roles = energyRoles(), f = pop.focus || "power", en = d.home.energy || {}, setEn = (k, v) => upd({ home: { ...d.home, energy: { ...en, [k]: v || undefined } } }, { focus: k });
    const row = r => { const c = energyCandidates(hass, r), cur = en[r.key], s = cur && hass.states[cur], fmt = s ? `${num(s.state)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? s.state} ${s.attributes.unit_of_measurement || ""}` : "–";
      const flag = !cur ? html`<span class="wzwn">${t("kiezen")}</span>` : (c.best?.entity_id === cur || (r.re.test(`${s?.attributes.friendly_name || ""} ${cur}`))) ? html`<span class="wzok">${t("herkend")}</span>` : html`<span class="wzwn">${t("controleren")}</span>`;
      return html`<label class=${classMap({ f: true, wzfoc: f === r.key })} @click=${() => f !== r.key && focus(r.key)}><span>${r.label}${r.sub ? html`<small>${r.sub}</small>` : nothing}</span>
        <div class="wzsel"><select @focus=${() => f !== r.key && focus(r.key)} @change=${e => setEn(r.key, e.target.value)}><option value="">–</option>${c.list.slice(0, 200).map(x => html`<option value=${x.entity_id} ?selected=${x.entity_id === cur}>${x.attributes.friendly_name || x.entity_id}</option>`)}</select>${flag}<b>${fmt}</b></div></label>`; };
    stations.push({ title: t("Energie: zon, net, batterij, huis"), sub: t("Ik heb jouw omvormer herkend en elke rol voorgevuld. De voorvertoning toont de rol die je aanraakt."), icon: "mdi:flash-outline", tag: t("Zon, net, batterij, huis"),
      left: html`<div class="form"><div class="wzh first">${t("Nu (vermogen)")}</div>${roles.filter(r => r.group === "now").map(row)}<div class="wzh">${t("Vandaag (kWh sinds middernacht)")}</div>${roles.filter(r => r.group === "day").map(row)}</div>`,
      right: html`${rt(t("Voorvertoning · kaart op de startpagina"), t("Toont: {n}", { n: roles.find(r => r.key === f)?.label || "" }))}
        <div class="wzpv">${stage(pv, { ring: ["energy", "pv"], h: mobile() ? undefined : 760 })}</div>
        ${hm.energy.power ? html`${rt(t("Na het tikken"))}${popBox(pv, { type: "energy", hourly: null })}` : note(t("Kies minstens het huisverbruik om de energiekaart te tonen."))}` }); }

  /* ---- 5 · Cameras ---- */
  { const cams = Object.values(hass.states).filter(s => domain(s.entity_id) === "camera" && !hass.entities?.[s.entity_id]?.hidden), cur = d.cams, f = pop.focus || cams[0]?.entity_id;
    const get = id => cur.find(c => c.camera === id) || { camera: id, carousel: false, popup: [] }, setCam = (id, patch) => { const c = { ...get(id), ...patch }; upd({ cams: cur.some(x => x.camera === id) ? cur.map(x => x.camera === id ? c : x) : [...cur, c] }, { focus: id }); };
    const KL = { person: t("Persoon"), vehicle: t("Voertuig"), animal: t("Dier"), motion: t("Beweging"), bell: t("Deurbel") };
    const carOn = (d.shown.home || []).includes("cams"), motion = p.rooms.flatMap(r => r.ents.motion.map(e => ({ id: e.id, title: name(hass, e), room: r.name })));
    stations.push({ title: t("Camera's en beweging"), sub: t("Per camera: opnemen in de carrousel en kiezen bij welke herkenning een pop-up opent."), icon: "mdi:cctv", tag: t("Per camera en melder"),
      left: cams.length ? html`${box(html`<ul class="wzl">${rowi({ icon: "mdi:view-carousel-outline", title: t("Cameracarrousel"), sub: t("Eén grote kaart, wisselt om de 3 seconden; vegen kan ook."), on: carOn, state: carOn ? t("Aan") : t("Uit"), click: () => upShown("home", toggle(d.shown.home || [], "cams")) })}</ul>`, { sel: !!carOn && f === "carousel" })}
        ${cams.map(s => { const c = get(s.entity_id), det = camDetections(hass, s.entity_id), id = s.entity_id;
          return box(html`<ul class="wzl">${rowi({ icon: "mdi:cctv", title: s.attributes.friendly_name || id, on: c.carousel, state: c.carousel ? t("In carrousel") : t("Niet in carrousel"), click: () => setCam(id, { carousel: !c.carousel }) })}</ul>
            ${det.length ? capchips(t("Pop-up bij"), det.map(x => chip(KL[x.kind], c.popup.includes(x.id), () => setCam(id, { popup: toggle(c.popup, x.id) }), { title: x.id }))) : html`<div class="wzcap"><span>${t("Pop-up bij")}</span><small>${t("geen herkenning gevonden")}</small></div>`}`, { sel: f === id, off: !c.carousel }); })}
        ${motion.length ? box(capchips(t("Bewegingsmelders"), motion.map(m => chip(m.title, d.banner.includes(m.id), () => upd({ banner: toggle(d.banner, m.id) }), { title: m.room })))) : nothing}
        ${note(t("De melding „Beweging in …” bovenaan verschijnt voor de gekozen bewegingsmelders."))}`
        : html`${note(t("Geen camera's gevonden."))}`,
      right: html`${rt(t("Voorvertoning · startpagina"), t("Toont: {n}", { n: t("Carrousel") }))}
        <div class="wzpv">${stage(pv, { ring: ["cams"], h: mobile() ? undefined : 760 })}</div>
        ${note(t("De afbeelding wisselt elke 3 seconden naar de volgende camera; de rode stip pulseert zodat duidelijk is dat het live is. Naar links of rechts vegen springt direct verder."))}
        ${cams.some(s => s.entity_id === f) ? html`${rt(t("Pop-up bij herkenning"))}${popBox(pv, { type: "camera", s: hass.states[f] })}` : nothing}` }); }

  /* ---- 6 · Devices per room ---- */
  { const sel = d.rooms.filter(id => hass.areas?.[id]), cur = pop.room && sel.includes(pop.room) ? pop.room : sel[0], r = pv.rooms.find(x => x.id === cur), idx = sel.indexOf(cur);
    const sh = d.shown[cur] || [], cats = r ? roomCats(p, r) : [], src = d.sources[cur] || {};
    const setSrc = (k, v) => upd({ sources: { ...d.sources, [cur]: { ...src, [k]: v } } });
    const status = id => { const rr = pv.rooms.find(x => x.id === id), all = rr ? roomCats(p, rr).flatMap(c => c.items.map(i => i.key)) : []; const n = (d.shown[id] || []).filter(k => all.includes(k)).length; return all.length ? (n ? String(n) : "–") : "·"; };
    const sec = (title, n, body) => html`<div class="wzsec"><div class="wzsh"><span>${title}</span><span>${n}</span></div>${body}</div>`;
    const srcSec = (k, title, list) => list.length ? sec(title, list.length > 1 ? t("kies één bron") : "", html`<div class="chips">${list.map(e => chip(`${name(hass, e)} ${num(e.state?.state) != null ? num(e.state.state).toLocaleString(undefined, { maximumFractionDigits: 1 }) + (e.state.attributes.unit_of_measurement || "") : ""}`, (src[k] || list[0].id) === e.id, () => setSrc(k, e.id), { mark: true, title: e.id }))}${chip(t("geen"), src[k] === "none", () => setSrc(k, "none"), { mark: true })}</div>`) : nothing;
    stations.push({ title: t("Welke apparaten horen in de kamer?"), sub: t("Alle passende apparaten van de kamer staan per soort op een rij. Wit is gekozen. Technische items zijn verborgen."), icon: "mdi:devices", tag: t("Per kamer, alles in één venster"), wide: true,
      left: html`<ul class="wzl wzrooms">${sel.map(id => html`<li class=${classMap({ on: id === cur, tap: true })} @click=${() => p.openPopup({ ...pop, draft: d, room: id })}><div>${rname(d, hass, id)}</div><span class="st">${status(id)}</span></li>`)}</ul>`,
      mid: r ? html`<div class="chips"><button @click=${() => upShown(cur, cats.flatMap(c => c.items.filter(i => !i.dup).map(i => i.key)))}>${t("Aanbeveling overnemen")}</button><button @click=${() => upShown(cur, [])}>${t("Alles uit")}</button></div>
        ${cats.filter(c => c.k !== "more" || c.items.length).map(c => sec(c.title, t("{n} van {m}", { n: c.items.filter(i => sh.includes(i.key)).length, m: c.items.length }), html`<div class="chips">${c.items.map(i => chip(html`${i.group ? html`<small class="wzgl">${t("Groep")}</small> ` : nothing}${i.title}`, sh.includes(i.key), () => upShown(cur, toggle(sh, i.key)), { title: i.key }))}</div>`))}
        ${srcSec("temp", t("Temperatuur"), r.ents.temp)}${srcSec("hum", t("Luchtvochtigheid"), r.ents.hum)}${srcSec("lux", t("Helderheid"), r.ents.lux)}
        ${note(t("Technische items (linkkwaliteit, update, batterij …) zijn verborgen."))}` : html`${note(t("Kies eerst kamers bij station 3."))}`,
      right: r ? html`${rt(t("Voorvertoning · kamer"), r.name)}<div class="wzpv">${stage(pv, { room: r })}</div>
        ${note(t("Heb je twee temperatuursensoren in de kamer (bijvoorbeeld in de bewegingsmelder en een aparte), dan kies je hier welke telt. Hetzelfde geldt voor luchtvochtigheid en helderheid."))}
        <div class="modes n2">${idx > 0 ? html`<button @click=${() => p.openPopup({ ...pop, draft: d, room: sel[idx - 1] })}>${t("Vorige kamer")}</button>` : html`<span></span>`}${idx < sel.length - 1 ? html`<button class="on" @click=${() => p.openPopup({ ...pop, draft: d, room: sel[idx + 1] })}>${t("Volgende kamer")}: ${rname(d, hass, sel[idx + 1])}</button>` : html`<span></span>`}</div>` : nothing }); }

  /* ---- 7 · Status ---- */
  { const f = pop.focus || "lights", PL = { lights: [t("Lampen"), t("Telt de lampen; tikken opent het venster met alle lampen."), "mdi:lightbulb-outline"], doors: [t("Deuren en ramen"), t("Toont wat open staat; tikken opent de lijst."), "mdi:door"], attention: [t("Aandacht"), t("Verzamelt problemen: batterijen, updates, apparaten offline."), "mdi:alert-circle-outline"] };
    const TK = { update: t("Nieuwe HaCasa-versie"), energy: t("Energie van vandaag"), waste: t("Afvalophaling"), agenda: t("Volgende afspraak"), notifications: t("Meldingen van Home Assistant"), attention: t("Aandachtspunten"), doors: t("Open deuren"), weather: t("Weer"), modes: t("Actieve modi"), appliances: t("Huishoudapparaten") };
    stations.push({ title: t("Status en meldingen"), sub: t("Twee kleine zones bovenaan de startpagina. De voorvertoning springt naar de optie die je aanraakt."), icon: "mdi:gauge", tag: t("Knoppen en meldingsregel"),
      left: html`<div class="wzh first">${t("① Snelle statusknoppen")}<small>${t("de ronde knoppen onder de begroeting")}</small></div>
        <ul class="wzl">${PILLS.map(k => rowi({ icon: PL[k][2], title: PL[k][0], sub: PL[k][1], on: d.pills.includes(k), state: d.pills.includes(k) ? t("Aan") : t("Uit"), click: () => { upd({ pills: toggle(d.pills, k) }, { focus: k }); } }))}
          ${rowi({ icon: "mdi:account-group-outline", title: t("Wie is er thuis"), sub: t("Volgens de telefoonlocatie."), on: d.people, state: d.people ? t("Aan") : t("Uit"), click: () => upd({ people: !d.people }, { focus: "people" }) })}</ul>
        <div class="wzh">${t("② Meldingsregel")}<small>${t("de smalle strook met wat nu belangrijk is")}</small></div>
        <ul class="wzl">${Object.keys(TICKER_KINDS.home).map(k => rowi({ icon: "mdi:text-short", title: TK[k], on: d.tickerHome.includes(k), state: d.tickerHome.includes(k) ? t("Aan") : t("Uit"), click: () => upd({ tickerHome: toggle(d.tickerHome, k) }, { focus: "ticker" }) }))}</ul>`,
      right: html`${rt(t("Voorvertoning · kop van de startpagina"), PL[f] ? t("Toont: {n}", { n: PL[f][0] }) : f === "people" ? t("Wie is er thuis") : t("Meldingsregel"))}
        <div class="wzpv">${stage(pv, { css: `.wzstage .strip,.wzstage .banner{display:none} ${PL[f] ? `.wzstage .pills button:nth-child(${Math.max(1, d.pills.filter(k => PILLS.indexOf(k) <= PILLS.indexOf(f)).length)}){outline:3px solid #f2b63a;outline-offset:2px}` : ""}`, h: mobile() ? 560 : 520 })}</div>
        ${note(t("Je kiest een regel, de voorvertoning toont meteen hoe die eruitziet: de knop in de rij en het venster na het tikken."))}
        ${PL[f] ? html`${rt(t("Na het tikken"))}${popBox(pv, { type: f === "attention" ? "attention" : "sum", kind: f === "lights" ? "lights" : "openings", limit: 3 })}` : nothing}` }); }

  /* ---- 8 · Done ---- */
  { const sh = d.shown.home || [], nTiles = sh.filter(k => k.startsWith("sum:")).length, nCams = d.cams.filter(c => c.carousel).length, en = Object.values(d.home.energy || {}).filter(Boolean).length;
    const sm = (n, txt, to) => html`<li class="tap" @click=${() => goStep(to)}><b>${n}</b><div>${txt}</div><span class="st">${t("Station {n}", { n: to + 1 })}</span></li>`;
    stations.push({ title: t("Klaar: zo ziet jouw HaCasa eruit"), sub: t("Overzicht van je keuzes en de complete startpagina. Tik op een regel om terug te springen naar het station."), icon: "mdi:check-circle-outline", tag: t("Overzicht en back-up"),
      left: html`<ul class="wzl wzsum">${sm(d.rooms.filter(id => hass.areas?.[id]).length, t("Kamers in de navigatie"), 2)}${sm(nTiles, t("Verzamelkaarten: licht, ramen/deuren, klimaat, media"), 1)}${sm(en, t("Energiewaarden toegewezen"), 3)}${sm(nCams, t("Camera's in de carrousel"), 4)}${sm(d.pills.length + (d.people ? 1 : 0), t("Statusknoppen"), 6)}</ul>
        ${note(t("Nieuwe apparaten verschijnen nooit vanzelf. HaCasa meldt ze in de meldingsregel („3 nieuwe apparaten”) en jij beslist waar ze komen."))}
        ${note(t("Instellingen gelden per gebruiker. Voor een tweede gebruiker: hier exporteren, in haar account importeren. De assistent is altijd opnieuw te starten via Paneelinstellingen."))}
        <div class="modes n2"><button @click=${() => p.exportSettings()}>${t("Bestand exporteren")}</button><span></span></div>`,
      right: html`${rt(t("Jouw startpagina"), t("compleet"))}<div class="wzpv">${stage(pv, {})}</div>${note(t("Aantallen en standen zijn voorbeeldwaarden. In de echte weergave staat wat jouw huis nu meldt."))}` }); }

  /* ---- shell ---- */
  const ids = !mode ? [0] : mode === "auto" ? [0, 2, 3] : mode === "later" ? [0, 2] : [0, 1, 2, 3, 4, 5, 6, 7];
  const at = Math.min(step, stations.length - 1), pos = Math.max(0, ids.indexOf(at)), cur = stations[ids.includes(at) ? at : ids[0]], curIdx = ids.includes(at) ? at : ids[0];
  const next = ids[pos + 1], prev = ids[pos - 1], last = next === undefined;
  return html`<div class=${classMap({ popup: true, wz: true, three: !!cur.wide })}>
    <header><div class="wzeye">${t("Installatie")} · ${t("{n} van {m}", { n: pos + 1, m: ids.length })}</div><h2>${cur.title}</h2><p>${cur.sub}</p></header>
    <div class="wzb"><div class="wzc wzl1">${cur.left}</div>${cur.mid ? html`<div class="wzc wzl2">${cur.mid}</div>` : nothing}<div class="wzc wzr">${cur.right}</div></div>
    <footer><div class="modes n3">${prev !== undefined ? html`<button @click=${() => goStep(prev)}>${t("Terug")}</button>` : html`<button @click=${() => p.finishWizard(null)}>${t("Overslaan")}</button>`}
      <span class="dots">${ids.map(i => html`<i class=${i === curIdx ? "on" : ""}></i>`)}</span>
      <button class="on" ?disabled=${!mode} @click=${() => last ? p.finishWizard(d) : goStep(next)}>${last ? t("Klaar") : t("Volgende")}</button></div></footer></div>`;
}
const rname = (d, hass, id) => d.roomNames?.[id] || hass.areas?.[id]?.name || id;
const STEP_NAMES = [
  () => [t("Start"), t("Taal, titel, weg kiezen")], () => [t("Startpagina"), t("Kaarten met live voorvertoning")], () => [t("Kamers"), t("Volgorde, apparaten zonder gebied")], () => [t("Energie"), t("Zon, net, batterij, huis")],
  () => [t("Camera's"), t("Per camera en melder")], () => [t("Apparaten"), t("Per kamer, alles in één venster")], () => [t("Status"), t("Knoppen en meldingsregel")], () => [t("Klaar"), t("Overzicht en back-up")],
];
