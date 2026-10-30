import { html, nothing, svg } from "lit";
import { COLORS } from "../model";
import { priceViewSnapshot } from "../snapshot";
import type { ViewContext } from "./context";

// The same data the native display draws (priceViewSnapshot), as an SVG that
// scales with the card: wide in a sections view, narrow in a column.
const W = 800;
const LEFT = 44;
const PLOT_H = 220;
const SVG_H = PLOT_H + 22;

const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

export const renderPrice = (ctx: ViewContext) => {
  const snap = priceViewSnapshot(ctx);
  if (snap.unavailable || !snap.bars) {
    return html`<div class="view"><span class="section-title">${snap.title}</span><div class="muted">${snap.unavailable}</div></div>`;
  }
  // TypeScript merges the two return shapes into one with optional fields; here all are set
  const p = snap as Required<typeof snap>;
  const n = p.bars.length;
  const pw = W - LEFT;
  const bw = pw / n;
  const y = (f: number) => PLOT_H - f * PLOT_H;
  const zero = y(p.zero);
  const sellPath = p.sell
    .map((v, i) => ({ v, x: LEFT + bw * (i + 0.5) }))
    .reduce((acc, pt, i, all) => {
      if (pt.v === null) return acc;
      const pen = i > 0 && all[i - 1].v !== null;
      return `${acc}${pen ? "L" : "M"}${pt.x.toFixed(1)} ${y(pt.v).toFixed(1)} `;
    }, "");

  return html`
    <div class="view">
      <div class="row">
        <span class="section-title">${p.title}</span>
        <span class="legend">
          ${p.legend.map(
            (g) => html`<span>
              ${g.kind === "line"
                ? html`<i class="line" style="background: ${COLORS.grid}"></i>`
                : html`<i style="background: #F0C05A"></i>`}${g.label}
            </span>`,
          )}
        </span>
      </div>
      <svg class="chart price-chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${p.title}>
        ${p.grid.map(
          (g) => svg`<line x1=${LEFT} x2=${W} y1=${y(g.f).toFixed(1)} y2=${y(g.f).toFixed(1)}
              stroke="var(--nff-track)" stroke-dasharray="3 4"></line>
            <text x="0" y=${(y(g.f) + 4).toFixed(1)}>${g.label}</text>`,
        )}
        ${p.bars.map((b, i) => {
          const top = Math.min(y(b.f), zero);
          const h = Math.max(Math.abs(y(b.f) - zero), 1);
          const opacity = i < p.now ? 0.3 : i === p.now ? 1 : 0.75;
          return svg`<rect x=${(LEFT + bw * i).toFixed(2)} y=${top.toFixed(1)} width=${Math.max(bw - (bw > 3 ? 1 : 0), 0.6).toFixed(2)}
            height=${h.toFixed(1)} fill=${hex(b.c)} fill-opacity=${opacity}><title>${b.at} ${b.text}</title></rect>`;
        })}
        <line x1=${LEFT} x2=${W} y1=${zero.toFixed(1)} y2=${zero.toFixed(1)} stroke="var(--secondary-text-color)"></line>
        ${sellPath ? svg`<path d=${sellPath} fill="none" stroke=${COLORS.grid} stroke-width="2" stroke-linejoin="round"></path>` : nothing}
        ${p.ticks.map((tk) => {
          const x = LEFT + tk.x * pw;
          return svg`${tk.day
            ? svg`<line x1=${x} x2=${x} y1="0" y2=${PLOT_H} stroke="var(--secondary-text-color)" stroke-dasharray="4 4"></line>
                <text x=${x + 5} y="12">${p.dayLabel}</text>`
            : nothing}
            <text x=${x - 7} y=${SVG_H - 4}>${tk.label}</text>`;
        })}
        ${p.nowX >= 0
          ? svg`<line x1=${LEFT + p.nowX * pw} x2=${LEFT + p.nowX * pw} y1="0" y2=${PLOT_H}
              stroke="var(--primary-text-color)" stroke-width="2"></line>`
          : nothing}
      </svg>
      <div class="tiles price-tiles">
        ${p.tiles.map(
          (tile) => html`<div class="tile">
            <span class="muted">${tile.label}</span>
            <b>${tile.value}</b>
            <span class="muted">${tile.sub}</span>
          </div>`,
        )}
      </div>
    </div>
  `;
};
