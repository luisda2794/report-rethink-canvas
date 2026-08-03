import { isSheinClient, applyClientAlias, type ClientesLocalesConfig } from "@/lib/clientes-locales-config";

/**
 * Clasificación de cliente compartida entre Súper Reporte y Clientes Locales:
 * LOCAL / TEMU / ALIEXPRESS (dropshipper China) / SHEIN. Se extrajo a un
 * módulo propio porque ambas páginas necesitan exactamente el mismo criterio
 * (mismo set de apellidos chinos, mismos carriers, mismo alias SHEIN) para
 * que sus reportes % Close Loop por categoría sean comparables.
 */

export type Categoria = "LOCAL" | "TEMU" | "ALIEXPRESS" | "SHEIN";
export const CATEGORIA_ORDER: Categoria[] = ["LOCAL", "TEMU", "ALIEXPRESS", "SHEIN"];
export const CATEGORIA_LABEL: Record<Categoria, string> = {
  LOCAL: "LOCAL",
  TEMU: "TEMU",
  ALIEXPRESS: "ALIEXPRESS / DROPSHIPPER CHINA",
  SHEIN: "SHEIN",
};

const CHINESE_SURNAMES = new Set([
  "zhang", "wang", "li", "liu", "chen", "yang", "huang", "zhao", "wu", "zhou",
  "xu", "sun", "ma", "zhu", "hu", "guo", "he", "gao", "lin", "luo", "zheng",
  "liang", "song", "xie", "tang", "han", "cao", "deng", "feng", "yu", "dong",
  "xiao", "cai", "peng", "zeng", "qiu", "shen", "jiang", "yuan", "pan", "fan",
  "fang", "shi", "yao", "wei", "jia", "xiong", "kong", "lai", "bai", "long",
  "meng", "cui", "qin", "kang", "mao", "qiao", "gu", "shao", "wan", "duan",
  "lei", "tan", "wen", "chang", "zou", "yan", "liao", "ding", "xin", "yin",
  "ni", "ou", "ke", "chu", "guan", "zhan", "miao", "ai", "gong", "bao", "du",
  "dai", "ren", "jin", "qian", "lu", "tian",
]);

const EXACT_CHINA_CARRIERS = new Set(["yun express", "yanwen", "sf", "shunyou"]);

// Rango CJK Unified Ideographs (equivalente a /[一-鿿]/).
function hasCjk(s: string): boolean {
  return /[一-鿿]/.test(s);
}

/** empieza con, o contiene como palabra completa, un apellido chino en pinyin */
function matchesChineseSurname(raw: string): boolean {
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[^a-z]/g, "");
  for (const surname of CHINESE_SURNAMES) {
    if (compact.startsWith(surname)) return true;
  }
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (CHINESE_SURNAMES.has(w)) return true;
  }
  return false;
}

export function categorizeCliente(
  mercado: string,
  vendedor: string,
  config: ClientesLocalesConfig,
): { cliente: string; categoria: Categoria } {
  const mercadoTrim = mercado.trim();
  const vendedorTrim = vendedor.trim();
  const clienteRaw = mercadoTrim || vendedorTrim;
  if (!clienteRaw) return { cliente: "", categoria: "LOCAL" };

  // Prioridad: alias configurable (p.ej. INFINITE REMIT -> SHEIN) sobre cualquier
  // otra regla de clasificación.
  if (isSheinClient(mercadoTrim, vendedorTrim, config)) {
    return { cliente: "SHEIN", categoria: "SHEIN" };
  }

  const cliente = applyClientAlias(clienteRaw, config);
  if (hasCjk(clienteRaw)) return { cliente, categoria: "ALIEXPRESS" };
  if (matchesChineseSurname(clienteRaw)) return { cliente, categoria: "ALIEXPRESS" };
  if (clienteRaw.toLowerCase().includes("aliexpress")) return { cliente, categoria: "ALIEXPRESS" };
  if (EXACT_CHINA_CARRIERS.has(clienteRaw.toLowerCase())) return { cliente, categoria: "ALIEXPRESS" };
  if (clienteRaw.toLowerCase().includes("temu")) return { cliente, categoria: "TEMU" };
  return { cliente, categoria: "LOCAL" };
}
