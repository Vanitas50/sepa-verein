export const NS = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08";

const IBAN_LENGTHS = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

const HEADER_ALIASES = {
  name: ["name", "mitglied", "mitgliedsname", "name des mitglieds", "kontoinhaber"],
  vorname: ["vorname", "first name", "first"],
  nachname: ["nachname", "last name", "last", "familienname"],
  iban: ["iban", "kontonummer iban"],
  bic: ["bic", "swift", "bic/swift", "bic (swift)"],
  amount: ["beitrag", "betrag", "betrag eur", "amount", "summe", "beitrag_eur"],
  mandate_ref: ["mandat", "mandatsreferenz", "mandatsreferenznummer", "mandate", "mandat_ref", "mandats-ref"],
  mandate_date: ["mandatsdatum", "datum mandat", "datum_mandat", "datum_mandatsunterschrift", "mandat_datum", "mandatsunterschrift"],
  purpose: ["verwendungszweck", "zweck", "purpose", "betreff"],
  end_to_end: ["endtoend", "endtoend referenz", "end_to_end", "referenz", "end-to-end"],
  seq: ["seq", "seqtp", "sequenz", "seq_type", "sequenztyp"],
  first: ["erstmalig", "first", "neu", "ersteinzug"],
};

export function normKey(s) {
  let x = String(s || "").trim().toLowerCase();
  x = x.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  return x.replace(/\s+/g, " ");
}

function aliasToCanon(key) {
  for (const [canon, list] of Object.entries(HEADER_ALIASES)) {
    if (list.includes(key) || list.includes(key.replace(/_/g, " "))) return canon;
  }
  return null;
}

export function parseAmountToCents(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/[€\s\u00a0]/g, "");
  if (!s) throw new Error("leerer Betrag");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const f = Number(s);
  if (!isFinite(f)) throw new Error(`Betrag nicht lesbar: ${raw}`);
  return Math.round(f * 100);
}

export function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

const DATE_FORMATS = [
  [/^(\d{2})\.(\d{2})\.(\d{4})$/, (m) => [m[3], m[2], m[1]]],
  [/^(\d{2})\.(\d{2})\.(\d{2})$/, (m) => [`20${m[3]}`, m[2], m[1]]],
  [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => [m[1], m[2], m[3]]],
  [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m) => [m[3], m[2], m[1]]],
];

export function parseDateToIso(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error("leeres Datum");
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
      return dt.toISOString().slice(0, 10);
    }
  }
  for (const [re, fn] of DATE_FORMATS) {
    const m = s.match(re);
    if (m) {
      const [y, mo, d] = fn(m);
      const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
      if (isNaN(dt.getTime())) throw new Error(`Datum ungültig: ${raw}`);
      return `${y}-${mo}-${d}`;
    }
  }
  throw new Error(`Datum nicht lesbar: ${raw} (erwartet TT.MM.JJJJ)`);
}

export function ibanValid(iban) {
  const s = String(iban || "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return { ok: false, msg: "Format ungültig" };
  const cc = s.slice(0, 2);
  if (IBAN_LENGTHS[cc] && s.length !== IBAN_LENGTHS[cc]) {
    return { ok: false, msg: `Länge ${s.length}, erwartet ${IBAN_LENGTHS[cc]} für ${cc}` };
  }
  const rearr = s.slice(4) + s.slice(0, 4);
  let digits = "";
  for (const ch of rearr) {
    digits += /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  }
  try {
    if (BigInt(digits) % 97n !== 1n) return { ok: false, msg: "Prüfsumme (mod 97) falsch" };
  } catch {
    return { ok: false, msg: "ungültige Zeichen" };
  }
  return { ok: true, msg: "ok" };
}

export function bicValid(bic) {
  const s = String(bic || "").replace(/\s/g, "").toUpperCase();
  if (!s) return { ok: true, msg: "leer (optional)" };
  if (/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s)) return { ok: true, msg: "ok" };
  return { ok: false, msg: "Format ungültig" };
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  ));
}

function trunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length <= n ? s : s.slice(0, n);
}

export function detectDelimiter(sample) {
  const line = String(sample).split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const counts = { ";": (line.match(/;/g) || []).length, ",": (line.match(/,/g) || []).length, "\t": (line.match(/\t/g) || []).length };
  let best = ";", bestN = -1;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

function splitCsv(text, delim) {
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function rowsFromMatrix(matrix) {
  if (!matrix || !matrix.length) return { rows: [], headers: [], mapping: {} };
  const headers = matrix[0].map((h) => String(h == null ? "" : h).trim());
  const mapping = {};
  headers.forEach((h, idx) => {
    const canon = aliasToCanon(normKey(h));
    if (canon) mapping[idx] = canon;
  });
  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const obj = {};
    for (const [idx, canon] of Object.entries(mapping)) {
      obj[canon] = String(matrix[r][idx] == null ? "" : matrix[r][idx]).trim();
    }
    if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
  }
  return { rows, headers, mapping };
}

export function parseCsv(text) {
  const delim = detectDelimiter(text);
  return rowsFromMatrix(splitCsv(text, delim));
}

function cleanName(row) {
  let name = (row.name || "").trim();
  if (!name) {
    const vn = (row.vorname || "").trim();
    const nn = (row.nachname || "").trim();
    name = `${vn} ${nn}`.trim();
  }
  return name.replace(/\s+/g, " ");
}

export function prepare(rows, opts) {
  const members = [];
  const errors = [];
  const seen = {};
  rows.forEach((row, i) => {
    const line = i + 2;
    const name = cleanName(row);
    const iban = (row.iban || "").replace(/\s/g, "").toUpperCase();
    const bic = (row.bic || "").replace(/\s/g, "").toUpperCase();
    if (!name) { errors.push({ line, msg: "Name fehlt" }); return; }
    const iv = ibanValid(iban);
    if (!iv.ok) { errors.push({ line, name, msg: `IBAN ungültig – ${iv.msg}` }); return; }
    const bv = bicValid(bic);
    if (!bv.ok) { errors.push({ line, name, msg: `BIC ungültig – ${bv.msg}` }); return; }
    let cents;
    try { cents = parseAmountToCents(row.amount); }
    catch (e) { errors.push({ line, name, msg: e.message }); return; }
    if (cents <= 0) { errors.push({ line, name, msg: "Betrag muss > 0 sein" }); return; }
    const mandateRef = (row.mandate_ref || "").trim();
    if (!mandateRef) { errors.push({ line, name, msg: "Mandatsreferenz fehlt" }); return; }
    if (seen[mandateRef]) {
      errors.push({ line, name, msg: `Mandatsreferenz '${mandateRef}' doppelt (schon Zeile ${seen[mandateRef]})` });
      return;
    }
    seen[mandateRef] = line;
    let mandateDate;
    try { mandateDate = parseDateToIso(row.mandate_date); }
    catch (e) { errors.push({ line, name, msg: e.message }); return; }
    if (mandateDate > opts.collectionDate) {
      errors.push({ line, name, msg: `Mandatsdatum ${mandateDate} liegt nach Fälligkeit ${opts.collectionDate}` });
      return;
    }
    let seq = (row.seq || "").toUpperCase();
    if (seq && !["FRST", "RCUR", "OOFF", "FNAL"].includes(seq)) {
      errors.push({ line, name, msg: `ungültiger Sequenztyp '${seq}'` });
      return;
    }
    if (!seq) {
      const first = (row.first || "").trim().toLowerCase();
      seq = ["1", "ja", "yes", "true", "x", "j", "wahr"].includes(first) ? "FRST" : "";
    }
    members.push({
      name, iban, bic, cents, mandateRef, mandateDate,
      purpose: (row.purpose || "").trim(),
      endToEnd: (row.end_to_end || "").trim(),
      seq: seq || opts.seq,
    });
  });
  return { members, errors };
}

export function validateConfig(cfg) {
  const errors = [];
  if (!cfg.name || !cfg.name.trim()) errors.push("Vereinsname fehlt");
  const iv = ibanValid(cfg.iban);
  if (!iv.ok) errors.push(`Gläubiger-IBAN ungültig – ${iv.msg}`);
  const bv = bicValid(cfg.bic);
  if (!bv.ok) errors.push(`Gläubiger-BIC ungültig – ${bv.msg}`);
  if (!cfg.creditorId || !cfg.creditorId.trim()) errors.push("Gläubiger-ID fehlt");
  return errors;
}

export function buildXml(config, members, opts) {
  const total = members.reduce((s, m) => s + m.cents, 0);
  const msgId = trunc(opts.msgId || `${config.prefix || "SEPA"}-${stamp()}`, 35);
  const L = [];
  let ind = 0;
  const pad = () => "  ".repeat(ind);
  const open = (t) => { L.push(`${pad()}<${t}>`); ind++; };
  const close = (t) => { ind--; L.push(`${pad()}</${t}>`); };
  const leaf = (t, text, attrs) => L.push(`${pad()}<${t}${attrs ? " " + attrs : ""}>${escapeXml(text)}</${t}>`);

  L.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  L.push(`<Document xmlns="${NS}">`);
  ind++;
  open("CstmrDrctDbtInitn");
  open("GrpHdr");
  leaf("MsgId", msgId);
  leaf("CreDtTm", new Date().toISOString().slice(0, 19));
  leaf("NbOfTxs", String(members.length));
  leaf("CtrlSum", formatCents(total));
  open("InitgPty"); leaf("Nm", trunc(config.name, 70)); close("InitgPty");
  close("GrpHdr");

  const groups = {};
  for (const m of members) (groups[m.seq] = groups[m.seq] || []).push(m);
  for (const [seq, ms] of Object.entries(groups)) {
    const gsum = ms.reduce((s, m) => s + m.cents, 0);
    open("PmtInf");
    leaf("PmtInfId", trunc(`${config.prefix || "SEPA"}-${seq}-${(opts.collectionDate || "").replace(/-/g, "")}`, 35));
    leaf("PmtMtd", "DD");
    leaf("BtchBookg", "true");
    leaf("NbOfTxs", String(ms.length));
    leaf("CtrlSum", formatCents(gsum));
    open("PmtTpInf");
    open("SvcLvl"); leaf("Cd", "SEPA"); close("SvcLvl");
    open("LclInstrm"); leaf("Cd", opts.scheme || "CORE"); close("LclInstrm");
    leaf("SeqTp", seq);
    close("PmtTpInf");
    leaf("ReqdColltnDt", opts.collectionDate);
    open("Cdtr"); leaf("Nm", trunc(config.name, 70)); close("Cdtr");
    open("CdtrAcct"); open("Id"); leaf("IBAN", config.iban); close("Id"); close("CdtrAcct");
    open("CdtrAgt"); open("FinInstnId"); leaf("BICFI", config.bic); close("FinInstnId"); close("CdtrAgt");
    leaf("ChrgBr", "SLEV");
    open("CdtrSchmeId"); open("Id"); open("PrvtId"); open("Othr");
    leaf("Id", config.creditorId);
    open("SchmeNm"); leaf("Prtry", "SEPA"); close("SchmeNm");
    close("Othr"); close("PrvtId"); close("Id"); close("CdtrSchmeId");

    for (const m of ms) {
      open("DrctDbtTxInf");
      open("PmtId"); leaf("EndToEndId", trunc(m.endToEnd || "NOTPROVIDED", 35)); close("PmtId");
      leaf("InstdAmt", formatCents(m.cents), 'Ccy="EUR"');
      open("DrctDbtTx"); open("MndtRltdInf");
      leaf("MndtId", trunc(m.mandateRef, 35));
      leaf("DtOfSgntr", m.mandateDate);
      leaf("AmdmntInd", "false");
      close("MndtRltdInf"); close("DrctDbtTx");
      if (m.bic) { open("DbtrAgt"); open("FinInstnId"); leaf("BICFI", m.bic); close("FinInstnId"); close("DbtrAgt"); }
      open("Dbtr"); leaf("Nm", trunc(m.name, 70)); close("Dbtr");
      open("DbtrAcct"); open("Id"); leaf("IBAN", m.iban); close("Id"); close("DbtrAcct");
      if (m.purpose) { open("RmtInf"); leaf("Ustrd", trunc(m.purpose, 140)); close("RmtInf"); }
      close("DrctDbtTxInf");
    }
    close("PmtInf");
  }
  close("CstmrDrctDbtInitn");
  ind--;
  L.push(`</Document>`);
  return L.join("\n") + "\n";
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

export function isBankDay(iso) {
  const [y, mo, d] = String(iso).split("-").map(Number);
  if (!y || !mo || !d) return false;
  const t = Date.UTC(y, mo - 1, d);
  const wd = new Date(t).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if (mo === 1 && d === 1) return false;
  if (mo === 5 && d === 1) return false;
  if (mo === 12 && (d === 25 || d === 26)) return false;
  const e = easterSunday(y);
  if (t === e - 2 * 86400000 || t === e + 86400000) return false;
  return true;
}

export function nextBankDay(iso) {
  const [y, mo, d] = String(iso).split("-").map(Number);
  let t = Date.UTC(y, mo - 1, d);
  for (let i = 0; i < 10; i++) {
    t += 86400000;
    const dt = new Date(t).toISOString().slice(0, 10);
    if (isBankDay(dt)) return dt;
  }
  return iso;
}

export function buildPrenote(config, members, collectionDate) {
  const iso = collectionDate;
  const [y, mo, d] = iso.split("-");
  const de = `${d}.${mo}.${y}`;
  return members.map((m) => (
    `Sehr geehrte/r ${m.name},\n\n` +
    `wir kündigen an, den Mitgliedsbeitrag von ${formatCents(m.cents)} EUR am ${de} ` +
    `per SEPA-Lastschrift von Ihrem Konto ${m.iban} einzuziehen.\n\n` +
    `Gläubiger-ID: ${config.creditorId}\n` +
    `Mandatsreferenz: ${m.mandateRef}\n` +
    `Verwendungszweck: ${m.purpose || "Mitgliedsbeitrag"}\n\n` +
    `Bei Fragen wenden Sie sich an ${config.name}.\n\n` +
    `Mit freundlichen Grüßen\n${config.name}\n`
  )).join("\n" + "-".repeat(40) + "\n\n");
}
