// What the setup assistant works out from Home Assistant itself: devices without a room (and which room their name points to),
// which sensor plays which energy role, and which detections (person, vehicle, …) belong to a camera.
import { domain } from "./util.js";
import { t } from "./i18n.js";

const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const SEP = /\s+[-–—:]\s+|\s*[|/]\s*/;
const ROOMY = ["light", "switch", "cover", "climate", "media_player", "fan", "lock", "camera", "binary_sensor", "sensor", "humidifier", "vacuum", "input_boolean"];

/** "Eingang - Spot OL" → { prefix: "Eingang", rest: "Spot OL" } */
export function splitName(n) { const m = String(n || "").split(SEP); return m.length > 1 && m[0].trim() ? { prefix: m[0].trim(), rest: m.slice(1).join(" - ").trim() } : null; }

/** devices and loose entities (helper groups, templates) that sit in no area, each with the area its name suggests.
    `area` = an existing area id, `newArea` = a room to create (two or more devices share a prefix no area has). */
export function suggestAreas(hass) {
  const areas = Object.values(hass.areas || {}), byNorm = new Map();
  for (const a of areas) { byNorm.set(norm(a.name), a.area_id); for (const al of a.aliases || []) byNorm.set(norm(al), a.area_id); }
  const ents = Object.values(hass.entities || {}).filter(e => !e.hidden && !e.disabled_by && !e.entity_category && ROOMY.includes(domain(e.entity_id)));
  const byDev = new Map();
  for (const e of ents) if (e.device_id) { if (!byDev.has(e.device_id)) byDev.set(e.device_id, []); byDev.get(e.device_id).push(e); }
  const items = [];
  for (const [id, list] of byDev) {
    const d = hass.devices?.[id]; if (!d || d.area_id || d.disabled_by || d.entry_type === "service") continue;
    if (list.every(e => e.area_id)) continue;                               // every entity has its own room already
    const name = d.name_by_user || d.name || id, sp = splitName(name);
    items.push({ kind: "device", id, name, count: list.length, prefix: sp?.prefix || null, area: sp ? byNorm.get(norm(sp.prefix)) || null : null, newArea: null, on: true });
  }
  for (const e of ents) {
    if (e.device_id || e.area_id) continue;
    const s = hass.states[e.entity_id]; if (!s) continue;
    const name = s.attributes.friendly_name || e.name || e.entity_id, sp = splitName(name);
    items.push({ kind: "entity", id: e.entity_id, name, count: 1, prefix: sp?.prefix || null, area: sp ? byNorm.get(norm(sp.prefix)) || null : null, newArea: null, on: true });
  }
  // a prefix that matches no area but is shared by two or more devices: propose a new room
  const loose = new Map();
  for (const it of items) if (!it.area && it.prefix) { const k = norm(it.prefix); if (!loose.has(k)) loose.set(k, []); loose.get(k).push(it); }
  for (const list of loose.values()) if (list.length >= 2) for (const it of list) it.newArea = list[0].prefix;
  for (const it of items) if (!it.area && !it.newArea) it.on = false;      // nothing to go on: left out unless the person picks a room
  return items.sort((a, b) => (a.area || a.newArea || "~").localeCompare(b.area || b.newArea || "~") || a.name.localeCompare(b.name));
}

/** write the accepted suggestions into Home Assistant (device/entity registry, new areas first) */
export async function applyAreas(hass, items) {
  const made = new Map(), done = [];
  for (const it of items) {
    let area = it.area;
    if (!area && it.newArea) {
      const k = norm(it.newArea);
      if (!made.has(k)) { const r = await hass.callWS({ type: "config/area_registry/create", name: it.newArea }); made.set(k, r.area_id); }
      area = made.get(k);
    }
    if (!area) continue;
    if (it.kind === "device") await hass.callWS({ type: "config/device_registry/update", device_id: it.id, area_id: area });
    else await hass.callWS({ type: "config/entity_registry/update", entity_id: it.id, area_id: area });
    done.push(it);
  }
  return done;
}

/* ---------- energy ---------- */
export const energyRoles = () => [
  { group: "now", key: "power", label: t("Huisverbruik"), sub: t("wat het huis nu trekt"), unit: "W", re: /load.?power|house.?(power|consumption)|home.?(power|consumption)|huisverbruik|hausverbrauch|consumption.?power|verbrauch.?(leistung)?$|^power$|\bp1\b.*power/i },
  { group: "now", key: "pv", label: t("Zonne-opbrengst"), sub: "", unit: "W", re: /total.?dc.?power|pv.?power|solar.?power|pv.?leistung|zonne|production.?power|generation.?power|^(?!.*daily).*pv.*(power|leistung)/i },
  { group: "now", key: "import", label: t("Van het net"), sub: "", unit: "W", re: /import.?power|grid.?(import|purchase|consumption)|purchased.?power|netzbezug|afname/i },
  { group: "now", key: "export", label: t("Naar het net"), sub: "", unit: "W", re: /export.?power|feed.?in|einspeis|grid.?export|teruglever/i },
  { group: "now", key: "battery", label: t("Batterij stand"), sub: "", unit: "%", re: /battery.?level|state.?of.?charge|soc|batterie.?stand|speicher.?stand|battery.?capacity/i },
  { group: "now", key: "batteryPower", label: t("Batterij vermogen"), sub: "", unit: "W", re: /battery.?(power|charg|discharg)|charg(e|ing).*discharg|batterie.?leistung/i },
  { group: "day", key: "today", label: t("Verbruik vandaag"), sub: "", unit: "kWh", re: /daily.?(consum|load)|consumed.?energy|verbrauch.?heute|energy.?today.*(consum|load)|usage.?today/i },
  { group: "day", key: "pvToday", label: t("Zonne-opbrengst vandaag"), sub: "", unit: "kWh", re: /daily.?(pv|generat|yield|produc)|pv.?(today|yield|generation)|solar.*(today|daily)|ertrag/i },
  { group: "day", key: "importToday", label: t("Van het net vandaag"), sub: "", unit: "kWh", re: /daily.?(import|purchas)|import.*(today|daily)|bezug.?heute/i },
  { group: "day", key: "exportToday", label: t("Teruggeleverd vandaag"), sub: "", unit: "kWh", re: /daily.?(export|feed)|export.*(today|daily)|einspeis.*heute|teruglever.*vandaag/i },
];
const unitOf = s => s.attributes.unit_of_measurement;
const fits = (role, s) => domain(s.entity_id) === "sensor" && (role.unit === "W" ? ["W", "kW"].includes(unitOf(s)) : role.unit === "kWh" ? ["kWh", "Wh", "MWh"].includes(unitOf(s)) : role.unit === "%" ? unitOf(s) === "%" : true);
/** every sensor that could play a role, with the best guess first and whether it was a name match ("erkannt") or only a unit match ("prüfen") */
export function energyCandidates(hass, role) {
  const all = Object.values(hass.states).filter(s => fits(role, s) && !hass.entities?.[s.entity_id]?.hidden);
  const hit = all.filter(s => role.re.test(`${s.attributes.friendly_name || ""} ${s.entity_id}`));
  return { list: [...hit, ...all.filter(s => !hit.includes(s))].sort((a, b) => (hit.includes(b) - hit.includes(a)) || (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id)), best: hit[0] || null };
}
/** the roles pre-filled from names; battery stays empty unless the same device also reports solar power */
export function detectEnergy(hass, cur = {}) {
  const out = { ...cur };
  for (const r of energyRoles()) if (!out[r.key]) { const c = energyCandidates(hass, r).best; if (c) out[r.key] = c.entity_id; }
  return out;
}

/* ---------- cameras ---------- */
const DET = [["person", /person|persoon|mensch|personne|people/i], ["vehicle", /vehicle|fahrzeug|voertuig|auto|car\b|truck|kenteken|license/i], ["animal", /animal|tier|dier|pet\b|dog|cat\b|hund|katze/i]];
/** detection sensors that belong to a camera (same device): person, vehicle, animal, motion */
export function camDetections(hass, camId) {
  const dev = hass.entities?.[camId]?.device_id; if (!dev) return [];
  const own = Object.values(hass.entities).filter(e => e.device_id === dev && !e.hidden && (domain(e.entity_id) === "binary_sensor" || domain(e.entity_id) === "event"));
  const out = [];
  for (const e of own) {
    const s = hass.states[e.entity_id]; if (!s) continue;
    const text = `${s.attributes.friendly_name || ""} ${e.entity_id}`, dc = s.attributes.device_class;
    const hit = DET.find(([, re]) => re.test(text));
    if (hit) out.push({ kind: hit[0], id: e.entity_id });
    else if (["motion", "occupancy", "moving", "sound"].includes(dc) || /motion|beweging|bewegung|doorbell|deurbel|klingel|ring/i.test(text)) out.push({ kind: /doorbell|deurbel|klingel|ring/i.test(text) ? "bell" : "motion", id: e.entity_id });
  }
  return out;
}
