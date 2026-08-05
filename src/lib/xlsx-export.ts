import XLSXStyle from "xlsx-js-style";

/**
 * Helper de exportación a Excel compartido: título + fecha en la fila 1
 * (fondo azul oscuro, texto blanco), encabezados de columna con el mismo
 * estilo, y bordes finos grises en todas las celdas de datos.
 */

const TITLE_BG = "2F5496";
const TITLE_FONT = "FFFFFF";
const BORDER_COLOR = "D3D3D3";

const THIN_BORDER = {
  top: { style: "thin", color: { rgb: BORDER_COLOR } },
  bottom: { style: "thin", color: { rgb: BORDER_COLOR } },
  left: { style: "thin", color: { rgb: BORDER_COLOR } },
  right: { style: "thin", color: { rgb: BORDER_COLOR } },
};

export type CellFillSpec = { bg: string; fg?: string };

export function exportStyledExcel(opts: {
  title: string;
  date: string;
  headers: string[];
  rows: (string | number)[][];
  filename: string;
  sheetName?: string;
  colWidths?: number[];
  /** Color (y opcionalmente texto) de una celda puntual, o undefined para dejarla sin resaltar. */
  cellFill?: (row: (string | number)[], colIndex: number, rowIndex: number) => CellFillSpec | undefined;
}): void {
  const { title, date, headers, rows, filename, sheetName = "Reporte", colWidths, cellFill } = opts;

  const aoa: (string | number)[][] = [[`${title} — ${date}`], headers, ...rows];
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

  const lastCol = Math.max(headers.length - 1, 0);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }];

  const titleStyle = {
    font: { bold: true, color: { rgb: TITLE_FONT }, sz: 12 },
    fill: { patternType: "solid", fgColor: { rgb: TITLE_BG } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const headerStyle = {
    font: { bold: true, color: { rgb: TITLE_FONT } },
    fill: { patternType: "solid", fgColor: { rgb: TITLE_BG } },
    alignment: { horizontal: "center", vertical: "center" },
    border: THIN_BORDER,
  };

  const titleRef = XLSXStyle.utils.encode_cell({ r: 0, c: 0 });
  const titleCell = (ws as Record<string, unknown>)[titleRef] as { s?: unknown } | undefined;
  if (titleCell) titleCell.s = titleStyle;

  for (let c = 0; c < headers.length; c++) {
    const ref = XLSXStyle.utils.encode_cell({ r: 1, c });
    const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
    if (cell) cell.s = headerStyle;
  }

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSXStyle.utils.encode_cell({ r: r + 2, c });
      const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
      if (!cell) continue;
      const fill = cellFill?.(rows[r], c, r);
      cell.s = fill
        ? { border: THIN_BORDER, fill: { patternType: "solid", fgColor: { rgb: fill.bg } }, font: { color: { rgb: fill.fg ?? "7F1D1D" } } }
        : { border: THIN_BORDER };
    }
  }

  if (colWidths) {
    ws["!cols"] = colWidths.map((wch) => ({ wch }));
  }

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
