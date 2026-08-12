import { Borehole, BoreholeSection } from "@geostrata/shared";

export interface BoreholesResponse {
  lat: number;
  lng: number;
  radius: number;
  count: number;
  boreholes: Borehole[];
}

export async function fetchBoreholes(
  lat: number,
  lng: number,
  radius: number
): Promise<BoreholesResponse> {
  const res = await fetch(
    `/api/boreholes?lat=${lat}&lng=${lng}&radius=${radius}`
  );
  if (!res.ok) throw new Error("Lỗi khi tìm lỗ khoan");
  return res.json();
}

export async function fetchSection(borehole: Borehole): Promise<BoreholeSection> {
  const res = await fetch(
    `/api/section?id=${encodeURIComponent(borehole.id)}&lat=${borehole.lat}&lng=${borehole.lng}`
  );
  if (!res.ok) throw new Error("Lỗi khi tạo mặt cắt");
  return res.json();
}