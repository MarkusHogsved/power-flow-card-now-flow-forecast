export interface SankeyNode {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface SankeyBar extends SankeyNode {
  y: number;
  height: number;
}

export interface SankeyRibbon {
  from: string;
  to: string;
  value: number;
  color: string;
  /** Top/bottom of the ribbon at the source and at the sink side. */
  y0: number;
  y1: number;
  y2: number;
  y3: number;
}

export interface SankeyLayout {
  sources: SankeyBar[];
  sinks: SankeyBar[];
  ribbons: SankeyRibbon[];
}

/**
 * Two-column Sankey: every source is spread over the sinks in proportion to
 * their size (there is no way to know which watt went where, so proportional
 * is the honest split). Sources and sinks are scaled to the larger total, so a
 * small metering mismatch leaves a gap instead of distorting the bars.
 */
export const layoutSankey = (
  sourcesIn: SankeyNode[],
  sinksIn: SankeyNode[],
  height: number,
  gap: number,
): SankeyLayout => {
  const sources = sourcesIn.filter((n) => n.value > 0);
  const sinks = sinksIn.filter((n) => n.value > 0);
  const totalSources = sources.reduce((s, n) => s + n.value, 0);
  const totalSinks = sinks.reduce((s, n) => s + n.value, 0);
  const total = Math.max(totalSources, totalSinks);
  if (total <= 0) return { sources: [], sinks: [], ribbons: [] };

  const gaps = Math.max(sources.length, sinks.length) - 1;
  const scale = (height - Math.max(gaps, 0) * gap) / total;

  const stack = (nodes: SankeyNode[]): SankeyBar[] => {
    let y = 0;
    return nodes.map((n) => {
      const bar = { ...n, y, height: n.value * scale };
      y += bar.height + gap;
      return bar;
    });
  };
  const sourceBars = stack(sources);
  const sinkBars = stack(sinks);

  const ribbons: SankeyRibbon[] = [];
  const sinkOffset = sinkBars.map(() => 0);
  for (const src of sourceBars) {
    let srcOffset = 0;
    sinkBars.forEach((sink, j) => {
      const value = (src.value * sink.value) / totalSinks;
      const h = value * scale;
      if (h <= 0) return;
      ribbons.push({
        from: src.key,
        to: sink.key,
        value,
        color: src.color,
        y0: src.y + srcOffset,
        y1: src.y + srcOffset + h,
        y2: sink.y + sinkOffset[j],
        y3: sink.y + sinkOffset[j] + h,
      });
      srcOffset += h;
      sinkOffset[j] += h;
    });
  }
  return { sources: sourceBars, sinks: sinkBars, ribbons };
};

/** Pushes label centres apart so 12 px labels never overlap. */
export const spreadLabels = (centres: number[], minGap: number): number[] => {
  const out = [...centres];
  for (let i = 1; i < out.length; i++) {
    if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
  }
  return out;
};
