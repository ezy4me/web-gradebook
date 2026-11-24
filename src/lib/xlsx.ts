/**
 * Минимальный генератор .xlsx без внешних зависимостей.
 *
 * Excel — это ZIP с набором XML-частей. Для журнала достаточно одного стилевого
 * листа, inline-строк и store-режима ZIP (без сжатия): файл получается на десятки
 * килобайт, зато нет ни SheetJS, ни polyfill'ов, ни лишнего веса в офлайн-PWA.
 *
 * Поддерживается ровно то, что нужно отчётам: несколько листов, ширины колонок,
 * объединения, закрепление шапки, заливка, границы, перенос строки и числовые
 * форматы.
 */

export interface XlsxStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  /** `thin` — сетка по всем сторонам, `bottom` — только нижняя линия. */
  border?: 'thin' | 'bottom';
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  /** Формат Excel, например `0"%"` или `0.0`. */
  numFmt?: string;
}

export type XlsxValue = string | number | null | undefined;

export interface XlsxCell {
  value: XlsxValue;
  style?: XlsxStyle;
}

export interface XlsxRow {
  height?: number;
  cells: (XlsxCell | XlsxValue)[];
}

export interface XlsxSheet {
  name: string;
  columns?: number[];
  rows: XlsxRow[];
  merges?: string[];
  freeze?: { rows: number; cols: number };
  showGridLines?: boolean;
  landscape?: boolean;
}

const DEFAULT_COLOR = 'FF1F1B16';
const DEFAULT_BORDER = 'FFD8D0C0';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function argb(hex: string): string {
  const clean = hex.replace('#', '').trim().toUpperCase();
  if (clean.length === 8) return clean;
  if (clean.length === 6) return `FF${clean}`;
  return DEFAULT_COLOR;
}

function colName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellRef(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

interface StyleRegistry {
  fonts: string[];
  fontKeys: Map<string, number>;
  fills: string[];
  fillKeys: Map<string, number>;
  borders: string[];
  borderKeys: Map<string, number>;
  numFmts: string[];
  numFmtIds: Map<string, number>;
  xfs: string[];
  xfKeys: Map<string, number>;
}

function createRegistry(): StyleRegistry {
  const fonts = [
    `<font><sz val="11"/><color rgb="${DEFAULT_COLOR}"/><name val="Calibri"/><family val="2"/></font>`,
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left style="thin"><color rgb="${DEFAULT_BORDER}"/></left><right style="thin"><color rgb="${DEFAULT_BORDER}"/></right><top style="thin"><color rgb="${DEFAULT_BORDER}"/></top><bottom style="thin"><color rgb="${DEFAULT_BORDER}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${DEFAULT_BORDER}"/></bottom><diagonal/></border>`,
  ];
  return {
    fonts,
    fontKeys: new Map([[fonts[0], 0]]),
    fills,
    fillKeys: new Map([[fills[0], 0], [fills[1], 1]]),
    borders,
    borderKeys: new Map([
      [borders[0], 0],
      [borders[1], 1],
      [borders[2], 2],
    ]),
    numFmts: [],
    numFmtIds: new Map(),
    xfs: [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>',
    ],
    xfKeys: new Map(),
  };
}

function fontId(reg: StyleRegistry, style: XlsxStyle): number {
  const key = `${Boolean(style.bold)}|${Boolean(style.italic)}|${style.size ?? 11}|${style.color ?? DEFAULT_COLOR}`;
  const existing = reg.fontKeys.get(key);
  if (existing != null) return existing;
  const parts = ['<font>'];
  if (style.bold) parts.push('<b/>');
  if (style.italic) parts.push('<i/>');
  parts.push(`<sz val="${style.size ?? 11}"/>`);
  parts.push(`<color rgb="${argb(style.color ?? DEFAULT_COLOR)}"/>`);
  parts.push('<name val="Calibri"/><family val="2"/>');
  parts.push('</font>');
  const xml = parts.join('');
  reg.fonts.push(xml);
  const id = reg.fonts.length - 1;
  reg.fontKeys.set(key, id);
  return id;
}

function fillId(reg: StyleRegistry, style: XlsxStyle): number {
  if (!style.fill) return 0;
  const key = argb(style.fill);
  const existing = reg.fillKeys.get(key);
  if (existing != null) return existing;
  const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${key}"/><bgColor indexed="64"/></patternFill></fill>`;
  reg.fills.push(xml);
  const id = reg.fills.length - 1;
  reg.fillKeys.set(key, id);
  return id;
}

function borderId(style: XlsxStyle): number {
  if (!style.border) return 0;
  return style.border === 'bottom' ? 2 : 1;
}

function numFmtId(reg: StyleRegistry, style: XlsxStyle): number {
  if (!style.numFmt) return 0;
  const existing = reg.numFmtIds.get(style.numFmt);
  if (existing != null) return existing;
  const id = 164 + reg.numFmts.length;
  reg.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${xmlEscape(style.numFmt)}"/>`);
  reg.numFmtIds.set(style.numFmt, id);
  return id;
}

function styleId(reg: StyleRegistry, style?: XlsxStyle): number {
  if (!style) return 0;
  const fid = fontId(reg, style);
  const flid = fillId(reg, style);
  const bid = borderId(style);
  const nid = numFmtId(reg, style);
  const align = style.align ?? 'left';
  const valign = style.valign === 'middle' ? 'center' : (style.valign ?? 'center');
  const key = `${fid}|${flid}|${bid}|${nid}|${align}|${valign}|${Boolean(style.wrap)}`;
  const existing = reg.xfKeys.get(key);
  if (existing != null) return existing;
  const attrs = [
    `numFmtId="${nid}"`,
    `fontId="${fid}"`,
    `fillId="${flid}"`,
    `borderId="${bid}"`,
    'xfId="0"',
    nid ? 'applyNumberFormat="1"' : '',
    fid ? 'applyFont="1"' : '',
    flid ? 'applyFill="1"' : '',
    bid ? 'applyBorder="1"' : '',
    'applyAlignment="1"',
  ]
    .filter(Boolean)
    .join(' ');
  const alignment = `<alignment horizontal="${align}" vertical="${valign}"${style.wrap ? ' wrapText="1"' : ''}/>`;
  const xml = `<xf ${attrs}>${alignment}</xf>`;
  reg.xfs.push(xml);
  const id = reg.xfs.length - 1;
  reg.xfKeys.set(key, id);
  return id;
}

function stylesXml(reg: StyleRegistry): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${reg.numFmts.length ? `<numFmts count="${reg.numFmts.length}">${reg.numFmts.join('')}</numFmts>` : '<numFmts count="0"/>'}
<fonts count="${reg.fonts.length}">${reg.fonts.join('')}</fonts>
<fills count="${reg.fills.length}">${reg.fills.join('')}</fills>
<borders count="${reg.borders.length}">${reg.borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${reg.xfs.length}">${reg.xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function sheetXml(sheet: XlsxSheet, reg: StyleRegistry): string {
  let maxCol = 0;
  let maxRow = sheet.rows.length;
  const rowsXml: string[] = [];
  sheet.rows.forEach((row, rowIndex) => {
    const cells: string[] = [];
    row.cells.forEach((raw, colIndex) => {
      if (raw == null) return;
      const cell: XlsxCell =
        raw != null && typeof raw === 'object' && 'value' in raw
          ? (raw as XlsxCell)
          : { value: raw as XlsxValue };
      const style = styleId(reg, cell.style);
      const ref = cellRef(rowIndex, colIndex);
      maxCol = Math.max(maxCol, colIndex);
      const attrs = `r="${ref}"${style ? ` s="${style}"` : ''}`;
      if (cell.value == null || cell.value === '') {
        if (style) cells.push(`<c ${attrs}/>`);
        return;
      }
      if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
        cells.push(`<c ${attrs}><v>${cell.value}</v></c>`);
      } else {
        cells.push(
          `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(cell.value))}</t></is></c>`,
        );
      }
    });
    if (!cells.length) return;
    const height = row.height ? ` ht="${row.height}" customHeight="1"` : '';
    rowsXml.push(`<row r="${rowIndex + 1}"${height}>${cells.join('')}</row>`);
  });

  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns
        .map(
          (width, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
        )
        .join('')}</cols>`
    : '';

  const freeze = sheet.freeze
    ? `<pane xSplit="${sheet.freeze.cols}" ySplit="${sheet.freeze.rows}" topLeftCell="${cellRef(
        sheet.freeze.rows,
        sheet.freeze.cols,
      )}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${cellRef(
        sheet.freeze.rows,
        sheet.freeze.cols,
      )}" sqref="${cellRef(sheet.freeze.rows, sheet.freeze.cols)}"/>`
    : '';

  const dimension = `A1:${cellRef(Math.max(maxRow - 1, 0), Math.max(maxCol, 0))}`;
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join('')}</mergeCells>`
    : '';
  const grid = sheet.showGridLines === false ? ' showGridLines="0"' : '';
  const orientation = sheet.landscape === false ? 'portrait' : 'landscape';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="${dimension}"/>
<sheetViews><sheetView${grid} workbookViewId="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${cols}
<sheetData>${rowsXml.join('')}</sheetData>
${merges}
<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
<pageSetup orientation="${orientation}" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^'+|'+$/g, '');
  if (!name) name = 'Лист';
  if (name.length > 31) name = name.slice(0, 31).trim();
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tail = ` ${suffix}`;
    candidate = `${name.slice(0, 31 - tail.length).trim()}${tail}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(stamp.time),
      u16(stamp.date),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);

    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(stamp.time),
        u16(stamp.date),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, ...centrals, eocd]);
}

/** Собрать .xlsx как Blob. */
export function buildXlsxBlob(sheets: XlsxSheet[]): Blob {
  if (!sheets.length) throw new Error('Нет листов для экспорта');
  const reg = createRegistry();
  const used = new Set<string>();
  const prepared = sheets.map((sheet) => ({
    ...sheet,
    name: sanitizeSheetName(sheet.name, used),
  }));

  const parts: { name: string; data: Uint8Array }[] = [];
  const encoder = new TextEncoder();
  const add = (name: string, xml: string) => parts.push({ name, data: encoder.encode(xml) });

  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${prepared
  .map(
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );

  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
<sheets>${prepared
      .map(
        (sheet, index) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join('')}</sheets>
</workbook>`,
  );

  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${prepared
  .map(
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join('')}
<Relationship Id="rId${prepared.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  prepared.forEach((sheet, index) => {
    add(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, reg));
  });
  add('xl/styles.xml', stylesXml(reg));

  const bytes = zip(parts);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Скачать готовый .xlsx. */
export function downloadXlsx(sheets: XlsxSheet[], fileName: string): void {
  const blob = buildXlsxBlob(sheets);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
