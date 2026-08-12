export interface Borehole {
  id: string;
  ten: string;
  lat: number;
  lng: number;
  doSau: number;
  distance: number;
}

export interface GeoLayer {
  code: string;
  name: string;
  description: string;
  color: string;
  pattern: LayerPattern;
  topDepth: number;
  bottomDepth: number;
}

export type LayerPattern = "hatch" | "crosshatch" | "dots" | "gravel" | "sand" | "dense";

export interface BoreholeSection {
  borehole: Borehole;
  layers: GeoLayer[];
  maxDepth: number;
  projectName: string;
  locationLabel: string;
}

export interface BoreholeQuery {
  lat: number;
  lng: number;
  radius: number;
}