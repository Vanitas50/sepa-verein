function unesc(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function pick(block, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
  const m = block.match(re);
  return m ? unesc(m[1]).trim() : "";
}

function pickBlock(block, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

export function amountCents(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/[€\s\u00a0]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const f = Number(s);
  if (!isFinite(f)) throw new Error(`Betrag nicht lesbar: ${raw}`);
  return Math.round(f * 100);
}

export function parseCamt053(xml) {
  const txns = [];
  const entryRe = /<(?:[\w]+:)?Ntry\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Ntry>/gi;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const amtAttr = block.match(/<(?:[\w]+:)?Amt\b[^>]*Ccy="([^"]*)"/i);
    const amountRaw = pick(block, "Amt");
    if (!amountRaw) continue;
    let cents;
    try { cents = amountCents(amountRaw); } catch { continue; }
    const dir = (pick(block, "CdtDbtInd") || "CRDT").toUpperCase();
    const date = pick(block, "Dt") || pick(block, "DtTm") || pick(block, "BookgDt");
    const tx = pickBlock(block, "TxDtls") || block;
    const dbtrBlock = pickBlock(tx, "Dbtr");
    const debtorName = dbtrBlock ? pick(dbtrBlock, "Nm") : "";
    const mandateRef = pick(tx, "MndtId") || pick(tx, "CdtrRefInf") || "";
    const remittance = pick(tx, "Ustrd") || "";
    const endToEnd = pick(tx, "EndToEndId") || "";
    txns.push({
      cents, currency: amtAttr ? amtAttr[1] : "EUR",
      credit: dir === "CRDT", date: (date || "").slice(0, 10),
      debtorName, mandateRef, remittance, endToEnd,
    });
  }
  return txns;
}

function parse61(s) {
  const m = s.match(/^(\d{6})(\d{4})?([CD])([A-Z])?([0-9.,]+)/);
  if (!m) return null;
  const cents = Math.round(Number(m[5].replace(/\./g, "").replace(",", ".")) * 100);
  if (!isFinite(cents)) return null;
  return { cents, currency: "EUR", credit: m[3] === "C", date: `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}` };
}

function clean86(txt) {
  return String(txt).replace(/\?\d{2}/g, " ").replace(/\s+/g, " ").trim();
}

export function parseMT940(text) {
  const txns = [];
  let cur = null;
  const push = () => { if (cur) { txns.push(cur); cur = null; } };
  for (const raw of String(text).split(/\r?\n/)) {
    const m61 = raw.match(/^:61:(.*)$/);
    if (m61) {
      push();
      const info = parse61(m61[1]);
      cur = info ? { ...info, debtorName: "", mandateRef: "", remittance: "", endToEnd: "" } : null;
      continue;
    }
    if (/^:86:/.test(raw)) {
      if (cur) {
        const t = clean86(raw.replace(/^:86:/, ""));
        cur.remittance = (cur.remittance ? cur.remittance + " " : "") + t;
      }
      continue;
    }
    if (/^:\d\d/.test(raw)) continue;
    if (cur && raw.trim()) cur.remittance = (cur.remittance + " " + raw.trim()).trim();
  }
  push();
  return txns;
}

export function parseStatement(text) {
  const t = String(text);
  if (t.trimStart().startsWith("<")) return parseCamt053(t);
  if (/:61:/.test(t) || /^:20:/m.test(t)) return parseMT940(t);
  return parseCamt053(t);
}

function key(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function nameTokens(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

export function reconcile(members, txns) {
  const credits = txns.filter((t) => t.credit);
  const used = new Set();
  return members.map((mem) => {
    const memKey = key(mem.name);
    const memTokens = nameTokens(mem.name);
    const refKey = key(mem.mandateRef);
    let match = null;
    for (let i = 0; i < credits.length; i++) {
      if (used.has(i)) continue;
      const t = credits[i];
      if (t.cents !== mem.cents) continue;
      const hay = key(`${t.remittance} ${t.mandateRef} ${t.endToEnd} ${t.debtorName}`);
      const byRef = refKey && hay.includes(refKey);
      const byName = (memKey && key(t.debtorName) === memKey) ||
        (memTokens.length > 0 && memTokens.every((tok) => hay.includes(tok)));
      if (byRef || byName) { match = { txn: t, index: i, by: byRef ? "mandat" : "name" }; break; }
    }
    if (match) used.add(match.index);
    return {
      name: mem.name, mandateRef: mem.mandateRef, cents: mem.cents,
      status: match ? "bezahlt" : "offen",
      method: match ? match.by : null,
      date: match ? match.txn.date : null,
      debtorName: match ? match.txn.debtorName : null,
    };
  });
}

export function summarize(rows) {
  const paid = rows.filter((r) => r.status === "bezahlt");
  const open = rows.filter((r) => r.status === "offen");
  return {
    count: rows.length,
    paidCount: paid.length,
    openCount: open.length,
    paidCents: paid.reduce((s, r) => s + r.cents, 0),
    openCents: open.reduce((s, r) => s + r.cents, 0),
  };
}
