// <hcn-cam-carousel>: one big card that shows the live image of a camera and moves on to the next one every few seconds.
// Swiping left/right jumps to the next/previous camera at once (and restarts the timer); a tap emits `cam-open` with the camera index.
// A small red pulsing dot marks the image as live. Only the visible camera is connected, so N cameras cost one stream.
import { LitElement, html, css, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import "./camsnap.js";

const EVERY = 3000, SWIPE = 40;

export class CamCarousel extends LitElement {
  static properties = { cams: { type: Array }, every: { type: Number }, live: { type: Boolean }, _i: { state: true }, _dx: { state: true } };
  static styles = css`
    :host{display:block;position:absolute;inset:0;overflow:hidden;touch-action:pan-y;cursor:pointer;color:#fff;font-family:inherit}
    .frame{position:absolute;inset:0;transition:transform .25s ease-out,opacity .25s;background:rgba(0,0,0,.25)}
    .frame.drag{transition:none}
    hcn-cam-snap{position:absolute;inset:0}
    .shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(20,20,20,.78),rgba(20,20,20,0) 55%);pointer-events:none}
    .meta{position:absolute;left:var(--cp,22px);right:calc(var(--cp,22px) + 70px);bottom:var(--cp,22px);pointer-events:none}
    .n{font-size:17px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .s{font-size:13px;font-weight:500;color:rgba(255,255,255,.7);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .live{position:absolute;top:var(--cp,22px);right:var(--cp,22px);height:36px;display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:rgba(255,255,255,.8);pointer-events:none}
    .live i{width:8px;height:8px;border-radius:50%;background:#ff453a;box-shadow:0 0 0 0 rgba(255,69,58,.6);animation:pulse 1.6s ease-out infinite}
    @keyframes pulse{70%{box-shadow:0 0 0 7px rgba(255,69,58,0)}100%{box-shadow:0 0 0 0 rgba(255,69,58,0)}}
    .dots{position:absolute;right:var(--cp,22px);bottom:calc(var(--cp,22px) + 4px);display:flex;gap:5px;align-items:center;pointer-events:none}
    .dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);transition:width .25s,background .25s}
    .dots i.on{width:16px;border-radius:3px;background:#fff}
    .off{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:rgba(255,255,255,.6)}
    @media (prefers-reduced-motion:reduce){ .frame{transition:none} .live i{animation:none} }
  `;
  constructor() { super(); this.cams = []; this.every = EVERY; this.live = true; this._i = 0; this._dx = 0; this._moved = false; }
  connectedCallback() { super.connectedCallback(); this._onVis = () => document.hidden ? this._stop() : this._start(); document.addEventListener("visibilitychange", this._onVis); this._start(); }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener("visibilitychange", this._onVis); this._stop(); }
  _start() { this._stop(); if ((this.cams?.length || 0) > 1 && !document.hidden) this._t = setInterval(() => { if (!this._down) this.go(1, false); }, this.every || EVERY); }
  _stop() { clearInterval(this._t); this._t = null; }
  updated(ch) { if (ch.has("cams") && (this.cams?.length || 0) > 1 && !this._t) this._start(); if (this._i >= (this.cams?.length || 1)) this._i = 0; }
  /** to the next (+1) or previous (-1) camera */
  go(d, restart = true) { const n = this.cams?.length || 0; if (!n) return; this._i = (this._i + d + n) % n; if (restart) this._start(); }

  _down_(e) { this._down = true; this._x0 = e.clientX; this._moved = false; this._dx = 0; this.setPointerCapture?.(e.pointerId); }
  _move(e) { if (!this._down) return; this._dx = e.clientX - this._x0; if (Math.abs(this._dx) > 6) this._moved = true; }
  _up(e) {
    if (!this._down) return; this._down = false; this.releasePointerCapture?.(e.pointerId);
    const dx = this._dx; this._dx = 0;
    if (Math.abs(dx) > SWIPE) { this.go(dx < 0 ? 1 : -1); e.stopPropagation(); return; }
    if (!this._moved) this.dispatchEvent(new CustomEvent("cam-open", { detail: { index: this._i }, bubbles: true, composed: true }));
  }

  render() {
    const cams = this.cams || [], c = cams[this._i] || null;
    if (!c) return nothing;
    const un = c.unavailable;
    return html`<div class="frame ${this._down ? "drag" : ""}" style="transform:translateX(${this._dx / 4}px)"
        @pointerdown=${this._down_} @pointermove=${this._move} @pointerup=${this._up} @pointercancel=${() => { this._down = false; this._dx = 0; }}>
      ${!un && c.src ? keyed(c.id, html`<hcn-cam-snap .src=${c.src} .stream=${c.stream} .live=${this.live && !!c.stream}></hcn-cam-snap>`) : html`<div class="off">${c.offline || ""}</div>`}
      <div class="shade"></div>
      <div class="live">${un ? nothing : html`<i></i>${c.liveLabel || "Live"}`}</div>
      <div class="meta"><div class="n">${c.name}</div><div class="s">${c.sub || ""}</div></div>
      ${cams.length > 1 ? html`<div class="dots">${cams.map((_, i) => html`<i class=${i === this._i ? "on" : ""}></i>`)}</div>` : nothing}
    </div>`;
  }
}
if (!customElements.get("hcn-cam-carousel")) customElements.define("hcn-cam-carousel", CamCarousel);
