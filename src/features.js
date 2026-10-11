// Quick actions, doorbell/motion camera pop-up, pending updates and per-room light presets.
import { t, locale } from "./i18n.js";
import { html, nothing } from "lit";
import { SUFFIX, VERSION, domain, isOn, unavailable } from "./util.js";
import { pressDir } from "./cards.js";

/* ---------- quick actions (home view) ---------- */
export const QUICK_TYPES = { scene: t("Scène"), script: t("Script"), entity: t("Schakelen"), lights_off: t("Alle lampen uit"), media_off: t("Media uit") };
const QUICK_ICON = { scene: "mdi:palette-outline", script: "mdi:script-text-outline", entity: "mdi:toggle-switch-outline", lights_off: "mdi:lightbulb-off-outline", media_off: "mdi:stop-circle-outline" };
export const QUICK_DOMAINS = ["light", "switch", "input_boolean", "fan", "media_player", "cover", "lock", "automation"];

export function runQuick(p, q) {
  const go = () => {
    if (q.type === "scene") return p.call("scene", "turn_on", { entity_id: q.entity });
    if (q.type === "script") return p.call("script", "turn_on", { entity_id: q.entity });
    if (q.type === "entity") return p.call("homeassistant", "toggle", { entity_id: q.entity });
    if (q.type === "lights_off") { const ids = p.home.lightsOn.map(e => e.id); return ids.length ? p.call("light", "turn_off", { entity_id: ids }) : p.showToast("Alle lampen zijn al uit"); }
    if (q.type === "media_off") { const ids = Object.values(p.hass.states).filter(s => domain(s.entity_id) === "media_player" && !["off", "standby", "unavailable", "unknown"].includes(s.state)).map(s => s.entity_id); return ids.length ? p.call("media_player", "turn_off", { entity_id: ids }) : p.showToast("Er speelt niets"); }
  };
  if (q.confirm) p.openPopup({ type: "confirm", title: t("Snelle actie"), big: q.label, sub: t("Weet je het zeker?"), okLabel: t("Ja"), ok: go });
  else go();
}
const quickOn = (p, q) => q.type === "entity" ? isOn(p.hass.states[q.entity]) : q.type === "lights_off" ? false : q.type === "media_off" ? false : false;
export function quickRow(p) {
  const list = (p.config.home?.quick || []).filter(q => q.label && (q.type === "lights_off" || q.type === "media_off" || q.entity));
  if (!list.length) return nothing;
  return html`<div class="quick">${list.map(q => html`<button class=${quickOn(p, q) ? "on" : ""} @click=${() => runQuick(p, q)}><ha-icon icon=${q.icon || QUICK_ICON[q.type] || "mdi:flash-outline"}></ha-icon><span>${q.label}</span></button>`)}</div>`;
}

/* ---------- doorbell / motion: open the camera when a trigger fires ---------- */
/** every rule "this trigger opens that camera": the classic doorbell setting plus the per-camera detections from the setup (home.cams[].popup) */
export function camRules(p) {
  const bell = p.config.home?.doorbell, secs = bell?.seconds || 30, rules = [];
  if (bell?.camera && bell.triggers?.length) rules.push({ camera: bell.camera, triggers: bell.triggers, seconds: secs });
  for (const c of p.config.home?.cams || []) if (c.camera && c.popup?.length) rules.push({ camera: c.camera, triggers: c.popup, seconds: secs });
  return rules;
}
export function watchTriggers(p) {
  const rules = camRules(p), ids = [...new Set(rules.flatMap(r => r.triggers))];
  if (!ids.length) { p._trigPrev = null; return; }
  const prev = p._trigPrev, cur = {}; let fired = null;
  for (const id of ids) {
    const s = p.hass.states[id]; if (!s) continue;
    cur[id] = domain(id) === "event" ? s.state : isOn(s);           // event entities: the state is the time of the last event
    if (prev && prev[id] !== undefined && cur[id] !== prev[id] && (domain(id) === "event" || cur[id] === true)) fired = s;
  }
  p._trigPrev = cur;
  if (!fired) return;
  const rule = rules.find(r => r.triggers.includes(fired.entity_id)), cam = rule && p.hass.states[rule.camera]; if (!cam) return;
  p.wake();
  p.openPopup({ type: "camera", s: cam, auto: true, by: fired.attributes.friendly_name || fired.entity_id });
  clearTimeout(p._autoT);
  p._autoT = setTimeout(() => { if (p.popup?.auto) p.popup = null; }, (rule.seconds || 30) * 1000);
}
/** candidates for the trigger chips: doorbell-like binary sensors and event entities */
export const triggerCandidates = hass => Object.values(hass.states).filter(s => (domain(s.entity_id) === "binary_sensor" && ["occupancy", "motion", "sound", "vibration", "door", "opening", undefined].includes(s.attributes.device_class)) || domain(s.entity_id) === "event")
  .sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id, "nl"));

/* ---------- pending updates ---------- */
export function pendingUpdates(hass) {
  return Object.values(hass.states)
    .filter(s => domain(s.entity_id) === "update" && s.state === "on" && !(s.attributes.skipped_version && s.attributes.skipped_version === s.attributes.latest_version))
    .map(s => ({ s, id: s.entity_id, title: s.attributes.title || (s.attributes.friendly_name || s.entity_id).replace(/ update$/i, ""), kind: s.attributes.device_class === "firmware" ? t("Firmware") : t("Software"),
      from: s.attributes.installed_version, to: s.attributes.latest_version, busy: !!s.attributes.in_progress, canInstall: (s.attributes.supported_features & 1) === 1, summary: s.attributes.release_summary }))
    .sort((a, b) => a.title.localeCompare(b.title, "nl"));
}
export function installUpdate(p, u) {
  if (!u.canInstall) return p.moreInfo(u.id);
  p.openPopup({ type: "confirm", title: t("Update installeren"), big: u.title, sub: `${u.from || "?"} → ${u.to || "?"}${u.summary ? " · " + u.summary.replace(/\s+/g, " ").slice(0, 160) : ""}`, okLabel: t("Installeren"), ok: () => p.call("update", "install", { entity_id: u.id }) });
}

/* ---------- light presets per room (saved light states, stored with the user settings) ---------- */
export const roomPresets = (p, r) => (p.config.presets || {})[r.id] || [];
export function snapshot(p, r) {
  const st = {};
  for (const e of r.ents.lights) {
    const s = p.hass.states[e.id]; if (!s || unavailable(s)) continue;
    const a = s.attributes;
    st[e.id] = !isOn(s) ? { on: false } : { on: true,
      ...(a.brightness != null && { brightness: a.brightness }),
      ...(a.color_mode === "color_temp" && a.color_temp_kelvin && { color_temp_kelvin: a.color_temp_kelvin }),
      ...(["hs", "rgb", "xy", "rgbw", "rgbww"].includes(a.color_mode) && a.hs_color && { hs_color: a.hs_color }) };
  }
  return st;
}
export function applyPreset(p, pr) {
  const off = Object.entries(pr.states).filter(([, v]) => !v.on).map(([id]) => id);
  if (off.length) p.call("light", "turn_off", { entity_id: off });
  for (const [id, v] of Object.entries(pr.states)) if (v.on) { const { on, ...data } = v; p.call("light", "turn_on", { entity_id: id, ...data }); }
}
/** true when every light in the preset is currently on/off as the preset says (brightness/colour not compared) */
export const presetMatches = (p, pr) => { const ids = Object.keys(pr.states); return ids.length > 0 && ids.every(id => { const s = p.hass.states[id]; return s && isOn(s) === !!pr.states[id].on; }); };
export function presetCard(p, r) {
  const list = roomPresets(p, r);
  return html`<div class="card scenes presets" ${pressDir(p, { tap: () => p.openPopup({ type: "presets", roomId: r.id }) })}>
    <div class="n">${t("Lichtscènes")}</div>
    <div class="s">${list.map(pr => html`<button class=${presetMatches(p, pr) ? "on" : ""} title=${pr.name} @click=${ev => { ev.stopPropagation(); applyPreset(p, pr); }}><ha-icon icon=${pr.icon || "mdi:lightbulb-group-outline"}></ha-icon></button>`)}
      <button class="add" title=${t("Huidige stand opslaan")} @click=${ev => { ev.stopPropagation(); p.openPopup({ type: "presets", roomId: r.id, form: true }); }}><ha-icon icon="mdi:plus"></ha-icon></button></div>
  </div>`;
}

export const featureStyles = `
  .offline{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:80;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;background:rgba(242,122,92,.95);color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:fadeIn .3s ease-out both}
  .offline ha-icon{--mdc-icon-size:18px}
  .title:has(.quick){transform:translateY(-56%)}
  @media (max-height:620px){ .title:has(.quick){transform:translateY(-64%)} .quick{margin-top:10px} }
  .quick{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0 5px;max-width:640px}
  .quick button{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px 0 12px;border:0;border-radius:999px;background:rgba(255,255,255,.14);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;font:inherit;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .quick button:active{background:rgba(255,255,255,.3)}
  .quick button.on{background:rgba(255,255,255,.4)}
  .quick button ha-icon{--mdc-icon-size:18px}
  .card.presets .s button.add{background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
  .popup .fc.hours{display:flex;overflow-x:auto;scrollbar-width:none}
  .popup .fc.hours>div{flex:1 0 60px}
  .popup .fc div img.ico{width:24px;height:24px;margin:6px auto;display:block}
  .popup .fc div.today{background:rgba(255,255,255,.22)}
  .popup .confirm-text{white-space:pre-line}
  /* ---------- setup assistant ---------- */
  .popup.wz{width:min(1240px,calc(100vw - 48px));max-width:none;height:min(820px,calc(100vh - 48px));height:min(820px,calc(100dvh - 48px));max-height:none;box-sizing:border-box;padding:24px 28px 20px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:14px;overflow:hidden;background:rgba(38,42,46,.78)}
  .wz header .wzeye{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;opacity:.65}
  .wz header h2{margin:6px 0 0;display:block;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.5px;text-transform:none}
  .wz header p{margin:6px 0 0;font-size:14px;opacity:.75;max-width:900px}
  .wzb{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.08fr);gap:22px;min-height:0}
  .wz.three .wzb{grid-template-columns:170px minmax(0,1fr) minmax(0,.9fr)}
  .wzc{min-height:0;min-width:0;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent;padding:3px 6px 8px 3px}
  .wz ul{margin-top:6px}
  .wz .wzl li,.wz .wzsort li{padding:9px 12px 9px 14px;gap:12px;font-size:14px}
  .wz .wzl li small,.wz .wzsort li small{overflow-wrap:anywhere}
  .wz footer .modes.n3{grid-template-columns:1fr auto 1fr;align-items:center;margin-top:0}
  .wz footer .modes.n3 button{padding:14px 26px;justify-self:start}
  .wz footer .modes.n3 button.on{justify-self:end}
  .wz footer .modes button:disabled{opacity:.35;pointer-events:none}
  .wz .dots{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
  .wz .dots i{width:8px;height:8px;border-radius:50%;background:#fff;opacity:.3}
  .wz .dots i.on{opacity:1}
  .wz select,.wz input[type=text]{border:0;border-radius:var(--r-sm);padding:8px 10px;background:rgba(0,0,0,.3);color:#fff;font:inherit;font-size:13px;color-scheme:dark;min-width:0;max-width:100%;outline:none}
  .wz select option{background:#2b2b2b;color:#fff}
  .wz .chips{margin-top:0;gap:5px}
  .wz .chips button{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wz .chips button.off{opacity:.5}
  .wzh{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;opacity:.65;margin:16px 0 6px}
  .wzh.first{margin-top:0}
  .wzh small{display:block;text-transform:none;letter-spacing:0;font-weight:500;margin-top:2px}
  .wznote{font-size:12px;opacity:.7;line-height:1.45;margin:8px 0 0}
  .wzrt{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase}
  .wzrt>span:first-child{opacity:.8}
  .wzrt:not(:first-child){margin-top:14px}
  .wztag{background:var(--accent);color:#2b2100;padding:4px 10px;border-radius:999px;letter-spacing:.8px;white-space:nowrap}
  .wzpop .popup .big{font-size:26px;margin:0;letter-spacing:-.5px}
  .wzpop .popup h2{font-size:12px}
  .wzpop .popup .sub{margin-bottom:4px;font-size:12px}
  .wzpop .popup .modes{margin-top:8px}
  .wzpop .popup .modes button{padding:10px 0}
  .wzpop .popup li{padding:8px 12px}
  .wzpop .popup img.stream{width:100%;max-height:140px;object-fit:cover;border-radius:var(--r-sm)}
  .wzpop .popup{width:auto;min-width:0;max-width:none;max-height:none;overflow:visible;padding:16px 18px;animation:none;box-sizing:border-box}
  .wzpv,.wzpop{pointer-events:none;user-select:none}
  .wzg{border:1px solid var(--line);border-radius:10px;padding:6px;margin-top:8px;background:rgba(255,255,255,.04)}
  .wzg:first-child{margin-top:0}
  .wzg.sel{box-shadow:0 0 0 2px var(--accent) inset}
  .wzg.off{opacity:.6}
  .wzg ul{margin-top:0}
  .wzcap{display:flex;align-items:center;gap:10px;padding:8px 8px 4px;flex-wrap:wrap}
  .wzcap>span{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.65;white-space:nowrap}
  .wzcap small{font-size:12px;opacity:.65}
  .wzchip{display:inline-flex;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.2);font-size:12px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wzmore{font-size:12px;opacity:.65;padding:7px 4px}
  .wzsort{list-style:none;display:flex;flex-direction:column;gap:4px}
  .wzsort li{display:grid;grid-template-columns:14px minmax(0,1fr) max-content;align-items:center;cursor:grab;position:relative}
  .wzsort li.on{background:rgba(255,255,255,.2)}
  .wzsort li:not(.on){opacity:.55}
  .wzsort li.drag{opacity:.35}
  .wzsort li.ins-top{box-shadow:0 -3px 0 #fff}
  .wzsort li.ins-bot{box-shadow:0 3px 0 #fff}
  .wzgrip{width:14px;height:22px;background:radial-gradient(circle,rgba(255,255,255,.55) 1.4px,transparent 1.6px) 0 0/7px 7px;opacity:.8}
  .wzbtns{display:flex;gap:4px}
  .wzarr{width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;display:grid;place-items:center;padding:0}
  .wzarr:disabled{opacity:.3;cursor:default}
  .wzarr ha-icon{--mdc-icon-size:18px}
  .wzren{width:100%;box-sizing:border-box}
  .wzsteps li{grid-template-columns:34px minmax(0,1fr)}
  .wzsteps li b,.wzsum li b{font-size:20px;font-weight:600}
  .wzsum li{grid-template-columns:44px minmax(0,1fr) max-content}
  .wzsug li{grid-template-columns:24px minmax(0,1fr) minmax(130px,190px);align-items:center}
  .wzsug input[type=checkbox]{accent-color:#fff;width:18px;height:18px}
  .wzsug li:not(.on){opacity:.65}
  .wzrooms li{grid-template-columns:minmax(0,1fr) max-content;padding:9px 12px}
  .wzsec{margin-top:8px;padding-top:7px;border-top:1px solid var(--line)}
  .wzsh{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.7;margin-bottom:6px}
  .wzgl{font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.6px}
  .wz .form .f.wzfoc{box-shadow:0 0 0 2px var(--accent) inset}
  .wzsel{display:flex;align-items:center;gap:8px;min-width:0}
  .wzsel select{flex:1}
  .wzsel b{margin-left:auto;font-size:12px;white-space:nowrap;font-weight:600}
  .wzok,.wzwn{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}
  .wzok{color:#8fd16a}
  .wzwn{color:var(--accent)}
  .wzstage{position:relative;overflow:hidden;isolation:isolate;font-family:var(--font);color:var(--fg)}
  @media (max-width:900px){
    .popup.wz{width:calc(100vw - 16px);height:calc(100vh - 16px);height:calc(100dvh - 16px);padding:16px 16px 14px}
    .wz header h2{font-size:22px}
    .wzb,.wz.three .wzb{display:block;overflow:auto;scrollbar-width:thin}
    .wzc{overflow:visible;padding:0}
    .wzr{margin-top:18px}
    .wz.three .wzl1{margin-bottom:12px}
    .wzsug li{grid-template-columns:24px minmax(0,1fr)}
    .wzsug select{grid-column:2}
  }
  .popup li img.avatar{width:34px;height:34px;border-radius:50%;object-fit:cover;margin-left:-2px}
  .popup .form.lines .lrow{display:grid;grid-template-columns:150px 1fr max-content;gap:6px;margin-top:4px}
  .popup .form.lines .lrow button,.popup .form.lines .addline{border:0;border-radius:var(--r-sm);background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:12px;font-weight:700;padding:9px 12px;cursor:pointer}
  .popup .form.lines .addline{margin-top:6px}
  .popup .plist li{grid-template-columns:30px 1fr max-content;padding:10px 12px 10px 16px;font-size:14px}
  .popup .plist li.off{opacity:.45}
  .popup .plist li .btns{display:flex;gap:4px}
  .popup .plist li .btns button{width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-weight:700;cursor:pointer;display:grid;place-items:center}
  .popup .plist li .btns button:disabled{opacity:.3;cursor:default}
  .popup .plist li .btns button ha-icon{--mdc-icon-size:18px}
  .popup .form .f small{display:block;font-size:11px;font-weight:500;opacity:.65}
  .popup .form .f button{border:0;border-radius:var(--r-sm);background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:12px;font-weight:700;padding:9px 12px;cursor:pointer;justify-self:start}
  .popup .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .popup .chips button{border:0;border-radius:999px;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-size:12px;font-weight:600;padding:8px 12px;cursor:pointer;opacity:.6}
  .popup .chips button.on{background:rgba(255,255,255,.35);opacity:1}
  .settings input[type=file]{padding:7px 10px;font-size:12px}
  .settings input[type=checkbox]{width:auto;justify-self:start;accent-color:#fff;transform:scale(1.2)}
  .settings .row.quick{grid-template-columns:1.2fr 1fr 1fr 1.4fr max-content max-content;align-items:center}
  .settings .row.quick label{display:flex;align-items:center;gap:4px;font-size:11px;opacity:.8;white-space:nowrap}
  @media (max-width:900px){
    .quick{margin:12px 0 0 2px}
    .quick button{height:34px;font-size:11px;padding:0 12px 0 10px}
    .settings .row.quick{grid-template-columns:1fr 1fr}
  }
`;

/* ---------- a newer HaCasa Nova ---------- */
const REPO = "damianeickhoff/HaCasa";
const parts = v => String(v || "").replace(/^v/, "").split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
/** true when version a is newer than b ("v3.0.5" > "3.0.4") */
export const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
/** the update to offer an administrator, or null: from HACS's update entity, or, for installs without HACS,
 *  GitHub's latest release (checked at most twice a day, cached per browser). Dev builds stay quiet. */
export function selfUpdate(p) {
  const hass = p.hass;
  if (!hass?.user?.is_admin || p.config.noUpdateCheck) return null;
  const ent = Object.values(hass.states).find(s => s.entity_id.startsWith("update.") && (s.entity_id === "update.hacasa_nova_update" || String(s.attributes.release_url || "").includes(REPO)));
  if (ent) return ent.state === "on" && ent.attributes.skipped_version !== ent.attributes.latest_version
    ? { to: ent.attributes.latest_version, from: ent.attributes.installed_version, open: () => p.moreInfo(ent.entity_id) } : null;
  if (SUFFIX) return null;
  checkGithub(p);
  const g = p.ghLatest;
  return g?.tag && newer(g.tag, VERSION) ? { to: g.tag, from: VERSION, open: () => window.open(g.url, "_blank", "noopener") } : null;
}
let ghBusy = false;
function checkGithub(p) {
  if (p.ghLatest !== undefined || ghBusy) return;
  ghBusy = true;
  const KEY = "hacasa-nova:latest-release";
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  if (cached && Date.now() - cached.at < 12 * 3600e3) { queueMicrotask(() => { p.ghLatest = cached; ghBusy = false; }); return; }
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then(r => (r.ok ? r.json() : null))
    .then(j => { const v = { tag: j?.tag_name || null, url: j?.html_url || `https://github.com/${REPO}/releases`, at: Date.now() }; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} p.ghLatest = v; })
    .catch(() => { p.ghLatest = null; })
    .finally(() => { ghBusy = false; });
}
