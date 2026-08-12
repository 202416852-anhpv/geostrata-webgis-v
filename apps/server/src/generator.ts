import {
  GeoLayer,
  Borehole,
  BoreholeSection,
  LayerPattern,
  seededGenerator,
  hashString,
  haversineDistance,
  randomOffsetPoint,
} from "@geostrata/shared";

const LAYER_CATALOG: Array<{
  name: string;
  description: string;
  color: string;
  pattern: LayerPattern;
}> = [
  { name: "Xà bần san lấp", description: "màu xám, lẫn gạch vụn, gồ ghề", color: "#8b8f96", pattern: "crosshatch" },
  { name: "Sét pha nặng", description: "màu nâu vàng - xám xanh, trạng thái dẻo mềm", color: "#c9a24b", pattern: "hatch" },
  { name: "Sét pha lẫn sạn sỏi laterit", description: "màu nâu đỏ, trạng thái nửa cứng", color: "#c96f4a", pattern: "gravel" },
  { name: "Sét pha", description: "màu nâu vàng - nâu đỏ - xám xanh, trạng thái dẻo cứng", color: "#d8b98c", pattern: "dense" },
  { name: "Sét", description: "màu nâu đỏ - nâu vàng - nâu hồng, trạng thái dẻo cứng", color: "#e8a09a", pattern: "hatch" },
  { name: "Cát pha", description: "màu nâu vàng - xám vàng, đôi chỗ lẫn sạn sỏi thạch anh", color: "#f2d07b", pattern: "sand" },
  { name: "Cát hạt mịn - trung", description: "màu xám vàng, trạng thái chặt vừa, bão hòa nước", color: "#e6d7a1", pattern: "sand" },
  { name: "Cát hạt trung - thô", description: "màu xám, trạng thái chặt, đôi chỗ lẫn dăm sạn", color: "#b7b384", pattern: "gravel" },
  { name: "Cuội sỏi", description: "màu xám tro - nâu vàng, trạng thái chặt", color: "#a8a06a", pattern: "gravel" },
];

const LAYER_COLORS = [
  "#f2d07b",
  "#c96f4a",
  "#8b8f96",
  "#e8a09a",
  "#a8a06a",
  "#e6d7a1",
  "#7f8c8d",
  "#c9a24b",
];

export function generateBoreholes(
  centerLat: number,
  centerLng: number,
  radius: number,
  count = 60
): Borehole[] {
  const random = seededGenerator(hashString(`${centerLat.toFixed(6)},${centerLng.toFixed(6)}`));
  const candidates: Array<{ lat: number; lng: number; distance: number }> = [];

  for (let i = 0; i < count * 4; i++) {
    const p = randomOffsetPoint(centerLat, centerLng, radius * 2.5, random);
    const distance = haversineDistance(centerLat, centerLng, p.lat, p.lng);
    if (distance <= radius) {
      candidates.push({ ...p, distance });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);

  return candidates.slice(0, count).map((c, i) => {
    const doSau = Math.round(20 + random() * 40);
    return {
      id: `HK-${String(i + 1).padStart(2, "0")}`,
      ten: `HK-${String(i + 1).padStart(2, "0")}`,
      lat: Number(c.lat.toFixed(6)),
      lng: Number(c.lng.toFixed(6)),
      doSau,
      distance: Number(c.distance.toFixed(1)),
    };
  });
}

export function generateLayerCode(index: number): string {
  return index === 0 ? "k" : String(index);
}

export function generateSection(borehole: Borehole, coords: { lat: number; lng: number }): BoreholeSection {
  const random = seededGenerator(hashString(borehole.id));
  const maxDepth = borehole.doSau;
  const layerCount = 6 + Math.floor(random() * 3);

  const used = new Set<number>();
  const layers: GeoLayer[] = [];
  let cursor = 0;
  let firstLayer = true;

  for (let i = 0; i < layerCount; i++) {
    let idx = Math.floor(random() * LAYER_CATALOG.length);
    if (firstLayer) {
      idx = 3 + Math.floor(random() * 4);
      firstLayer = false;
    }
    if (used.has(idx)) {
      idx = Math.floor(random() * LAYER_CATALOG.length);
    }
    used.add(idx);

    const source = LAYER_CATALOG[idx];
    const thickness = maxDepth * (0.08 + random() * 0.16);
    const top = cursor === 0 ? 0 : Number(cursor.toFixed(1));
    const bottom = Number(Math.min(maxDepth, cursor + thickness).toFixed(1));
    if (bottom - top < 0.5) continue;

    layers.push({
      code: generateLayerCode(i),
      name: source.name,
      description: source.description,
      color: LAYER_COLORS[i % LAYER_COLORS.length],
      pattern: source.pattern,
      topDepth: top,
      bottomDepth: bottom,
    });
    cursor = bottom;
    if (bottom >= maxDepth - 0.01) break;
  }

  if (layers.length === 0) {
    layers.push({
      code: "k",
      name: LAYER_CATALOG[0].name,
      description: LAYER_CATALOG[0].description,
      color: LAYER_COLORS[0],
      pattern: "crosshatch",
      topDepth: 0,
      bottomDepth: maxDepth,
    });
  }

  return {
    borehole,
    layers,
    maxDepth,
    projectName: "TRUNG TÂM ĐIỀU HÀNH CHƯƠNG TRÌNH CHỐNG NGẬP NƯỚC TP.HCM",
    locationLabel: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} - PHẦN MỀM MÔ PHỎNG ĐỊA CHẤT`,
  };
}