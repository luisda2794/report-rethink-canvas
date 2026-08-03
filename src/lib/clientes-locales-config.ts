/**
 * Configuración editable del módulo "Reportes de Clientes Locales", persistida
 * en localStorage del navegador (no hay backend/Supabase para este módulo).
 */

export type CpLocalidad = {
  cp: string;
  localidad: string;
  fase: string;
};

export type ClientesLocalesConfig = {
  excludeMarketplace: string[];
  includeSeller: string[];
  cpMapping: CpLocalidad[];
};

const STORAGE_KEY = "clientes_locales_config_v1";

// Semilla inicial. El CP y la Fase de cada localidad quedan en blanco porque
// no tenemos el código postal real de cada una — se completan a mano desde
// la página de administración.
const SEED: ClientesLocalesConfig = {
  excludeMarketplace: ["Yun Express", "SHUNYOU", "YANWEN"],
  includeSeller: ["TikTok Shop", "ENERFERO", "DECODEKO"],
  cpMapping: [
    "Elda",
    "Petrer",
    "Sax",
    "Monóvar",
    "Novelda",
    "Algueña",
    "La Romana",
    "Monforte del Cid",
    "Aspe",
    "Hondón de las Nieves",
    "Hondón de los Frailes",
    "Agost",
    "Crevillente",
    "Villena",
    "Banyeres de Mariola",
  ].map((localidad) => ({ cp: "", localidad, fase: "" })),
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function getClientesLocalesConfig(): ClientesLocalesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = clone(SEED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as Partial<ClientesLocalesConfig>;
    return {
      excludeMarketplace: parsed.excludeMarketplace ?? clone(SEED.excludeMarketplace),
      includeSeller: parsed.includeSeller ?? clone(SEED.includeSeller),
      cpMapping: parsed.cpMapping ?? clone(SEED.cpMapping),
    };
  } catch {
    return clone(SEED);
  }
}

export function saveClientesLocalesConfig(config: ClientesLocalesConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}
