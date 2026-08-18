/**
 * Ký hiệu địa chất vẽ bằng SVG <pattern>.
 *
 * Trước đây các ký hiệu này là chuỗi HTML nhồi qua `dangerouslySetInnerHTML`.
 * Nay là JSX thật: React kiểm tra được kiểu, không còn bề mặt chèn HTML thô,
 * và mọi thuộc tính SVG dùng đúng dạng camelCase mà React yêu cầu.
 */

import { useId, type ReactElement } from "react";
import type { LayerPattern } from "../types";

export const PATTERN_SIZES: Record<LayerPattern, { w: number; h: number }> = {
  hatch: { w: 10, h: 10 },
  crosshatch: { w: 12, h: 12 },
  gravel: { w: 16, h: 16 },
  dense: { w: 8, h: 8 },
  dots: { w: 14, h: 14 },
  sand: { w: 20, h: 20 },
};

const PATTERN_SHAPES: Record<LayerPattern, ReactElement> = {
  hatch: (
    <>
      <path d="M-2,2 L4,-4 M0,10 L10,0 M6,12 L12,6" stroke="#000" strokeWidth={0.8} />
      <path d="M-3,3 L3,-3 M0,12 L12,0 M9,15 L15,9" stroke="#333" strokeWidth={0.7} />
    </>
  ),
  crosshatch: (
    <>
      <path d="M0,0 L12,12 M12,0 L0,12" stroke="#555" strokeWidth={0.7} />
      <circle cx={6} cy={6} r={0.8} fill="#333" />
    </>
  ),
  gravel: (
    <>
      <path d="M-4,4 L4,-4 M0,16 L16,0 M12,20 L20,12" stroke="#000" strokeWidth={0.8} />
      <circle cx={4} cy={10} r={1} fill="none" stroke="#000" strokeWidth={0.6} />
      <path d="M10,4 L12,7 L8,7 Z" fill="none" stroke="#000" strokeWidth={0.6} />
    </>
  ),
  dense: <path d="M-2,2 L4,-4 M0,8 L8,0 M6,10 L10,6" stroke="#000" strokeWidth={0.8} />,
  dots: <path d="M-3,3 L3,-3 M0,14 L14,0 M11,17 L17,11" stroke="#333" strokeWidth={0.7} />,
  sand: (
    <>
      <path
        d="M-5,5 L5,-5 M0,20 L20,0 M15,25 L25,15"
        stroke="#777"
        strokeDasharray="2,3"
        strokeWidth={0.6}
      />
      <circle cx={3} cy={5} r={0.7} fill="#444" />
      <circle cx={12} cy={15} r={0.7} fill="#444" />
      <path d="M14,6 L17,4 L16,8 Z" fill="none" stroke="#444" strokeWidth={0.5} />
    </>
  ),
};

export const PATTERN_NAMES = Object.keys(PATTERN_SIZES) as LayerPattern[];

/** id hợp lệ cho `url(#...)`: useId() trả về chuỗi có dấu ":". */
export function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

export function patternUrl(uid: string, pattern: LayerPattern): string {
  return `url(#${uid}-pat-${pattern})`;
}

/** Khai báo toàn bộ pattern một lần cho bản vẽ chính. */
export function PatternDefs({ uid }: { uid: string }) {
  return (
    <>
      {PATTERN_NAMES.map((name) => (
        <pattern
          key={name}
          id={`${uid}-pat-${name}`}
          width={PATTERN_SIZES[name].w}
          height={PATTERN_SIZES[name].h}
          patternUnits="userSpaceOnUse"
        >
          {PATTERN_SHAPES[name]}
        </pattern>
      ))}
    </>
  );
}

/** Ô ký hiệu nhỏ trong bảng chú thích; tự mang defs riêng nên độc lập hoàn toàn. */
export function PatternSwatch({
  pattern,
  color,
}: {
  pattern: LayerPattern;
  color: string;
}) {
  const uid = useSvgId();
  const size = PATTERN_SIZES[pattern];
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 60 38"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={`${uid}-swatch`}
          width={size.w}
          height={size.h}
          patternUnits="userSpaceOnUse"
        >
          {PATTERN_SHAPES[pattern]}
        </pattern>
      </defs>
      <rect width={60} height={38} fill={color} />
      <rect width={60} height={38} fill={`url(#${uid}-swatch)`} />
    </svg>
  );
}
