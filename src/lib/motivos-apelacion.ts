// Lista fija y exacta de la hoja "Motivo" del Excel que exige Cainiao para
// apelaciones — NO alterar valores ni agregar nuevos (rompería el formato
// de apelación que Cainiao procesa). Compartida entre Reclamaciones (donde
// se elige por caso) y Pagos Cainiao (donde se exporta al Excel/Word).
export const MOTIVOS_APELACION = [
  "El cliente reclama faltan artículos/productos incorrectos",
  "El cliente no hay reclamacion",
  "Casos de robo/penalización/pérdida/paquete dañado",
  "Cliente ha recibido",
  "Cliente reclama por equivocacion",
  "El paquete se entrega en PUDO/ Punto de recogida/city box/mail box/tercero（vecinos/conserjes/compañeros/familiares, etc.）",
  "El paquete no se ha recogido",
  "Este no es nuestro paquete de entrega/Este no es nuestro conductor",
  "Fuera de la zona de entrega/Paquete en almacén",
  "La penalización duplicado",
  "El cliente se llama por entrega urgente/cambio de dirección/error de dirección que provoca un error de entrega/el cliente no está en casa, etc.",
  "No ha recibido ninguna reclamación",
] as const;
