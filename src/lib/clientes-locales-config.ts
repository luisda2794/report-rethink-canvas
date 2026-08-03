/**
 * Configuración editable del módulo "Reportes de Clientes Locales", persistida
 * en localStorage del navegador (no hay backend/Supabase para este módulo).
 */

export type CpLocalidad = {
  cp: string;
  localidad: string;
  fase: string;
};

export type RenameClientRule = {
  from: string;
  to: string;
};

export type ClientesLocalesConfig = {
  excludeMarketplace: string[];
  includeSeller: string[];
  cpMapping: CpLocalidad[];
  renameClientRules: RenameClientRule[];
};

const STORAGE_KEY = "clientes_locales_config_v1";

// Semilla inicial. El CP y la Fase de cada localidad quedan en blanco porque
// no tenemos el código postal real de cada una — se completan a mano desde
// la página de administración.
const SEED: ClientesLocalesConfig = {
  excludeMarketplace: ["Yun Express", "SHUNYOU", "YANWEN"],
  includeSeller: ["TikTok Shop", "ENERFERO", "DECODEKO"],
  renameClientRules: [{ from: "INFINITE REMIT", to: "SHEIN" }],
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
      renameClientRules: parsed.renameClientRules ?? clone(SEED.renameClientRules),
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

/**
 * Alias de nombre a mostrar: si `name` coincide exactamente (trim + sin
 * distinguir mayúsculas) con el `from` de alguna regla, se muestra el `to`
 * configurado en su lugar. Solo afecta la visualización — el dato original
 * (mercado/vendedor) no se modifica.
 */
export function applyClientAlias(name: string, config: ClientesLocalesConfig): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const rule = config.renameClientRules.find((r) => r.from.trim().toLowerCase() === trimmed.toLowerCase());
  return rule ? rule.to : name;
}

/**
 * ¿Es SHEIN? Revisa "Nombre del mercado" y "Nombre del vendedor" por separado
 * (uno puede estar vacío o traer un valor distinto) contra el alias
 * configurado — hoy INFINITE REMIT -> SHEIN, editable sin tocar código.
 */
export function isSheinClient(mercado: string, vendedor: string, config: ClientesLocalesConfig): boolean {
  const mercadoTrim = mercado.trim();
  const vendedorTrim = vendedor.trim();
  const mercadoAlias = mercadoTrim ? applyClientAlias(mercadoTrim, config) : "";
  const vendedorAlias = vendedorTrim ? applyClientAlias(vendedorTrim, config) : "";
  return mercadoAlias === "SHEIN" || vendedorAlias === "SHEIN";
}

/**
 * Regla de negocio "Cliente Local": SHEIN (vía el alias configurado) siempre
 * cuenta como cliente local, sin depender de las listas de exclusión/inclusión
 * — de lo contrario, si "Nombre del mercado" viene vacío para estos pedidos y
 * "INFINITE REMIT" no está en Incluir Seller, estas filas nunca llegarían a
 * clasificarse como SHEIN (se descartarían antes, como si no fueran cliente
 * local). Fuera de eso: mercado con valor y no excluido, o vendedor
 * coincidiendo exactamente con la lista de sellers incluidos.
 */
export function isClienteLocal(mercado: string, vendedor: string, config: ClientesLocalesConfig): boolean {
  if (isSheinClient(mercado, vendedor, config)) return true;
  const excludeSet = new Set(config.excludeMarketplace.map((s) => s.trim().toLowerCase()));
  const includeSet = new Set(config.includeSeller.map((s) => s.trim().toLowerCase()));
  const mercadoTrim = mercado.trim();
  const vendedorTrim = vendedor.trim();
  const condA = mercadoTrim !== "" && !excludeSet.has(mercadoTrim.toLowerCase());
  const condB = vendedorTrim !== "" && includeSet.has(vendedorTrim.toLowerCase());
  return condA || condB;
}
