import type { Feature, FeatureCollection, Geometry } from "geojson";

export type SLAFijo = "T+1" | "T+2" | "T+2R";

export type DspKey =
  | "DKNS Transportes S.L."
  | "GLOBAL TRANS SOLUTIONS SL"
  | "Luan Express SL"
  | "Stratonway SOCIEDAD LIMITADA"
  | "-";

export const DSP_COLORS: Record<DspKey, string> = {
  "DKNS Transportes S.L.": "#2563eb",
  "GLOBAL TRANS SOLUTIONS SL": "#16a34a",
  "Luan Express SL": "#ea580c",
  "Stratonway SOCIEDAD LIMITADA": "#9333ea",
  "-": "#9ca3af",
};

export const DSP_ORDER: DspKey[] = [
  "DKNS Transportes S.L.",
  "GLOBAL TRANS SOLUTIONS SL",
  "Luan Express SL",
  "Stratonway SOCIEDAD LIMITADA",
  "-",
];

export type CpProperties = {
  cp: string;
  dsp: DspKey | string;
  hub: string | null;
  sla_teorico: SLAFijo | string | null;
  sla_fijo: SLAFijo | string | null;
  volumen: number;
};

export type CpFeature = Feature<Geometry, CpProperties>;
export type CpFeatureCollection = FeatureCollection<Geometry, CpProperties>;

export type SlaFilter = "all" | "t1" | "t2" | "t2r";
