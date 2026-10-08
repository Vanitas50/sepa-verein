const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function readCentralDirectory(bytes, dv) {
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine gültige .xlsx-Datei (ZIP-Ende nicht gefunden).");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== CEN_SIG) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    files[name] = { method, compSize, localOff };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflateRaw(comp) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Dieser Browser unterstützt kein .xlsx (DecompressionStream fehlt). Bitte als CSV speichern.");
  }
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

async function readEntry(bytes, dv, entry) {
  const lo = entry.localOff;
  if (dv.getUint32(lo, true) !== LOC_SIG) throw new Error("Beschädigter ZIP-Eintrag.");
  const nameLen = dv.getUint16(lo + 26, true);
  const extraLen = dv.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const comp = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(comp);
  if (entry.method === 8) return await inflateRaw(comp);
  throw new Error(`Nicht unterstützte Kompression (${entry.method}).`);
}

function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] || "";
    let s = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(inner))) s += unescapeXml(tm[1]);
    out.push(s);
  }
  return out;
}

function colToIndex(ref) {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellValue(attrs, inner, shared) {
  const t = (/t="([^"]*)"/.exec(attrs) || [])[1] || "n";
  if (t === "inlineStr") {
    const tm = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
    return tm ? unescapeXml(tm[1]) : "";
  }
  const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  const v = vm ? unescapeXml(vm[1]) : "";
  if (t === "s") {
    const idx = Number(v);
    return Number.isFinite(idx) && shared[idx] != null ? shared[idx] : "";
  }
  return v;
}

function parseSheet(xml, shared) {
  const matrix = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const inner = rm[2] || "";
    const cells = [];
    const cRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let seq = 0;
    while ((cm = cRe.exec(inner))) {
      const attrs = cm[1] || "";
      const selfClosing = cm[2] === "/>";
      const innerCell = cm[3] || "";
      const ref = (/r="([^"]*)"/.exec(attrs) || [])[1];
      const idx = ref ? colToIndex(ref) : seq;
      const value = selfClosing ? "" : cellValue(attrs, innerCell, shared);
      if (idx != null) cells[idx] = value;
      seq = (idx != null ? idx : seq) + 1;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    matrix.push(cells);
  }
  let last = matrix.length;
  while (last > 0 && matrix[last - 1].every((c) => c === "")) last--;
  return matrix.slice(0, last);
}

export async function parseXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = readCentralDirectory(bytes, dv);
  const read = async (name) => (files[name] ? readEntry(bytes, dv, files[name]) : null);

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  let sheetName = "xl/worksheets/sheet1.xml";
  if (!files[sheetName]) {
    sheetName = Object.keys(files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  }
  if (!sheetName) throw new Error("Keine Tabelle in der .xlsx-Datei gefunden.");
  const sheetXml = await read(sheetName);
  if (!sheetXml) throw new Error("Tabelle konnte nicht gelesen werden.");
  return { matrix: parseSheet(sheetXml, shared), sheet: sheetName };
}
