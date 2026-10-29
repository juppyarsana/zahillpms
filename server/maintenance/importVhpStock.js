// Import the old PMS's (VHP) "Stock Onhand List" of the HK Store as PMS stock
// items (Operations → Stock), with their quantity and average cost as the
// opening stock. The Bar Store goes to the restaurant app (POS) instead —
// see the POS repo's scripts/import-vhp-stock.js.
//
//   • Reads VHP's printed text export (one or more .txt files); only articles
//     of the chosen store (default "HK Store") are taken, other stores listed.
//   • Name: VHP's description, tidied ("Clean :Taski R3" → "Clean: Taski R3").
//   • Unit: kg / g / l / ml / pcs (Lt, Ltr, Lit → l; Btl, Pac, Bks, blank → pcs).
//   • Category: from VHP's group (Spa, Guest supplies, coffee / tea / sugar /
//     water for the rooms → Guest supplies & amenities; everything else → Supplies).
//   • The same item twice (two files) is added up, at the weighted average cost.
//   • An item already in the PMS (same name) is left alone and listed.
//   • Each item gets one stock movement "Opening stock from VHP …" (reason
//     adjustment). The stock opname afterwards sets the real counts.
//
// Usage (from server/):
//   node maintenance/importVhpStock.js --property zahill --file "<HK STORE 1.txt>" --file "<HK STORE 2.txt>" …
//       dry run: done and rolled back — the report is exactly what --apply does
//   ... --apply                  do it; writes a run file to maintenance/backups/ (needed for --undo)
//   ... --store "HK Store"       which VHP store to take (default HK Store)
//   node maintenance/importVhpStock.js --undo maintenance/backups/vhp-stock-<…>.json [--apply]
//       removes the imported items nobody has touched since (dry run first)
// Pointed at another database with DATABASE_URL=… (the script prints which one it is on).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const TAG = 'Opening stock from VHP';
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const opts = n => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const APPLY = flag('--apply');

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = s => Number(String(s).replace(/,/g, ''));
const isNum = s => /^-?[\d,]+(\.\d+)?$/.test(s);
const r4 = n => Math.round(n * 10000) / 10000;

// ── VHP's text export ──
// Article lines: "<7-digit code> <description>  <unit?>  qty value content <d-unit?> content lastPP pPrice avg min mustOrder".
// A group's name comes on its subtotal line AFTER its articles.
function parseVhp(text, file) {
  const items = [];
  let store = null, date = null, pending = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/For Date\s*:\s*(\d\d)\/(\d\d)\/(\d\d)/))) date = `20${m[3]}-${m[2]}-${m[1]}`;
    if ((m = line.match(/^\s+(\d\d) (.*Store)$/))) { store = m[2].trim(); continue; }
    if ((m = line.match(/^(\d{7}) (.+?)(?:\s{2,}(.*))$/))) {
      const t = m[3].trim().split(/\s+/);
      const unit = isNum(t[0]) ? '' : t.shift();
      if (t.length < 9 || !isNum(t[0]) || !isNum(t[1])) throw new Error(`${file}: can't read the line "${line.trim()}"`);
      const tail = t.slice(-6).map(num);
      pending.push({ code: m[1], desc: m[2].trim(), unit, qty: num(t[0]), value: num(t[1]), avg: tail[3], store, file });
      continue;
    }
    if ((m = line.match(/^\s+([A-Z][A-Z &/]+?)\s{2,}[\d,]+\.\d\d$/)) && !/^GRAND/.test(m[1])) {
      for (const it of pending) items.push({ ...it, group: m[1].trim() });
      pending = [];
    }
  }
  for (const it of pending) items.push({ ...it, group: '' });
  return { items, date };
}

const tidyName = s => s.replace(/\s+/g, ' ').replace(/^([A-Za-z]+)\s*:\s*/, '$1: ').trim();
function pmsUnit(u) {
  const k = String(u || '').toLowerCase();
  if (['l', 'lt', 'ltr', 'lit', 'liter', 'litre'].includes(k)) return 'l';
  if (k === 'kg') return 'kg';
  if (['g', 'gr', 'gram'].includes(k)) return 'g';
  if (k === 'ml') return 'ml';
  return 'pcs';
}
const GUEST_GROUPS = ['SPA', 'GUEST SUPPLIES', 'GROCERIES', 'COFEE & TEA', 'COFFEE & TEA', 'MINERAL WATER', 'SOFTDRINK'];
const pmsCategory = group => (GUEST_GROUPS.includes(group) ? 'guest_supplies' : 'supplies');

async function run() {
  const slug = opt('--property');
  const files = opts('--file');
  const storeName = opt('--store') || 'HK Store';
  if (!slug || !files.length) throw new Error('Give --property <slug> and at least one --file');
  const { rows: [prop] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!prop) throw new Error(`No property "${slug}"`);

  // Read every file
  let all = [], dates = new Set();
  for (const f of files) {
    const { items, date } = parseVhp(fs.readFileSync(f, 'utf8'), path.basename(f));
    all = all.concat(items);
    if (date) dates.add(date);
  }
  const other = all.filter(i => i.store !== storeName);
  const mine = all.filter(i => i.store === storeName);
  const date = [...dates].join(', ') || 'unknown';

  // Checks + merge by name
  const warnings = [];
  const byName = new Map();
  for (const it of mine) {
    if (Math.abs(it.qty * it.avg - it.value) > Math.max(1, it.value * 0.001))
      warnings.push(`${it.code} ${it.desc}: quantity × average ${rp(it.qty * it.avg)} ≠ value ${rp(it.value)} — value used`);
    const name = tidyName(it.desc);
    const unit = pmsUnit(it.unit);
    if (!it.unit) warnings.push(`${it.code} ${it.desc}: no unit in VHP — imported as pcs`);
    const prev = byName.get(name.toLowerCase());
    if (prev) {
      if (prev.unit !== unit) throw new Error(`"${name}" is in two files with different units`);
      prev.qty += it.qty; prev.value += it.value; prev.codes.push(it.code);
      warnings.push(`${name}: in two files — added up`);
    } else {
      byName.set(name.toLowerCase(), { name, unit, category: pmsCategory(it.group), group: it.group, qty: it.qty, value: it.value, codes: [it.code], vhpUnit: it.unit });
    }
  }

  const { rows: [dbName] } = await db.query('SELECT current_database() AS d');
  console.log(`Database: ${dbName.d} · Property: ${prop.name} · Store: ${storeName} · VHP date: ${date}`);
  console.log(APPLY ? 'APPLY — changes will be kept\n' : 'DRY RUN — nothing is kept (add --apply)\n');

  const client = await db.pool.connect();
  const created = [], skipped = [];
  try {
    await client.query('BEGIN');
    for (const it of byName.values()) {
      const { rows: [dup] } = await client.query(
        'SELECT id, stock_quantity FROM raw_materials WHERE property_id = $1 AND lower(name) = lower($2)', [prop.id, it.name]);
      if (dup) { skipped.push(it); continue; }
      const cost = it.qty > 0 ? r4(it.value / it.qty) : null;
      const { rows: [r] } = await client.query(
        `INSERT INTO raw_materials (property_id, name, unit_of_measure, category, stock_quantity, cost_per_unit)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [prop.id, it.name, it.unit, it.category, it.qty, cost]);
      await client.query(
        `INSERT INTO raw_material_movements (property_id, raw_material_id, change_qty, reason, note)
         VALUES ($1, $2, $3, 'adjustment', $4)`,
        [prop.id, r.id, it.qty, `${TAG} (${storeName}, ${date}; VHP ${it.codes.join(', ')})`]);
      created.push({ ...it, id: r.id, cost });
    }

    const cat = { guest_supplies: 'Guest supplies', supplies: 'Supplies' };
    console.log(`Items to create: ${created.length}`);
    for (const it of created)
      console.log(`  + ${it.name.padEnd(46)} ${String(it.qty).padStart(9)} ${it.unit.padEnd(3)} @ ${rp(it.cost).padStart(11)} = ${rp(it.value).padStart(13)}  ${cat[it.category]}${it.vhpUnit && pmsUnit(it.vhpUnit) !== it.vhpUnit.toLowerCase() ? `  (VHP ${it.vhpUnit})` : ''}`);
    if (skipped.length) {
      console.log(`\nAlready in the PMS — left as they are: ${skipped.length}`);
      for (const it of skipped) console.log(`  = ${it.name}`);
    }
    if (other.length) console.log(`\nNot this store (left out): ${other.length} articles of ${[...new Set(other.map(o => o.store))].join(', ')}`);
    if (warnings.length) { console.log('\nTo look at:'); for (const w of warnings) console.log('  ! ' + w); }
    const total = created.reduce((s, i) => s + i.value, 0);
    const vhpTotal = mine.reduce((s, i) => s + i.value, 0);
    console.log(`\nValue imported: ${rp(total)} · VHP ${storeName} total: ${rp(vhpTotal)}${skipped.length ? ' (less the items already in the PMS)' : ''}`);

    if (APPLY) {
      await client.query('COMMIT');
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `vhp-stock-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({ property: slug, property_id: prop.id, store: storeName, date, items: created.map(i => ({ id: i.id, name: i.name, qty: i.qty })) }, null, 2));
      console.log(`\nDone. Run file (for --undo): ${file}`);
    } else {
      await client.query('ROLLBACK');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function undo(file) {
  const runFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(APPLY ? 'UNDO — APPLY\n' : 'UNDO — DRY RUN (add --apply)\n');
  const client = await db.pool.connect();
  const removed = [], kept = [];
  try {
    await client.query('BEGIN');
    for (const it of runFile.items) {
      const { rows: [r] } = await client.query(
        `SELECT rm.stock_quantity, (SELECT count(*) FROM raw_material_movements m WHERE m.raw_material_id = rm.id)::int AS moves
         FROM raw_materials rm WHERE rm.id = $1 AND rm.property_id = $2`, [it.id, runFile.property_id]);
      if (!r) continue;
      if (r.moves > 1 || Number(r.stock_quantity) !== Number(it.qty)) { kept.push(`${it.name} — used since the import`); continue; }
      await client.query('SAVEPOINT s');
      try {
        await client.query('DELETE FROM raw_materials WHERE id = $1', [it.id]);
        await client.query('RELEASE SAVEPOINT s');
        removed.push(it.name);
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT s');
        kept.push(`${it.name} — on a purchase order, request or stock opname`);
      }
    }
    console.log(`Removed: ${removed.length}`);
    if (kept.length) { console.log(`Kept: ${kept.length}`); for (const k of kept) console.log('  = ' + k); }
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

(opt('--undo') ? undo(opt('--undo')) : run())
  .then(() => process.exit(0))
  .catch(e => { console.error('✗ ' + e.message); process.exit(1); });
