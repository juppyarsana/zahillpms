// One-off, after migration 084 (agents as their own list): tidy up the
// booking sources that used to BE agents.
//
// Migration 084 already made an agent out of every such source (travel agent
// / company / wholesaler type, or with agent billing set) and linked its
// bookings, commissions, invoices and payments to it — nothing about the
// money changes here. This script does the part people will SEE, so it's run
// by hand after checking the dry run:
//
//   1. makes an agent for any agent-like source added since the migration,
//      and links anything still only carrying the source (same rules as 084)
//   2. moves each of those sources' bookings onto the generic source for its
//      kind — Travel Agent / Corporate / Wholesaler — so the Source list is
//      short again; the booking keeps its agent (Edit History gets a note)
//   3. switches the old source off (not deleted — old reports still find its label)
//
// OTA sources that had agent billing set (e.g. an OTA that collects and pays
// later) keep their own source: their bookings aren't moved and the source
// stays on — they only gained an agent record for the billing.
//
// NOTHING IS DELETED. The old source of every moved booking is saved to a
// backup file first (server/maintenance/backups/, gitignored).
//
// Usage (from server/):
//   node maintenance/splitAgentSources.js                 dry run — shows what would change
//   node maintenance/splitAgentSources.js --apply         does it (writes a backup file first)
//   ... --property zahill                                 one property only (slug)
// Safe to run more than once.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const APPLY = process.argv.includes('--apply');
const propIdx = process.argv.indexOf('--property');
const PROPERTY = propIdx > -1 ? process.argv[propIdx + 1] : null;

const AGENT_SOURCE_SQL = `(bs.source_type IN ('travel_agent', 'company', 'wholesaler') OR COALESCE(bs.payment_status, 'normal') <> 'normal')`;
const GENERIC = {   // agent type → the generic source its bookings move to
  travel_agent: { id: 'travel_agent', label: 'Travel Agent', color: '#0891b2', sort: 5, type: 'travel_agent' },
  company:      { id: 'corporate',    label: 'Corporate',    color: '#7c3aed', sort: 6, type: 'company' },
  wholesaler:   { id: 'wholesaler',   label: 'Wholesaler',   color: '#ca8a04', sort: 7, type: 'wholesaler' },
  other:        { id: 'travel_agent', label: 'Travel Agent', color: '#0891b2', sort: 5, type: 'travel_agent' },
};

async function run() {
  const { rows: properties } = await db.query(
    `SELECT id, slug, name FROM properties ${PROPERTY ? 'WHERE slug = $1' : ''} ORDER BY name`,
    PROPERTY ? [PROPERTY] : []
  );
  if (!properties.length) { console.log(PROPERTY ? `No property with slug "${PROPERTY}"` : 'No properties'); return; }
  console.log(APPLY ? '=== APPLY ===\n' : '=== DRY RUN — nothing is changed. Run again with --apply to do it. ===\n');

  const backup = [];
  const backupFile = path.join(__dirname, 'backups', `splitAgentSources-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const saveBackup = () => {
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  };
  for (const p of properties) {
    const { rows: sources } = await db.query(
      `SELECT bs.*, a.id AS agent_id, a.name AS agent_name, a.agent_type,
              (SELECT COUNT(*) FROM bookings b WHERE b.property_id = bs.property_id AND b.source = bs.id)::int AS bookings,
              (SELECT COUNT(*) FROM bookings b WHERE b.property_id = bs.property_id AND b.source = bs.id AND b.agent_id IS NULL)::int AS unlinked,
              (SELECT COUNT(*) FROM agent_invoices x WHERE x.property_id = bs.property_id AND x.source_id = bs.id)::int AS invoices,
              (SELECT COUNT(*) FROM agent_payments x WHERE x.property_id = bs.property_id AND x.source_id = bs.id)::int AS payments,
              (SELECT COUNT(*) FROM agent_commissions x WHERE x.property_id = bs.property_id AND x.source_id = bs.id)::int AS commissions
       FROM booking_sources bs
       LEFT JOIN agents a ON a.property_id = bs.property_id AND a.legacy_source_id = bs.id
       WHERE bs.property_id = $1 AND ${AGENT_SOURCE_SQL}
         AND bs.id NOT IN ('travel_agent', 'corporate', 'wholesaler')
       ORDER BY bs.sort_order, bs.label`,
      [p.id]
    );
    console.log(`── ${p.name} (${p.slug}) ──`);
    if (!sources.length) { console.log('   No agent sources to tidy.\n'); continue; }

    for (const s of sources) {
      const kind = s.agent_type || (['travel_agent', 'company', 'wholesaler'].includes(s.source_type) ? s.source_type : 'other');
      const isOta = s.is_ota || s.source_type === 'ota' || kind === 'ota';
      const target = isOta ? null : GENERIC[kind] || GENERIC.other;
      const money = [s.invoices && `${s.invoices} invoice(s)`, s.payments && `${s.payments} payment(s)`, s.commissions && `${s.commissions} commission(s)`].filter(Boolean).join(', ');
      console.log(`   ${s.label} (${s.id})${s.is_active ? '' : ' — already off'}`);
      console.log(`     agent: ${s.agent_id ? `"${s.agent_name}"` : 'none yet → will be created'}`
        + `${s.unlinked ? ` · ${s.unlinked} booking(s) to link` : ''}${money ? ` · ${money} (move with the agent)` : ''}`);
      console.log(target
        ? `     ${s.bookings} booking(s) → source "${target.label}" · source "${s.label}" switched off`
        : `     OTA — bookings and source stay as they are (agent kept for billing only)`);
      // Rate on the Registration Card / invoices (services/publishRate.js):
      // before = this source's Publish Rate; after = the generic source's
      // (on) unless the agent bills the hotel.
      if (target && s.bookings) {
        const billed = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'].includes(s.payment_status);
        const beforeHidden = s.publish_rate === false;   // how it printed until this release
        const afterHidden = billed;
        console.log(`     rate on Reg. Card / invoice: until now ${beforeHidden ? 'hidden' : 'shown'} → from now ${afterHidden ? 'hidden' : 'shown'}`
          + (beforeHidden !== afterHidden ? (afterHidden ? '  ⚠ CHANGES — the agent pays the hotel later, so the rate is hidden' : '  ⚠ CHANGES — the guest pays the hotel, so the rate will show') : ''));
      }

      if (!APPLY) continue;
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        // 1. agent + links (idempotent — same as migration 084)
        let agentId = s.agent_id;
        if (!agentId) {
          const { rows: [dup] } = await client.query('SELECT 1 FROM agents WHERE property_id = $1 AND lower(name) = lower($2)', [p.id, s.label]);
          const { rows: [a] } = await client.query(
            `INSERT INTO agents (property_id, name, agent_type, payment_status, contact_name, contact_email, contact_phone,
                                 tax_id, billing_address, credit_terms_days, credit_limit, commission_type, commission_value,
                                 is_active, legacy_source_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [p.id, dup ? `${s.label} (${s.id})` : s.label, ['travel_agent', 'company', 'wholesaler', 'ota'].includes(s.source_type) ? s.source_type : 'other',
             s.payment_status || 'normal', s.contact_name, s.contact_email, s.contact_phone, s.tax_id, s.billing_address,
             s.credit_terms_days, s.credit_limit, ['percent', 'amount'].includes(s.commission_type) ? s.commission_type : null,
             s.commission_value, s.is_active, s.id]
          );
          agentId = a.id;
        }
        await client.query('UPDATE bookings SET agent_id = $1 WHERE property_id = $2 AND source = $3 AND agent_id IS NULL', [agentId, p.id, s.id]);
        for (const t of ['agent_commissions', 'agent_invoices', 'agent_payments']) {
          await client.query(`UPDATE ${t} SET agent_id = $1 WHERE property_id = $2 AND source_id = $3 AND agent_id IS NULL`, [agentId, p.id, s.id]);
        }
        if (target) {
          // 2. the generic source (made if this property doesn't have it yet)
          await client.query(
            `INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, source_type, payment_status, property_id)
             VALUES ($1,$2,false,$3,true,$4,$5,'normal',$6) ON CONFLICT DO NOTHING`,
            [target.id, target.label, target.color, target.sort, target.type, p.id]
          );
          await client.query('UPDATE booking_sources SET is_active = true WHERE id = $1 AND property_id = $2', [target.id, p.id]);
          // backup first — the old source of every booking about to move
          const { rows: toMove } = await client.query('SELECT id FROM bookings WHERE property_id = $1 AND source = $2', [p.id, s.id]);
          for (const m of toMove) backup.push({ property: p.slug, booking_id: m.id, old_source: s.id, new_source: target.id, agent_id: agentId });
          if (toMove.length) saveBackup();
          const { rows: moved } = await client.query(
            'UPDATE bookings SET source = $1, updated_at = NOW() WHERE property_id = $2 AND source = $3 RETURNING id',
            [target.id, p.id, s.id]
          );
          for (const m of moved) {
            await client.query(
              'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, NULL)',
              [m.id, `Source: ${s.label} → ${target.label} (agents are now their own list — agent: ${s.agent_name || s.label})`]
            );
          }
          // 3. old source off
          await client.query('UPDATE booking_sources SET is_active = false WHERE id = $1 AND property_id = $2', [s.id, p.id]);
        }
        await client.query('COMMIT');
        console.log('     ✓ done');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log(`     ✗ failed, nothing changed for this source: ${err.message}`);
      } finally {
        client.release();
      }
    }
    console.log('');
  }

  if (APPLY && backup.length) console.log(`Backup of the ${backup.length} moved booking(s): ${backupFile}`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
