import { describe, expect, it } from "vitest";
import { clasificarOrigen, esDireccionIncorrecta, esEstadoRepartoHoy, limiteHoras, metrica } from "./riesgo-origen";

describe("origen del cliente", () => {
  it("marketplace Yun Express es China", () => expect(clasificarOrigen("Tienda X", "Yun Express")).toBe("China"));
  it("seller con temu es China", () => expect(clasificarOrigen("TEMU Spain", "")).toBe("China"));
  it("CBT_Delivery es China", () => expect(clasificarOrigen("CBT_Delivery", "")).toBe("China"));
  it("caracteres chinos es China", () => expect(clasificarOrigen("深圳市电子", "")).toBe("China"));
  it("almacén Shenzhen es China", () => expect(clasificarOrigen("Shenzhen Warehouse Co", "")).toBe("China"));
  it("Inditex es Local", () => expect(clasificarOrigen("Inditex", "TikTok Shop")).toBe("Local"));
  it("S.L. es Local", () => expect(clasificarOrigen("Moda Norte S.L.", "")).toBe("Local"));
});

describe("plazos", () => {
  it("local = 120 h", () => expect(limiteHoras("Local")).toBe(120));
  it("chino = 216 h", () => expect(limiteHoras("China")).toBe(216));
  it("local con 130 h sigue en CD5", () => expect(metrica("Local", 130)).toBe("CD5"));
  it("local con 217 h pasa a CD9", () => expect(metrica("Local", 217)).toBe("CD9"));
  it("chino siempre CD9", () => expect(metrica("China", 10)).toBe("CD9"));
});

describe("R5 dirección incorrecta", () => {
  it("sin acentos ni mayúsculas", () => expect(esDireccionIncorrecta("DIRECCION INCORRECTA")).toBe(true));
  it("con typo dirrección", () => expect(esDireccionIncorrecta("Dirrección\u00a0incorrecta")).toBe(true));
  it("otro motivo no", () => expect(esDireccionIncorrecta("Fuera de mi Ruta")).toBe(false));
});

describe("en reparto hoy", () => {
  it("Driver_received cuenta", () => expect(esEstadoRepartoHoy("Driver_received")).toBe(true));
  it("Attempt Failure cuenta", () => expect(esEstadoRepartoHoy("Attempt Failure")).toBe(true));
  it("Entregado no cuenta", () => expect(esEstadoRepartoHoy("Entregado")).toBe(false));
  it("Cancelar cuenta", () => expect(esEstadoRepartoHoy("Cancelar")).toBe(true));
  it("INBOUND no cuenta", () => expect(esEstadoRepartoHoy("INBOUND")).toBe(false));
  it("Assigned no cuenta", () => expect(esEstadoRepartoHoy("Assigned")).toBe(false));
  it("vacío no cuenta", () => expect(esEstadoRepartoHoy(null)).toBe(false));
});
