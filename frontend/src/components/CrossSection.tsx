/** Bản vẽ mặt cắt địa chất của một lỗ khoan. */

import { useMemo } from "react";
import type { BoreholeSection, GeoLayer } from "../types";
import { PatternDefs, PatternSwatch, patternUrl, useSvgId } from "./patterns";

const CANVAS_W = 640;
const CANVAS_H = 520;
const FRAME_X0 = 35;
const FRAME_X1 = 595;
const FRAME_Y0 = 30;
const FRAME_Y1 = 495;
const BOREHOLE_X = 115;
const LABEL_X = 122;
const BADGE_X = 320;

/** Bước chia trục độ sâu sao cho số vạch luôn dễ đọc. */
function depthStep(maxDepth: number): number {
  if (maxDepth <= 20) return 2;
  if (maxDepth <= 40) return 5;
  return 10;
}

export default function CrossSection({ section }: { section: BoreholeSection }) {
  const uid = useSvgId();
  const { borehole, project, layers } = section;

  const maxDepth =
    section.max_depth_m || layers.at(-1)?.bottom_depth_m || 1;
  const pxPerM = (FRAME_Y1 - FRAME_Y0) / maxDepth;
  const depthToY = (depth: number) => FRAME_Y0 + depth * pxPerM;

  const depthTicks = useMemo(() => {
    const step = depthStep(maxDepth);
    const ticks: number[] = [];
    for (let d = 0; d < maxDepth - 0.01; d += step) ticks.push(Number(d.toFixed(1)));
    ticks.push(Number(maxDepth.toFixed(1)));
    return ticks;
  }, [maxDepth]);

  const boundaries = useMemo(() => {
    const depths = layers.flatMap((l) => [l.top_depth_m, l.bottom_depth_m]);
    return [...new Set(depths)].filter((d) => d >= 0 && d <= maxDepth).sort((a, b) => a - b);
  }, [layers, maxDepth]);

  const waterLevel = borehole.water_level_m;
  const showWater = waterLevel !== null && waterLevel > 0 && waterLevel < maxDepth;
  // Hố khoan khai "chưa rõ vị trí" không có toạ độ; bản vẽ vẫn dựng bình thường.
  const hasCoordinates = borehole.lat !== null && borehole.lng !== null;

  return (
    <div className="section-widget">
      <div className="section-container">
        <header className="header">
          <h1>MẶT CẮT ĐỊA CHẤT</h1>
          <div className="info">
            {project ? (
              <>
                <div>
                  CÔNG TRÌNH: {project.name}
                  {project.built_year && ` (${project.built_year})`}
                </div>
                {project.location_label && <div>ĐỊA ĐIỂM: {project.location_label}</div>}
                {project.scale_description && <div>QUY MÔ: {project.scale_description}</div>}
              </>
            ) : (
              <div>CÔNG TRÌNH: hố khoan đơn lẻ, không thuộc công trình nào</div>
            )}
            <div className="hole-info">
              HỐ KHOAN: <strong>{borehole.name}</strong> · ĐỘ SÂU:{" "}
              <strong>{maxDepth.toFixed(1)} m</strong> · TOẠ ĐỘ:{" "}
              <strong>
                {hasCoordinates
                  ? `${borehole.lat!.toFixed(5)}, ${borehole.lng!.toFixed(5)}`
                  : "chưa xác định"}
              </strong>
              {showWater && (
                <>
                  {" "}
                  · MỰC NƯỚC NGẦM: <strong>{waterLevel.toFixed(1)} m</strong>
                </>
              )}
            </div>
            {borehole.drilling_company && <div>ĐƠN VỊ KHOAN: {borehole.drilling_company}</div>}
          </div>
          <div className="logo" aria-hidden="true">
            <span className="logo-text">PN</span>
            <span className="logo-sub">GEO</span>
          </div>
        </header>

        <div className="content">
          <div className="diagram-container">
            <svg
              width="100%"
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label={`Mặt cắt địa chất lỗ khoan ${borehole.name}, sâu ${maxDepth} mét`}
            >
              <defs>
                <pattern id={`${uid}-grid`} width={20} height={20} patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e0e0e0" strokeWidth={0.5} />
                </pattern>
                <PatternDefs uid={uid} />
              </defs>

              <rect width={CANVAS_W} height={CANVAS_H} fill={`url(#${uid}-grid)`} />
              <rect
                x={FRAME_X0}
                y={FRAME_Y0}
                width={FRAME_X1 - FRAME_X0}
                height={FRAME_Y1 - FRAME_Y0}
                fill="none"
                stroke="#000"
                strokeWidth={1.5}
              />

              {/* Lưới độ sâu */}
              <g stroke="#ccc" strokeDasharray="2,2" strokeWidth={0.5}>
                {depthTicks.map((d) => (
                  <line key={d} x1={FRAME_X0} y1={depthToY(d)} x2={FRAME_X1} y2={depthToY(d)} />
                ))}
              </g>

              {/* Nhãn độ sâu hai bên khung */}
              <g fontSize={11} fontWeight="bold" fill="#000">
                {depthTicks.map((d) => (
                  <g key={d}>
                    <text x={FRAME_X0 - 5} y={depthToY(d) + 4} textAnchor="end">
                      -{d}
                    </text>
                    <text x={FRAME_X1 + 5} y={depthToY(d) + 4} textAnchor="start">
                      -{d}
                    </text>
                  </g>
                ))}
              </g>

              {/* Thân các lớp đất: nền màu + ký hiệu chồng lên */}
              {layers.map((layer: GeoLayer) => {
                const y = depthToY(layer.top_depth_m);
                const height = depthToY(layer.bottom_depth_m) - y;
                return (
                  <g key={layer.ordinal}>
                    <rect
                      x={FRAME_X0}
                      y={y}
                      width={FRAME_X1 - FRAME_X0}
                      height={height}
                      fill={layer.color}
                    />
                    <rect
                      x={FRAME_X0}
                      y={y}
                      width={FRAME_X1 - FRAME_X0}
                      height={height}
                      fill={patternUrl(uid, layer.pattern)}
                    />
                  </g>
                );
              })}

              {/* Ranh giới lớp */}
              <g stroke="#000" strokeWidth={1.2} fill="none">
                {boundaries.map((d) => (
                  <line key={d} x1={FRAME_X0} y1={depthToY(d)} x2={FRAME_X1} y2={depthToY(d)} />
                ))}
              </g>

              {/* Mực nước ngầm */}
              {showWater && (
                <g>
                  <line
                    x1={FRAME_X0}
                    y1={depthToY(waterLevel)}
                    x2={FRAME_X1}
                    y2={depthToY(waterLevel)}
                    stroke="#1c7ed6"
                    strokeWidth={1.4}
                    strokeDasharray="8,4"
                  />
                  <path
                    d={`M ${FRAME_X1 - 26} ${depthToY(waterLevel) - 9}
                        L ${FRAME_X1 - 14} ${depthToY(waterLevel) - 9}
                        L ${FRAME_X1 - 20} ${depthToY(waterLevel)} Z`}
                    fill="#1c7ed6"
                  />
                </g>
              )}

              {/* Trục lỗ khoan */}
              <line
                x1={BOREHOLE_X}
                y1={FRAME_Y0}
                x2={BOREHOLE_X}
                y2={FRAME_Y1}
                stroke="#000"
                strokeWidth={2.5}
              />
              <line
                x1={BOREHOLE_X - 10}
                y1={FRAME_Y0}
                x2={BOREHOLE_X + 10}
                y2={FRAME_Y0}
                stroke="#000"
                strokeWidth={2}
              />
              <text
                x={BOREHOLE_X}
                y={FRAME_Y0 - 12}
                fontSize={12}
                fontWeight="bold"
                textAnchor="middle"
              >
                {borehole.name}
              </text>

              {/* Cao độ từng ranh giới */}
              <g fontSize={9.5} fill="#000">
                {boundaries.map((d) => (
                  <text key={d} x={LABEL_X} y={depthToY(d) + 3}>
                    {d.toFixed(1)}
                  </text>
                ))}
              </g>

              {/* Mã lớp */}
              {layers.map((layer, index) => {
                const yMid = (depthToY(layer.top_depth_m) + depthToY(layer.bottom_depth_m)) / 2;
                const isLast = index === layers.length - 1;
                return (
                  <g key={layer.ordinal} transform={`translate(${BADGE_X}, ${yMid})`}>
                    <rect
                      x={-8}
                      y={-8}
                      width={16}
                      height={16}
                      rx={isLast ? 3 : 8}
                      fill="white"
                      stroke="#000"
                      strokeWidth={0.8}
                    />
                    <text x={0} y={3.5} fontSize={10} fontWeight="bold" textAnchor="middle">
                      {layer.layer_code}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="legend-container">
            <div className="legend-title">Chú thích:</div>
            {layers.map((layer, index) => (
              <div className="legend-item" key={layer.ordinal}>
                <div className="legend-box">
                  <PatternSwatch pattern={layer.pattern} color={layer.color} />
                  <div
                    className="legend-badge"
                    style={{ borderRadius: index === layers.length - 1 ? 3 : "50%" }}
                  >
                    {layer.layer_code}
                  </div>
                </div>
                <div className="legend-text">
                  <strong>Lớp {layer.layer_code}:</strong> {layer.name}, {layer.description}
                  <span className="legend-depth">
                    {layer.top_depth_m.toFixed(1)} – {layer.bottom_depth_m.toFixed(1)} m (dày{" "}
                    {layer.thickness_m.toFixed(1)} m)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
