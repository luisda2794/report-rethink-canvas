// Orquesta el llenado de hub_daily_cache — usado por el trigger de /epod
// justo después de cada subida, y por el botón admin "Recalcular caché
// completa" para rellenar histórico de hubs que ya tenían datos antes de
// esta capa. Un solo lugar para no duplicar cómo se combina cada tipo de
// reporte con la caché.
import { computeCd5ForDay, backfillCd5Cache } from "@/lib/kpis-cd5";
import { computeFlowMeetingForDate, toCachedAnalysis } from "@/lib/flow-meeting-calc";
import { fetchAndComputeRiesgo } from "@/lib/kpis-riesgo";
import { writeCache } from "@/lib/hub-daily-cache";

// Después de una subida en /epod: solo hace falta recalcular CD5 y Flow
// Meeting para los días nuevos que trajo ESTA subida (un día previo ya
// cacheado no cambia — ver el análisis en el plan de esta función). Riesgo
// se recalcula completo siempre, porque no es "por día": es una foto de
// "quién está atascado ahora mismo" que se invalida con cualquier subida.
//
// No bloqueante a propósito: se llama con `void` desde /epod justo después
// de mostrar "ePOD procesado", nunca se espera. Si falla o el usuario cierra
// la pestaña antes de que termine, no rompe nada — los reportes igual caen
// a cálculo en vivo la próxima vez que se abren (ver useCd5Trend/useRiesgo/
// handleLoadFromDb), simplemente no encuentran la caché tibia todavía.
export async function recomputeCacheAfterUpload(hubId: string, uploadedDates: string[]): Promise<void> {
  const dates = [...new Set(uploadedDates)].sort();

  for (const fecha of dates) {
    try {
      const point = await computeCd5ForDay(hubId, fecha);
      await writeCache(hubId, "cd5", fecha, point);
    } catch (e) {
      console.error(`[cache] Error recalculando CD5 (${fecha}):`, e);
    }
    try {
      const analysis = await computeFlowMeetingForDate(hubId, fecha);
      await writeCache(hubId, "flow_meeting", fecha, toCachedAnalysis(analysis));
    } catch (e) {
      console.error(`[cache] Error recalculando Flow Meeting (${fecha}):`, e);
    }
  }

  try {
    const riesgo = await fetchAndComputeRiesgo(hubId);
    if (riesgo.fechaEvaluada) {
      await writeCache(hubId, "paquetes_en_riesgo", riesgo.fechaEvaluada, riesgo.paquetes);
    }
  } catch (e) {
    console.error("[cache] Error recalculando Paquetes en Riesgo:", e);
  }
}

export type BackfillProgress = { done: number; total: number; etapa: string };

// Recalcula TODO el histórico disponible de un hub — para hubs que ya
// tenían datos antes de que existiera esta caché. CD5 se hace en una sola
// pasada por lotes (backfillCd5Cache, reutiliza el barrido de una sola
// pasada); Flow Meeting no tiene ese atajo (cada día necesita su propio
// fetch acotado a esa fecha), así que se recorre día por día.
export async function backfillAllCache(
  hubId: string,
  allDates: string[],
  onProgress?: (p: BackfillProgress) => void,
): Promise<void> {
  const dates = [...allDates].sort();
  const total = dates.length + 1; // + Riesgo al final
  let done = 0;

  onProgress?.({ done, total, etapa: "CD5" });
  try {
    await backfillCd5Cache(hubId, dates);
  } catch (e) {
    console.error("[cache] Error en backfill de CD5:", e);
  }
  done++;
  onProgress?.({ done, total, etapa: "Flow Meeting" });

  for (const fecha of dates) {
    try {
      const analysis = await computeFlowMeetingForDate(hubId, fecha);
      await writeCache(hubId, "flow_meeting", fecha, toCachedAnalysis(analysis));
    } catch (e) {
      console.error(`[cache] Error en backfill de Flow Meeting (${fecha}):`, e);
    }
    done++;
    onProgress?.({ done, total, etapa: `Flow Meeting ${fecha}` });
  }

  onProgress?.({ done, total, etapa: "Paquetes en Riesgo" });
  try {
    const riesgo = await fetchAndComputeRiesgo(hubId);
    if (riesgo.fechaEvaluada) {
      await writeCache(hubId, "paquetes_en_riesgo", riesgo.fechaEvaluada, riesgo.paquetes);
    }
  } catch (e) {
    console.error("[cache] Error en backfill de Paquetes en Riesgo:", e);
  }
  done++;
  onProgress?.({ done, total, etapa: "Listo" });
}
