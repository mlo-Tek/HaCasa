// <hcn-fit w="1440" h="860">: shows its content at a fixed "virtual screen" size and scales it down to the width available,
// so the setup assistant can show the real HaCasa page (real cards, real fonts) as a live preview. The element's own height follows the scale.
import { LitElement, html, css } from "lit";

export class Fit extends LitElement {
  static properties = { w: { type: Number }, h: { type: Number }, _k: { state: true } };
  static styles = css`
    :host{display:block;position:relative;overflow:hidden;width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 30px rgba(0,0,0,.25);background:#222}
    .stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;pointer-events:none;user-select:none}
  `;
  constructor() { super(); this.w = 1440; this.h = 860; this._k = 0; }
  connectedCallback() { super.connectedCallback(); this._ro = new ResizeObserver(() => this._fit()); this._ro.observe(this); }
  disconnectedCallback() { super.disconnectedCallback(); this._ro?.disconnect(); }
  updated() { this._fit(); }
  _fit() { const k = this.clientWidth / this.w; if (k && Math.abs(k - this._k) > 0.0005) this._k = k; }
  render() {
    const k = this._k || 0.0001;
    this.style.height = `${Math.ceil(this.h * k)}px`;
    return html`<div class="stage" style="width:${this.w}px;height:${this.h}px;transform:scale(${k})"><slot></slot></div>`;
  }
}
if (!customElements.get("hcn-fit")) customElements.define("hcn-fit", Fit);
