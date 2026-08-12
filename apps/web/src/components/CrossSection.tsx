import { useId, useMemo } from "react";
import { BoreholeSection, GeoLayer } from "@geostrata/shared";

interface CrossSectionProps {
  section: BoreholeSection;
}

const PATTERN_DEFS: Record<string, string> = {
  hatch: `
    <path d="M-2,2 L4,-4 M0,10 L10,0 M6,12 L12,6" stroke="#000" stroke-width="0.8"/>
    <path d="M-3,3 L3,-3 M0,12 L12,0 M9,15 L15,9" stroke="#333" stroke-width="0.7"/>`,
  crosshatch: `
    <path d="M0,0 L12,12 M12,0 L0,12" stroke="#555" stroke-width="0.7"/>
    <circle cx="6" cy="6" r="0.8" fill="#333"/>`,
  gravel: `
    <path d="M-4,4 L4,-4 M0,16 L16,0 M12,20 L20,12" stroke="#000" stroke-width="0.8"/>
    <circle cx="4" cy="10" r="1" fill="none" stroke="#000" stroke-width="0.6"/>
    <path d="M10,4 L12,7 L8,7 Z" fill="none" stroke="#000" stroke-width="0.6"/>`,
  dense: `
    <path d="M-2,2 L4,-4 M0,8 L8,0 M6,10 L10,6" stroke="#000" stroke-width="0.8"/>`,
  dots: `
    <path d="M-3,3 L3,-3 M0,14 L14,0 M11,17 L17,11" stroke="#333" stroke-width="0.7"/>`,
  sand: `
    <path d="M-5,5 L5,-5 M0,20 L20,0 M15,25 L25,15" stroke="#777" stroke-dasharray="2,3" stroke-width="0.6"/>
    <circle cx="3" cy="5" r="0.7" fill="#444"/>
    <circle cx="12" cy="15" r="0.7" fill="#444"/>
    <path d="M14,6 L17,4 L16,8 Z" fill="none" stroke="#444" stroke-width="0.5"/>`,
};

const PATTERN_SIZES: Record<string, { w: number; h: number }> = {
  hatch: { w: 10, h: 10 },
  crosshatch: { w: 12, h: 12 },
  gravel: { w: 16, h: 16 },
  dense: { w: 8, h: 8 },
  dots: { w: 14, h: 14 },
  sand: { w: 20, h: 20 },
};

const FRAME_X0 = 35;
const FRAME_X1 = 595;
const FRAME_Y0 = 30;
const FRAME_Y1 = 495;
const BOREHOLE_X = 115;
const LABEL_X = 122;
const BADGE_X = 320;

function smallLegendSvg(pattern: string) {
  const size = PATTERN_SIZES[pattern] ?? PATTERN_SIZES.hatch;
  const defs = PATTERN_DEFS[pattern] ?? PATTERN_DEFS.hatch;
  return `<svg width="100%" height="100%" viewBox="0 0 60 38" preserveAspectRatio="none">
    <defs><pattern id="legend-pat" x="0" y="0" width="${size.w}" height="${size.h}" patternUnits="userSpaceOnUse">${defs}</pattern></defs>
    <rect width="60" height="38" fill="url(#legend-pat)"/>
  </svg>`;
}

export default function CrossSection({ section }: CrossSectionProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { borehole, layers, projectName, locationLabel } = section;

  const maxDepth = section.maxDepth || layers[layers.length - 1].bottomDepth;
  const pxPerM = (FRAME_Y1 - FRAME_Y0) / maxDepth;
  const depthToY = (d: number) => FRAME_Y0 + d * pxPerM;

  const depthLabels = useMemo(() => {
    const labels: number[] = [];
    for (let d = 0; d <= maxDepth + 0.01; d += 3) labels.push(d);
    const last = labels[labels.length - 1];
    if (last < maxDepth) labels.push(maxDepth);
    return labels;
  }, [maxDepth]);

  const boundaryDepths = useMemo(() => {
    const depths = layers
      .flatMap((l) => [l.topDepth, l.bottomDepth])
      .filter((d) => d >= 0 && d <= maxDepth);
    return Array.from(new Set(depths)).sort((a, b) => a - b);
  }, [layers, maxDepth]);

  return (
    <div className="section-widget">
      <div className="section-container">
        <div className="header">
          <h1>MẶT CẮT ĐỊA CHẤT</h1>
          <div className="info">
            <div>CÔNG TRÌNH: {projectName}</div>
            <div>ĐỊA ĐIỂM: {locationLabel}</div>
            <div className="hole-info">
              LỖ KHOAN: <strong>{borehole.ten}</strong> · ĐỘ SÂU:{" "}
              <strong>{maxDepth} m</strong>
            </div>
          </div>
          <div className="logo">
            <span className="logo-text">PN</span>
            <span className="logo-sub">GEO</span>
          </div>
        </div>

        <div className="content">
          <div className="diagram-container">
            <svg
              width="640"
              height="520"
              viewBox="0 0 640 520"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern
                  id={`${uid}-grid`}
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke="#e0e0e0"
                    stroke-width="0.5"
                  />
                </pattern>
                {Object.entries(PATTERN_SIZES).map(([name, size]) => (
                  <pattern
                    key={name}
                    id={`${uid}-pat-${name}`}
                    width={size.w}
                    height={size.h}
                    patternUnits="userSpaceOnUse"
                    dangerouslySetInnerHTML={{
                      __html: PATTERN_DEFS[name],
                    }}
                  />
                ))}
              </defs>

              <rect
                x="0"
                y="0"
                width="640"
                height="520"
                fill={`url(#${uid}-grid)`}
              />
              <rect
                x={FRAME_X0}
                y={FRAME_Y0}
                width={FRAME_X1 - FRAME_X0}
                height={FRAME_Y1 - FRAME_Y0}
                fill="none"
                stroke="#000"
                stroke-width="1.5"
              />

              <g stroke="#ccc" stroke-dasharray="2,2" stroke-width="0.5">
                {depthLabels.map((d) => (
                  <line
                    key={d}
                    x1={FRAME_X0}
                    y1={depthToY(d)}
                    x2={FRAME_X1}
                    y2={depthToY(d)}
                  />
                ))}
              </g>

              <g font-size="11" font-weight="bold" fill="#000">
                {depthLabels.map((d) => (
                  <g key={d}>
                    <text x={FRAME_X0 - 5} y={depthToY(d) + 4} text-anchor="end">
                      -{d}
                    </text>
                    <text x={FRAME_X1 + 5} y={depthToY(d) + 4} text-anchor="start">
                      -{d}
                    </text>
                  </g>
                ))}
              </g>

              {layers.map((layer: GeoLayer, i) => {
                const yTop = depthToY(layer.topDepth);
                const yBot = depthToY(layer.bottomDepth);
                const key = `layer-${i}-${layer.topDepth}-${layer.bottomDepth}`;
                const rect = (
                  <rect
                    key={key}
                    x={FRAME_X0}
                    y={Math.min(yTop, yBot)}
                    width={FRAME_X1 - FRAME_X0}
                    height={Math.abs(yBot - yTop)}
                    fill={layer.color}
                  />
                );
                return (
                  <g key={`g-${key}`}>
                    {rect}
                    <rect
                      key={`p-${key}`}
                      x={FRAME_X0}
                      y={Math.min(yTop, yBot)}
                      width={FRAME_X1 - FRAME_X0}
                      height={Math.abs(yBot - yTop)}
                      fill={`url(#${uid}-pat-${layer.pattern})`}
                    />
                  </g>
                );
              })}

              <g stroke="#000" stroke-width="1.2" fill="none">
                {boundaryDepths.map((d) => (
                  <line
                    key={d}
                    x1={FRAME_X0}
                    y1={depthToY(d)}
                    x2={FRAME_X1}
                    y2={depthToY(d)}
                  />
                ))}
              </g>

              <line
                x1={BOREHOLE_X}
                y1={FRAME_Y0}
                x2={BOREHOLE_X}
                y2={FRAME_Y1}
                stroke="#000"
                stroke-width="2.5"
              />
              <line
                x1={BOREHOLE_X - 10}
                y1={FRAME_Y0}
                x2={BOREHOLE_X + 10}
                y2={FRAME_Y0}
                stroke="#000"
                stroke-width="2"
              />
              <text
                x={BOREHOLE_X}
                y={FRAME_Y0 - 12}
                font-size="12"
                font-weight="bold"
                text-anchor="middle"
              >
                {borehole.ten}
              </text>

              <g font-size="9.5" font-weight="normal" fill="#000">
                {boundaryDepths.map((d) => (
                  <text key={d} x={LABEL_X} y={depthToY(d) + 3}>
                    {d.toFixed(1)}
                  </text>
                ))}
              </g>

              {layers.map((layer: GeoLayer, i) => {
                const yMid = (depthToY(layer.topDepth) + depthToY(layer.bottomDepth)) / 2;
                const last = i === layers.length - 1;
                return (
                  <g
                    key={`badge-${i}`}
                    transform={`translate(${BADGE_X}, ${yMid})`}
                  >
                    <rect
                      x="-8"
                      y="-8"
                      width="16"
                      height="16"
                      rx={last ? 3 : 8}
                      fill="white"
                      stroke="#000"
                      stroke-width="0.8"
                    />
                    <text
                      x="0"
                      y="3.5"
                      font-size="10"
                      font-weight="bold"
                      text-anchor="middle"
                    >
                      {layer.code}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="legend-container">
            <div className="legend-title">Chú thích:</div>
            {layers.map((layer: GeoLayer, i) => (
              <div className="legend-item" key={`legend-${i}`}>
                <div
                  className="legend-box"
                  style={{ backgroundColor: layer.color }}
                >
                  <div
                    dangerouslySetInnerHTML={{
                      __html: smallLegendSvg(layer.pattern),
                    }}
                    style={{ width: "100%", height: "100%" }}
                  />
                  <div
                    className="legend-badge"
                    style={{ borderRadius: i === layers.length - 1 ? 3 : 8 }}
                  >
                    {layer.code}
                  </div>
                </div>
                <div className="legend-text">
                  <strong>Lớp {layer.code}:</strong> {layer.name},{" "}
                  {layer.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}