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
  .reason {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    font-size: 13px;
    color: var(--primary-text-color);
  }
  .reason span {
    cursor: pointer;
  }
  .reason-info {
    display: inline-flex;
    padding: 2px;
    border: none;
    border-radius: 50%;
    background: none;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    color: var(--nff-muted);
    cursor: pointer;
    --mdc-icon-size: 16px;
  }
  .reason-info:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
  }
  .reason-detail {
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--nff-chip);
    font-size: 12px;
    line-height: 1.4;
    color: var(--primary-text-color);
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .node-label span {
    cursor: pointer;
  }
  .grid-label {
    white-space: nowrap;
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
  .event.expandable {
    cursor: pointer;
  }
  .vehicle-panel {
    margin-top: 8px;
    background: var(--nff-chip);
    border-radius: 12px;
    padding: 8px 10px;
  }
  .vehicle-panel .legend {
    display: flex;
    gap: 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .vehicle-links {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .vehicle-links button {
    background: none;
    border: none;
    color: var(--primary-color);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 0;
  }
  .load-line {
    font-size: 12px;
    line-height: 1.3;
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

  /* Review */
  .pills {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 999px;
    background: var(--nff-chip);
  }
  .pills button {
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--nff-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .pills button[aria-pressed="true"] {
    background: var(--nff-track);
    color: var(--primary-text-color);
  }
  .pills button:focus-visible {
    outline: 2px solid var(--primary-color, #7fb2ee);
    outline-offset: 2px;
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-radius: 14px;
    background: var(--nff-chip);
  }
  .summary > b {
    font-size: 18px;
    line-height: 24px;
  }
  .summary > span {
    font-size: 13px;
    line-height: 19px;
  }
  .review-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
    gap: 8px;
  }
  .review-tiles .stat b {
    font-size: 15px;
  }
  .review-tiles .stat .muted {
    font-size: 11px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 11px;
    color: var(--nff-muted);
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .legend i.line {
    width: 14px;
    height: 2px;
  }
  .legend i.dashed {
    height: 0;
    border-top: 2px dashed;
    background: none !important;
  }
  .legend i.mark {
    width: 14px;
    height: 5px;
  }
  .events {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .event {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 12px;
    border-left: 3px solid var(--nff-track);
    background: var(--nff-chip);
  }
  .event ha-icon {
    --mdc-icon-size: 20px;
    flex: none;
    margin-top: 1px;
  }
  .event-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .event-text {
    font-size: 12px;
    line-height: 17px;
  }
  .review-footer {
    align-items: center;
    border-top: 1px solid var(--nff-track);
    padding-top: 12px;
    font-size: 12px;
    color: var(--nff-muted);
  }
`;
