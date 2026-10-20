import { describe, expect, test } from "vitest";
import { layoutSankey, spreadLabels } from "../src/sankey";

const node = (key: string, value: number) => ({ key, label: key, value, color: "#000" });

describe("layoutSankey", () => {
  const layout = layoutSankey([node("growatt", 1686), node("victron", 265), node("solar", 0)], [node("rest", 1781), node("garage", 83), node("workshop", 87)], 200, 6);

  test("zero-value nodes are dropped", () => {
    expect(layout.sources.map((s) => s.key)).toEqual(["growatt", "victron"]);
  });

  test("bars fill the height minus gaps", () => {
    const last = layout.sinks[layout.sinks.length - 1];
    expect(last.y + last.height).toBeCloseTo(200);
  });

  test("each source is spread over the sinks in proportion", () => {
    const fromGrowatt = layout.ribbons.filter((r) => r.from === "growatt");
    const total = fromGrowatt.reduce((s, r) => s + r.value, 0);
    expect(total).toBeCloseTo(1686);
    const toGarage = fromGrowatt.find((r) => r.to === "garage")!;
    expect(toGarage.value / total).toBeCloseTo(83 / 1951);
  });

  test("ribbons stack without gaps on both sides", () => {
    const intoRest = layout.ribbons.filter((r) => r.to === "rest");
    expect(intoRest[1].y2).toBeCloseTo(intoRest[0].y3);
  });

  test("nothing flowing gives an empty layout", () => {
    expect(layoutSankey([node("a", 0)], [node("b", 0)], 200, 6).ribbons).toEqual([]);
  });
});

describe("spreadLabels", () => {
  test("labels closer than the gap are pushed down", () => {
    expect(spreadLabels([10, 12, 40], 15)).toEqual([10, 25, 40]);
  });
});
