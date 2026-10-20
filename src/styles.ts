import { css } from "lit";

export const styles = css`
  :host {
    --nff-muted: var(--secondary-text-color, #a3acb5);
    --nff-track: var(--divider-color, rgba(160, 170, 180, 0.2));
    --nff-chip: rgba(160, 170, 180, 0.1);
    font-variant-numeric: tabular-nums;
  }
  ha-card {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .title {
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
  }
  .subtitle,
  .muted {
    color: var(--nff-muted);
  }
  .subtitle {
    font-size: 13px;
  }
  .price {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 12px;
    color: var(--nff-muted);
  }
  .price b {
    font-size: 16px;
    color: #6ca8e8;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--nff-chip);
  }
  .tabs button {
    height: 40px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--nff-muted);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button[aria-pressed="true"] {
    background: var(--primary-text-color, #eceff2);
    color: var(--card-background-color, #1b1f23);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--primary-color, #7fb2ee);
    outline-offset: 2px;
  }
  .view {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--nff-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  /* Now: flow diagram. Nodes are placed in % of a 400 x 372 box. */
  .diagram {
    position: relative;
    width: 100%;
    aspect-ratio: 400 / 372;
  }
  .diagram svg.lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .node {
    position: absolute;
    box-sizing: border-box;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid var(--nff-track);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 13px;
    font-weight: 600;
    background: var(--card-background-color, transparent);
    cursor: pointer;
  }
  .node.active {
    color: var(--primary-text-color);
  }
  .node.idle {
    color: var(--nff-muted);
  }
  .node ha-icon {
    --mdc-icon-size: 20px;
  }
  .node-label {
    position: absolute;
    font-size: 12px;
    line-height: 16px;
    color: var(--nff-muted);
  }
  .bank {
    position: absolute;
    box-sizing: border-box;
    border-radius: 18px;
    border: 2px solid #4fc1b0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--card-background-color, transparent);
  }
  .bank-cells {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  .cell {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    font-size: 12px;
    line-height: 15px;
    cursor: pointer;
  }
  .cell-icon {
    width: 13px;
    height: 34px;
    box-sizing: border-box;
    border: 2px solid var(--nff-muted);
    border-radius: 4px;
    padding: 2px;
    display: flex;
    align-items: flex-end;
  }
  .cell-icon span {
    width: 100%;
    border-radius: 1px;
  }

  .running {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
  }
  .load-tile {
    background: var(--nff-chip);
    border-radius: 12px;
    padding: 10px 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    text-align: center;
    border-top: 3px solid;
    cursor: pointer;
  }
  .load-tile ha-icon {
    --mdc-icon-size: 22px;
  }
  .others {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 16px;
    font-size: 13px;
  }
  .phases {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    font-size: 12px;
    border-top: 1px solid var(--nff-track);
    padding-top: 12px;
  }
  .phase {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .track {
    height: 8px;
    border-radius: 4px;
    background: var(--nff-track);
    overflow: hidden;
  }
  .track.small {
    width: 40px;
    height: 6px;
  }
  .track > span {
    display: block;
    height: 100%;
    border-radius: inherit;
  }

  /* Flow */
  svg.sankey {
    width: 100%;
    height: auto;
    overflow: visible;
  }
  svg.sankey text {
    font-size: 12px;
    fill: var(--primary-text-color);
  }
  svg.sankey text.head {
    font-weight: 600;
    fill: var(--nff-muted);
  }
  .battery-bars {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .battery-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    border-top: 1px solid var(--nff-track);
    padding-top: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .stat b {
    font-size: 16px;
  }

  /* Forecast */
  svg.chart {
    width: 100%;
    height: auto;
    overflow: visible;
  }
  svg.chart text {
    font-size: 11px;
    fill: var(--nff-muted);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
  }
  .tile {
    background: var(--nff-chip);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .tile b {
    font-size: 18px;
  }
  .verdict {
    font-size: 13px;
    font-weight: 600;
  }
`;
