// Setup assistant. Three ways to start: automatic (everything that is found shows up), choose myself (nothing shows up
// unless it is picked: start page, rooms, status line, quick actions, hidden devices) or later (rooms only, pages empty).
// The result is written once, by wizardPatch(), into the user settings.
import { t, LANGUAGES } from "./i18n.js";
import { html, nothing } from "lit";
import { domain } from "./util.js";
import { buildRooms, deviceName } from "./model.js";
import { field, text, select } from "./settings.js";
import { triggerCandidates } from "./features.js";

/** what the ticker line under the greeting can show (home page and rooms) */
export const TICKER_KINDS = { home: { update: t("HaCasa-updates"), energy: t("Energie"), waste: t("Afval"), agenda: t("Agenda"), notifications: t("Meldingen"), attention: t("Aandacht"), doors: t("Open deuren"), weather: t("Weer"), modes: t("Modi"), appliances: t("Huishoudapparaten") }, room: { lights: t("Lampen"), doors: t("Open deuren/ramen"), media: t("Media"), battery: t("Batterij laag"), appliances: t("Huishoudapparaten") } };
const PILLS = { lights: t("Lampen"), doors: t("Deuren & ramen"), attention: t("Aandacht") };
const GROUPS = { lights: t("Lampen"), climate: t("Verwarming"), media: t("Media"), covers: t("Rolluiken"), switches: t("Schakelaars"), sensors: t("Sensoren"), other: t("Overig") };

/** the key of a card, as the group it is listed under */
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

/** what the panel already knows: the starting point of the assistant */
export function wizardDefaults(p) {
  const h = p.config.home || {}, cur = !!p.config.curated, pg = p.config.pages || {};
  const shown = Object.fromEntries(Object.entries(pg).filter(([, v]) => v.shown?.length).map(([k, v]) => [k, [...v.shown]]));
  const on = (kinds, tk) => Object.keys(kinds).filter(k => cur && tk?.[k] !== false);
  const rooms = p.rooms.map(r => r.id), roomTk = pg[rooms[0]]?.ticker;
  const motion = p.rooms.flatMap(r => r.ents.motion.map(e => e.id));
  return { language: p.config.language, title: p.userConfig?.title, rooms, roomNames: {}, roomImages: {}, roomImage: p.userConfig?.roomImage, homeImage: p.userConfig?.homeImage,
    mode: cur ? "curated" : undefined, shown,   // mode stays empty on the first run: the person has to pick a way
    home: { weather: p.home?.weather?.entity_id, climate: p.home?.climate?.entity_id, alarm: p.home?.alarm?.entity_id, energy: { power: h.energy?.power, today: h.energy?.today }, scenes: h.scenes || null },
    pills: cur ? (h.pills || Object.keys(PILLS)) : [], people: cur && h.people !== false,
    tickerHome: on(TICKER_KINDS.home, pg.home?.ticker), tickerRoom: on(TICKER_KINDS.room, roomTk),
    banner: cur ? (h.bannerSensors || motion) : [], camera: h.doorbell?.camera, triggers: h.doorbell?.triggers || [],
    quick: (h.quick || []).map(q => ({ ...q })), never: [...(p.config.neverShow || [])] };
}

/** the cards the start page can show, whether or not they exist right now (the real list depends on what is playing, open, …) */
export function wizardHomeCards(p, d) {
  const h = p.home, out = [], add = (key, title, sub = "", hint = "", rec = false) => out.push({ key, title, sub, hint, rec });
  const climate = d.home.climate || h.climate?.entity_id, weather = d.home.weather || h.weather?.entity_id, power = d.home.energy?.power || h.energy.power?.entity_id;
  add("climate", t("Thermostaat"), climate || "", climate ? "" : t("Geen apparaat gevonden"), true);
  add("weather", t("Weer"), weather || "", weather ? "" : t("Geen apparaat gevonden"));
  add("agenda", t("Agenda"), h.calendars.join(", "), h.calendars.length ? "" : t("Geen agenda's gevonden"));
  add("waste", t("Afval"), h.waste.map(w => w.entity).join(", "), h.waste.length ? "" : t("Nog niet ingesteld (Panel instellingen › Agenda)"));
  add("scenes", t("Scènes"), "", h.scenes.length ? "" : t("Geen scènes gevonden"));
  add("energy", t("Energie"), power || "", power ? "" : t("Geen apparaat gevonden"));
  add("attention", t("Aandacht"), t("Apparaten, batterijen en automatiseringen"));
  for (const m of p.rooms.flatMap(r => r.ents.media)) add(m.id, cardTitle(p, { key: m.id, label: "" }).title, m.id, t("alleen als hij speelt"));
  for (const a of p.rooms.flatMap(r => r.ents.appliances).filter(a => !a.plain)) add(a.id, cardTitle(p, { key: a.id, label: "" }).title, a.key, t("alleen als hij bezig is"));
  return out;
}

/** the settings the assistant writes (merged into the user settings by the panel) */
export function wizardPatch(p, d) {
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const ud = p.userConfig || {}, areaOk = id => !!p.hass.areas?.[id];
  const rooms = (d.rooms || []).filter(areaOk).map(id => d.roomNames?.[id] || d.roomImages?.[id] ? clean({ area: id, name: d.roomNames?.[id], image: d.roomImages?.[id] }) : id);
  const patch = { ...clean({ language: d.language, title: d.title, roomImage: d.roomImage, homeImage: d.homeImage }), rooms: rooms.length ? rooms : undefined,
    home: { ...(ud.home || {}), ...clean({ weather: d.home.weather, climate: d.home.climate, alarm: d.home.alarm }), energy: { ...(ud.home?.energy || {}), ...clean(d.home.energy || {}) } }, setupDone: true };
  if (!d.mode) return patch;
  patch.curated = d.mode === "auto" ? undefined : true;
  if (d.mode === "auto") return patch;
  const later = d.mode === "later", pages = { ...(ud.pages || {}) }, ids = (d.rooms || []).filter(areaOk);
  const offTicker = (kinds, on) => { const off = Object.keys(kinds).filter(k => !on.includes(k)); return off.length ? Object.fromEntries(off.map(k => [k, false])) : undefined; };
  const cfgOf = (key, shown, tickerKinds, tickerOn, seen) => {
    const pg = { ...(pages[key] || {}) };
    if (shown?.length) pg.shown = shown; else delete pg.shown;
    const tk = offTicker(tickerKinds, tickerOn); if (tk) pg.ticker = tk; else delete pg.ticker;
    if (seen) pg.seen = seen;
    if (Object.keys(pg).length) pages[key] = pg; else delete pages[key];
  };
  cfgOf("home", later ? [] : d.shown?.home, TICKER_KINDS.home, later ? [] : d.tickerHome);
  const rb = buildRooms(p.hass, { ...p.config, rooms: ids });
  for (const id of ids) { const r = rb.find(x => x.id === id); cfgOf(id, later ? [] : d.shown?.[id], TICKER_KINDS.room, later ? [] : d.tickerRoom, r ? p.roomCardKeys(r) : undefined); }
  patch.pages = pages;
  const hm = patch.home;
  hm.pills = later ? [] : d.pills; hm.people = later || !d.people ? false : undefined;
  hm.bannerSensors = later ? [] : d.banner;
  if (!later) {
    hm.doorbell = d.camera ? { ...(hm.doorbell || {}), camera: d.camera, triggers: d.triggers || [] } : undefined;
    hm.quick = d.quick?.length ? d.quick : undefined; hm.scenes = d.home.scenes || undefined;
  }
  patch.neverShow = d.never?.length ? d.never : undefined;
  return patch;
}

/* ---------- small building blocks (same markup as the other popups) ---------- */
const row = (icon, label, value, { on = false, sub = "", onclick = null } = {}) =>
  html`<li class="${on ? "on" : ""} ${onclick ? "tap" : ""}" @click=${onclick || nothing}><ha-icon icon=${icon}></ha-icon><div>${label}${sub ? html`<small>${sub}</small>` : nothing}</div><span class="st">${value}</span></li>`;
const toggle = (list, k) => list.includes(k) ? list.filter(x => x !== k) : [...list, k];
const chipSet = (items, sel, on) => html`<div class="chips">${items.map(([k, label, title]) => html`<button class=${sel.includes(k) ? "on" : ""} title=${title || ""} @click=${() => on(toggle(sel, k))}>${label}</button>`)}</div>`;
const head = (a, b = "") => html`<div class="prow hd" style="margin-top:18px"><span>${a}</span>${b ? html`<b>${b}</b>` : nothing}</div>`;

export function renderWizard(p, pop) {
  const hass = p.hass, d = pop.draft || wizardDefaults(p), step = pop.step || 0, mode = d.mode, curated = mode === "curated";
  const upd = (patch, extra = {}) => p.openPopup({ ...pop, ...extra, draft: { ...d, ...patch } });
  const updHome = (k, v) => upd({ home: { ...d.home, [k]: v } }), updEnergy = (k, v) => updHome("energy", { ...(d.home.energy || {}), [k]: v });
  const goStep = s => p.openPopup({ ...pop, draft: d, step: s, q: "" });
  const areas = Object.values(hass.areas || {}).sort((a, b) => a.name.localeCompare(b.name, "nl")), areaName = id => hass.areas?.[id]?.name || id;
  let _rooms; const builtRooms = () => _rooms || (_rooms = buildRooms(hass, { ...p.config, rooms: d.rooms }));
  const cardsOf = id => { const r = builtRooms().find(x => x.id === id); if (!r) return []; const list = p.roomCards(r);
    const media = list.filter(c => groupOf(c.key) === "media").length;
    return list.map(c => { const lead = r.ents.media.find(m => m.id === c.key), hint = lead?.linked?.length ? t("{n} gekoppelde spelers zijn hier één kaart", { n: lead.linked.length }) : media > 1 && groupOf(c.key) === "media" ? t("meerdere mediaspelers in deze kamer: vaak hetzelfde apparaat, kies er één") : "";
      return { key: c.key, ...cardTitle(p, c, r), hint, group: groupOf(c.key), rec: c.key.startsWith("light.") || c.key.startsWith("climate.") }; }); };

  /** pick the cards of one page: nothing is chosen by default, "Aanbeveling" only on request */
  const picker = (cards, key, { search = false, like = false } = {}) => {
    const sel = new Set(d.shown[key] || []), setShown = list => upd({ shown: { ...d.shown, [key]: list } }), q = (pop.q || "").toLowerCase();
    const flip = k => setShown(sel.has(k) ? [...sel].filter(x => x !== k) : [...sel, k]);
    const shownCards = q ? cards.filter(c => (c.title + " " + c.sub).toLowerCase().includes(q)) : cards;
    const groups = Object.keys(GROUPS).map(g => [g, shownCards.filter(c => (c.group || "other") === g)]).filter(([, l]) => l.length);
    const others = d.rooms.filter(id => id !== key && d.shown[id]?.length && key !== "home");
    const likeRoom = id => { const sg = new Set(cardsOf(id).filter(c => (d.shown[id] || []).includes(c.key)).map(c => c.group)); setShown(cards.filter(c => sg.has(c.group)).map(c => c.key)); };
    const li = c => html`<li class=${sel.has(c.key) ? "" : "off"} @click=${() => flip(c.key)}><ha-icon icon=${sel.has(c.key) ? "mdi:eye-outline" : "mdi:eye-off-outline"}></ha-icon><div>${c.title}<small>${[c.sub, c.hint].filter(Boolean).join(" · ")}</small></div>
      <span class="btns"><button title=${sel.has(c.key) ? t("Verbergen") : t("Tonen")}><ha-icon icon=${sel.has(c.key) ? "mdi:eye-outline" : "mdi:eye-off-outline"}></ha-icon></button></span></li>`;
    return html`${head(t("Kaarten"), t("{a} van {b} gekozen", { a: cards.filter(c => sel.has(c.key)).length, b: cards.length }))}
      <div class="chips"><button @click=${() => setShown(cards.filter(c => c.rec).map(c => c.key))}>${t("Aanbeveling overnemen")}</button><button @click=${() => setShown(cards.map(c => c.key))}>${t("Alles aan")}</button><button @click=${() => setShown([])}>${t("Alles uit")}</button></div>
      ${like && others.length ? html`<label class="f likef"><span>${t("Zoals een andere kamer")}<small>${t("kiest dezelfde soorten kaarten")}</small></span><select @change=${e => { if (e.target.value) likeRoom(e.target.value); }}><option value="">${t("kies kamer")}</option>${others.map(id => html`<option value=${id}>${areaName(id)}</option>`)}</select></label>` : nothing}
      ${search ? html`<input class="wsearch" type="search" .value=${pop.q || ""} placeholder=${t("Zoeken op naam of entiteit")} @input=${e => p.openPopup({ ...pop, draft: d, q: e.target.value })}>` : nothing}
      ${groups.map(([g, list]) => html`<div class="ghead" @click=${() => { const keys = list.map(c => c.key), all = keys.every(k => sel.has(k)); setShown(all ? [...sel].filter(k => !keys.includes(k)) : [...new Set([...sel, ...keys])]); }}>${t(GROUPS[g])} · ${list.filter(c => sel.has(c.key)).length}/${list.length}</div><ul class="plist">${list.map(li)}</ul>`)}
      ${!cards.length ? html`<ul class="plist"><li><div>${t("Geen kaarten op deze pagina")}</div></li></ul>` : nothing}`;
  };

  /** a sketch of the start page that fills up with the answers so far */
  const preview = () => {
    const homeSel = new Set(d.shown.home || []), cards = wizardHomeCards(p, d).filter(c => homeSel.has(c.key));
    const chip = (label, icon) => html`<span class="pv-chip"><ha-icon icon=${icon || "mdi:circle-small"}></ha-icon>${label}</span>`;
    const quick = d.quick.map(q => q.label).filter(Boolean);
    return html`<div class="pv"><div class="pv-title">${d.title || t("Thuis")}</div>
      ${d.pills.length || d.people ? html`<div class="pv-row">${d.pills.map(k => chip(t(PILLS[k])))}${d.people ? chip(t("Wie is thuis"), "mdi:account-group-outline") : nothing}</div>` : nothing}
      ${d.tickerHome.length ? html`<div class="pv-line">${d.tickerHome.map(k => t(TICKER_KINDS.home[k])).join(" · ")}</div>` : nothing}
      ${quick.length ? html`<div class="pv-row">${quick.map(x => chip(x, "mdi:flash-outline"))}</div>` : nothing}
      <div class="pv-row">${cards.length ? cards.map(c => html`<span class="pv-tile">${c.title}</span>`) : html`<span class="pv-empty">${t("Nog geen kaarten gekozen.")}</span>`}</div>
      ${d.banner.length ? html`<div class="pv-line"><ha-icon icon="mdi:motion-sensor"></ha-icon> ${t("Bewegingsbalk")}</div>` : nothing}</div>`;
  };
  const previewToggle = () => html`<div class="chips"><button class=${pop.pv ? "on" : ""} @click=${() => p.openPopup({ ...pop, draft: d, pv: !pop.pv })}>${t("Voorbeeld startpagina")}</button></div>${pop.pv ? preview() : nothing}`;

  /** entities that can be hidden everywhere: sensors, batteries, diagnostic entities of the chosen rooms */
  const hideCands = () => {
    const all = buildRooms(hass, { ...p.config, neverShow: [], rooms: d.rooms }).flatMap(r => r.ents.all.map(e => ({ ...e, room: r })));
    const kind = e => e.state?.attributes?.device_class === "battery" ? "battery" : e.reg.entity_category ? "diag" : "sensor";
    return all.filter(e => ["sensor", "binary_sensor"].includes(domain(e.id))).map(e => ({ key: e.id, title: e.state?.attributes?.friendly_name || e.id, sub: `${e.room.name} · ${e.id}`, group: kind(e) }));
  };

  const modeRow = (m, icon, label, sub) => row(icon, label, mode === m ? "✓" : "", { on: mode === m, sub, onclick: () => upd({ mode: m }) });
  const moveRoom = (i, dir) => { const l = [...d.rooms], j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; upd({ rooms: l }); };
  const setMap = (k, id, v) => upd({ [k]: { ...d[k], [id]: v || undefined } });
  const scenes = Object.values(hass.states).filter(s => domain(s.entity_id) === "scene"), scripts = Object.values(hass.states).filter(s => domain(s.entity_id) === "script");
  const qKey = q => `${q.type}:${q.entity || ""}`, quickHas = k => d.quick.some(q => qKey(q) === k);
  const quickOpts = [["lights_off:", t("Alle lampen uit"), { label: t("Alle lampen uit"), type: "lights_off", confirm: true }], ["media_off:", t("Media uit"), { label: t("Media uit"), type: "media_off" }],
    ...scenes.map(s => [`scene:${s.entity_id}`, s.attributes.friendly_name || s.entity_id, { label: s.attributes.friendly_name || s.entity_id, type: "scene", entity: s.entity_id }]),
    ...scripts.map(s => [`script:${s.entity_id}`, s.attributes.friendly_name || s.entity_id, { label: s.attributes.friendly_name || s.entity_id, type: "script", entity: s.entity_id }])];
  const motionSensors = p.rooms.flatMap(r => r.ents.motion.map(e => ({ id: e.id, name: e.state?.attributes?.friendly_name || e.id, room: r.name })));

  const S = {
    welcome: { title: t("Welkom"), body: () => html`<div class="sub">${mode === "auto" ? t("In vier stappen staat het panel klaar. Alles is later aan te passen bij Panel instellingen.") : t("Alles is later aan te passen bij Panel instellingen.")}</div><div class="form">
        ${field(t("Taal"), html`<select @change=${e => upd({ language: e.target.value || undefined })}><option value="" ?selected=${!d.language}>${t("automatisch (taal van Home Assistant)")}</option>${Object.entries(LANGUAGES).map(([k, l]) => html`<option value=${k} ?selected=${d.language === k}>${l}</option>`)}</select>`)}
        ${field(t("Titel"), text(d.title, v => upd({ title: v || undefined }), t("Thuis") + "."), t("linksboven in de navigatie"))}</div>
      ${head(t("Hoe wil je instellen?"))}
      <ul>${modeRow("auto", "mdi:auto-fix", t("Automatisch"), t("alle gevonden apparaten verschijnen vanzelf"))}
        ${modeRow("curated", "mdi:cursor-default-click-outline", t("Zelf kiezen"), t("niets verschijnt vanzelf; jij kiest per kamer welke kaarten er staan"))}
        ${modeRow("later", "mdi:clock-outline", t("Later"), t("alleen de kamers; alle pagina's blijven leeg tot je ze vult"))}</ul>
      <div class="chips"><button @click=${() => p.exportSettings()} ?hidden=${!p.userConfig?.setupDone}>${t("Huidige instellingen bewaren (bestand)")}</button>
        <button @click=${e => e.currentTarget.nextElementSibling.click()}>${t("Instellingen importeren")}</button><input type="file" accept="application/json,.json" hidden @change=${async e => { const f = e.target.files[0]; e.target.value = ""; if (f && await p.importSettings(f)) p.popup = null; }}></div>
      ${p.userConfig?.setupDone ? html`<div class="sub" style="margin-top:8px">${t("Tip: bewaar eerst de huidige instellingen; de assistent wijzigt alleen wat je invult.")}</div>` : nothing}` },
    rooms: { title: t("Kamers"), body: () => html`<div class="sub">${t("Kies de ruimtes die als kamer in de navigatie komen. De volgorde pas je later aan bij Kamers.")}</div>
      <div class="chips">${areas.map(a => { const on = d.rooms.includes(a.area_id); return html`<button class=${on ? "on" : ""} @click=${() => upd({ rooms: on ? d.rooms.filter(x => x !== a.area_id) : [...d.rooms, a.area_id] })}>${a.name}</button>`; })}</div>
      ${!areas.length ? html`<div class="sub" style="margin-top:12px">${t("Geen ruimtes gevonden. Maak eerst ruimtes aan in Home Assistant en wijs apparaten toe.")}</div>` : nothing}
      ${d.rooms.length ? html`${head(t("Volgorde, naam en foto"), t("per kamer"))}<ul class="plist rooms">${d.rooms.map((id, i) => html`<li><div class="rn"><b>${areaName(id)}</b>
        <input type="text" .value=${d.roomNames[id] || ""} placeholder=${t("andere naam")} @change=${e => setMap("roomNames", id, e.target.value)}>
        <input type="text" .value=${d.roomImages[id] || ""} placeholder=${t("foto (pad of URL)")} @change=${e => setMap("roomImages", id, e.target.value)}></div>
        <span class="btns"><button title=${t("Omhoog")} ?disabled=${i === 0} @click=${() => moveRoom(i, -1)}>↑</button><button title=${t("Omlaag")} ?disabled=${i === d.rooms.length - 1} @click=${() => moveRoom(i, 1)}>↓</button></span></li>`)}</ul>` : nothing}` },
    devices: { title: t("Startpagina"), body: () => html`<div class="sub">${t("Welke entiteiten de vaste kaarten op de startpagina gebruiken. Leeg = geen kaart.")}</div><div class="form">
        ${field(t("Weer"), select(hass, "weather", d.home.weather, v => updHome("weather", v), { empty: t("geen") }))}
        ${field(t("Thermostaat"), select(hass, "climate", d.home.climate, v => updHome("climate", v), { empty: t("geen") }))}
        ${field(t("Alarm"), select(hass, "alarm_control_panel", d.home.alarm, v => updHome("alarm", v), { empty: t("geen") }))}
        ${field(t("Vermogen"), select(hass, "sensor", d.home.energy?.power, v => updEnergy("power", v), { empty: t("geen"), filter: s => s.attributes.unit_of_measurement === "W" }), "W")}
        ${field(t("Verbruik vandaag"), select(hass, "sensor", d.home.energy?.today, v => updEnergy("today", v), { empty: t("geen"), filter: s => s.attributes.unit_of_measurement === "kWh" }), "kWh")}</div>` },
    homecards: { title: t("Kaarten op de startpagina"), body: () => html`<div class="sub">${t("Kies welke kaarten bovenaan de startpagina staan. Standaard is niets gekozen.")}</div>${picker(wizardHomeCards(p, d), "home")}
      ${(d.shown.home || []).includes("scenes") && scenes.length ? html`${head(t("Scènes"), t("op de scèneskaart"))}${chipSet(scenes.map(s => [s.entity_id, s.attributes.friendly_name || s.entity_id]), d.home.scenes || scenes.slice(0, 4).map(s => s.entity_id), v => updHome("scenes", v))}` : nothing}
      ${previewToggle()}` },
    status: { title: t("Statuszeile"), body: () => html`<div class="sub">${t("Wat er onder de begroeting staat. Standaard is niets gekozen.")}</div>
      ${head(t("Knoppen onder de begroeting"))}${chipSet(Object.entries(PILLS).map(([k, l]) => [k, t(l)]), d.pills, v => upd({ pills: v }))}
      <div class="chips"><button class=${d.people ? "on" : ""} @click=${() => upd({ people: !d.people })}>${t("Wie is thuis")}</button></div>
      ${head(t("Meldingenregel"), t("startpagina"))}${chipSet(Object.entries(TICKER_KINDS.home).map(([k, l]) => [k, t(l)]), d.tickerHome, v => upd({ tickerHome: v }))}
      ${head(t("Meldingenregel"), t("kamers"))}${chipSet(Object.entries(TICKER_KINDS.room).map(([k, l]) => [k, t(l)]), d.tickerRoom, v => upd({ tickerRoom: v }))}${previewToggle()}` },
    motion: { title: t("Beweging & deurbel"), body: () => html`<div class="sub">${t("Standaard is niets gekozen.")}</div>
      ${head(t("Bewegingsbalk"), t("welke sensoren de balk onderaan tonen"))}${motionSensors.length ? chipSet(motionSensors.map(m => [m.id, m.name, m.room]), d.banner, v => upd({ banner: v })) : html`<small>${t("Geen bewegingssensoren in de kamers")}</small>`}
      ${head(t("Deurbel / camera-popup"), t("opent de camera als een sensor afgaat"))}<div class="form">${field(t("Camera"), select(hass, "camera", d.camera, v => upd({ camera: v || undefined }), { empty: t("uit") }))}</div>
      ${d.camera ? chipSet(triggerCandidates(hass).map(s => [s.entity_id, s.attributes.friendly_name || s.entity_id, s.entity_id]), d.triggers, v => upd({ triggers: v })) : nothing}` },
    quick: { title: t("Snelle acties"), body: () => html`<div class="sub">${t("knoppen onder de begroeting op de startpagina")}</div>
      ${chipSet(quickOpts.map(([k, l]) => [k, l]), d.quick.map(qKey), v => upd({ quick: quickOpts.filter(([k]) => v.includes(k)).map(([, , q]) => d.quick.find(x => qKey(x) === qKey(q)) || q) }))}
      ${!quickOpts.length ? html`<small>${t("Geen scènes gevonden")}</small>` : nothing}${previewToggle()}` },
    never: { title: t("Nooit tonen"), body: () => { const all = hideCands(), q = (pop.q || "").toLowerCase(), g = pop.g || "sensor", GL = { sensor: t("Sensoren"), battery: t("Batterijen"), diag: t("Diagnose") };
      const list = all.filter(c => c.group === g && (!q || (c.title + " " + c.sub).toLowerCase().includes(q))), sel = new Set(d.never), cut = list.slice(0, q ? 200 : 60);
      return html`<div class="sub">${t("Apparaten die nergens mogen verschijnen: niet als kaart, niet in de kamertemperatuur, niet bij aandachtspunten.")}</div>
        <div class="chips">${Object.entries(GL).map(([k, l]) => html`<button class=${g === k ? "on" : ""} @click=${() => p.openPopup({ ...pop, draft: d, g: k })}>${l} · ${all.filter(c => c.group === k).length}</button>`)}</div>
        <input class="wsearch" type="search" .value=${pop.q || ""} placeholder=${t("Zoeken op naam of entiteit")} @input=${e => p.openPopup({ ...pop, draft: d, q: e.target.value })}>
        <div class="chips"><button @click=${() => upd({ never: [...new Set([...d.never, ...list.map(c => c.key)])] })}>${t("Alles verbergen")}</button><button @click=${() => upd({ never: d.never.filter(k => !list.some(c => c.key === k)) })}>${t("Alles tonen")}</button></div>
        <ul class="plist">${cut.map(c => html`<li class=${sel.has(c.key) ? "off" : ""} @click=${() => upd({ never: toggle(d.never, c.key) })}><ha-icon icon=${sel.has(c.key) ? "mdi:eye-off-outline" : "mdi:eye-outline"}></ha-icon><div>${c.title}<small>${c.sub}</small></div><span class="btns"><button><ha-icon icon=${sel.has(c.key) ? "mdi:eye-off-outline" : "mdi:eye-outline"}></ha-icon></button></span></li>`)}
          ${!list.length ? html`<li><div>${t("Niets gevonden")}</div></li>` : list.length > cut.length ? html`<li><div>${t("{n} meer: zoek om ze te vinden", { n: list.length - cut.length })}</div></li>` : nothing}</ul>`; } },
    photos: { title: t("Foto's"), body: () => html`<div class="sub">${t("Een foto per kamer als achtergrond; {slug} wordt de kamernaam (bv. woonkamer.jpg). Zonder foto krijgt elke kamer een rustige kleurverloop. Per kamer aanpassen kan later via de paginainstellingen.", { slug: "{slug}" })}</div><div class="form">
        ${field(t("Kamerfoto"), text(d.roomImage, v => upd({ roomImage: v || undefined }), "/local/images/rooms/{slug}.jpg"))}
        ${field(t("Foto startpagina"), text(d.homeImage, v => upd({ homeImage: v || undefined }), "/local/images/rooms/home.jpg"))}</div>` },
    done: { title: t("Klaar"), body: () => { const n = Object.entries(d.shown).filter(([k]) => k === "home" || d.rooms.includes(k)).reduce((a, [, l]) => a + l.length, 0);
      return html`<div class="sub">${mode === "later" ? t("De kamers staan klaar; alle pagina's zijn leeg. Vul ze later via Pagina instellen.") : curated ? t("{n} kaarten gekozen in {m} kamers.", { n, m: d.rooms.length }) : t("Alles wat gevonden wordt verschijnt vanzelf.")}</div>
        ${curated ? html`${preview()}<div class="sub" style="margin-top:12px">${t("Nieuwe apparaten verschijnen niet vanzelf: je krijgt een melding en kiest zelf.")}</div>` : nothing}
        <div class="sub" style="margin-top:12px">${t("De instellingen gelden voor deze Home Assistant-gebruiker. Voor een tweede gebruiker: exporteer ze hier en importeer ze daar (Panel instellingen › Algemeen). De assistent start altijd opnieuw via Installatiehulp.")}</div>` } },
  };
  const ids = !mode ? ["welcome"] : mode === "auto" ? ["welcome", "rooms", "devices", "photos"] : mode === "later" ? ["welcome", "rooms", "done"]
    : ["welcome", "rooms", "devices", "homecards", "status", "motion", "quick", ...d.rooms.filter(id => hass.areas?.[id]).map(id => "room:" + id), "never", "photos", "done"];
  const stepDef = id => id.startsWith("room:") ? { title: areaName(id.slice(5)), body: () => html`<div class="sub">${t("Kies welke kaarten in deze kamer staan. Standaard is niets gekozen.")}</div>${picker(cardsOf(id.slice(5)), id.slice(5), { search: true, like: true })}` } : S[id];
  const steps = mode ? ids.map(stepDef) : [S.welcome], at = Math.min(step, steps.length - 1), cur = steps[at], last = at >= steps.length - 1, blocked = at === 0 && !mode;
  return html`<div class="popup wide wiz"><h2>${t("Installatie")} · ${at + 1}${mode ? `/${steps.length}` : ""}</h2><div class="big">${cur.title}</div>
    <div class="wbody">${cur.body()}</div>
    <div class="wfoot"><span class="dots">${steps.map((_, i) => html`<i class=${i === at ? "on" : ""}></i>`)}</span>
      <div class="modes n3">${at > 0 ? html`<button @click=${() => goStep(at - 1)}>${t("Terug")}</button>` : html`<button @click=${() => p.finishWizard(null)}>${t("Overslaan")}</button>`}
        <span></span>
        <button class="on" ?disabled=${blocked} @click=${() => last ? p.finishWizard(d) : goStep(at + 1)}>${last ? t("Klaar") : t("Volgende")}</button></div></div></div>`;
}
