// Orquesta el llenado de hub_daily_cache — usado por el trigger de /epod
// justo después de cada subida.
//
// Round 1 del rollout incremental: SOLO Flow Meeting. CD5/DSR/Paquetes en
// Riesgo se agregan en rounds siguientes, uno por vez, una vez confirmado
// que este funciona sin regresiones — no reactivar los otros acá todavía
// (fue justamente cargar los 4 a la vez lo que generó la regresión anterior:
// mucho trabajo pesado compitiendo por el mismo hilo principal justo después
// de subir un ePOD grande).
import { computeFlowMeetingForDate, toCachedAnalysis } from "@/lib/flow-meeting-calc";
import { writeCache } from "@/lib/hub-daily-cache";

// No bloqueante a propósito: se llama con `void` desde /epod justo después
// de mostrar "ePOD procesado", nunca se espera. Si falla o el usuario cierra
// la pestaña antes de que termine, no rompe nada — Flow Meeting igual cae a
// cálculo en vivo la próxima vez que se abre (ver handleLoadFromDb), y con
// el fix de manejo de errores tampoco rompe nada si hub_daily_cache no
// responde.
export async function recomputeCacheAfterUpload(hubId: string, uploadedDates: string[]): Promise<void> {
  const dates = [...new Set(uploadedDates)].sort();

  for (const fecha of dates) {
    try {
      const analysis = await computeFlowMeetingForDate(hubId, fecha);
      await writeCache(hubId, "flow_meeting", fecha, toCachedAnalysis(analysis));
    } catch (e) {
      console.error(`[cache] Error recalculando Flow Meeting (${fecha}):`, e);
    }
  }
}
