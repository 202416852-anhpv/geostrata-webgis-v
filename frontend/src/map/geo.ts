/** Phép tính hình học trên bản đồ, dùng cho việc vẽ ranh giới. */

import type { Vertex } from "../types";

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Số mét trên một độ vĩ / kinh tại một vĩ độ, theo ellipsoid WGS84.
 *
 * Dùng hằng số xấp xỉ 111320 m/độ cho cả hai chiều thì vĩ độ sai +0.64% ở vùng
 * gần xích đạo, kéo theo diện tích lệch 0.62% so với con số PostGIS tính — đủ
 * lớn để người dùng thấy hình xem trước không khớp với diện tích sau khi lưu.
 * Khai triển chuỗi dưới đây đưa sai số xuống dưới 0.01%.
 */
function metresPerDegree(lat: number): { perLat: number; perLng: number } {
  const phi = toRad(lat);
  return {
    perLat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    perLng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

/** Dời một điểm đi (đông, bắc) mét. */
export function offsetPoint(origin: Vertex, eastM: number, northM: number): Vertex {
  const { perLat, perLng } = metresPerDegree(origin.lat);
  return {
    lat: origin.lat + northM / perLat,
    lng: origin.lng + eastM / perLng,
  };
}

/** Khoảng cách giữa hai điểm, mét. Cùng công thức haversine mà PostGIS dùng. */
export function distanceM(a: Vertex, b: Vertex): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bốn đỉnh của hình chữ nhật dựng từ hai góc đối diện, theo chiều kim đồng hồ. */
export function rectangleVertices(a: Vertex, b: Vertex): Vertex[] {
  return [
    { lat: a.lat, lng: a.lng },
    { lat: a.lat, lng: b.lng },
    { lat: b.lat, lng: b.lng },
    { lat: b.lat, lng: a.lng },
  ];
}

/**
 * Xấp xỉ hình tròn bằng đa giác đều.
 *
 * CSDL lưu ranh giới dưới dạng Polygon nên không có kiểu "hình tròn" thật.
 * Đa giác nội tiếp 32 cạnh có diện tích thấp hơn hình tròn thật khoảng 0.64%;
 * chấp nhận được với ranh giới công trình, và tăng số cạnh thì bảng đỉnh sẽ
 * dài tới mức không sửa tay được nữa.
 */
export function circleVertices(centre: Vertex, radiusM: number, segments = 32): Vertex[] {
  if (radiusM <= 0) return [];
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * 2 * Math.PI;
    return offsetPoint(centre, radiusM * Math.sin(angle), radiusM * Math.cos(angle));
  });
}

/** Diện tích đa giác trên mặt phẳng chiếu cục bộ — chỉ để xem trước trước khi lưu. */
export function approximateAreaM2(vertices: Vertex[]): number {
  if (vertices.length < 3) return 0;
  const origin = vertices[0];
  const { perLat, perLng } = metresPerDegree(origin.lat);
  const metres = vertices.map((v) => ({
    x: (v.lng - origin.lng) * perLng,
    y: (v.lat - origin.lat) * perLat,
  }));

  let sum = 0;
  for (let i = 0; i < metres.length; i += 1) {
    const current = metres[i];
    const next = metres[(i + 1) % metres.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function formatArea(areaM2: number): string {
  if (areaM2 >= 10_000) {
    return `${(areaM2 / 10_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ha`;
  }
  return `${Math.round(areaM2).toLocaleString("vi-VN")} m²`;
}
