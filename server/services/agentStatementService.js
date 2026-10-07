const db = require('../db');
const { round2, computeFolioTotals, PAID_AT_DESK_SQL, billRates } = require('./folioService');

// Agent Accounts / Direct Billing — Slice C.
//
// AR for an agent stays a derived sum over folios. An "open item" is a
// booking that was checked out billed-to-agent (folio_status
// 'pending_agent_invoice' or 'invoiced') and isn't fully covered by
// agent_payment_allocations yet. A booking whose allocations cover its
// folio total moves to folio_status 'paid'.
//
// Since migration 084 everything is per AGENT (agents, bookings.agent_id),
// not per booking source. Rows still carry source_id / source_label as
// aliases of the agent's id / name for older readers (reports, Agents page).

const OPEN_STATUSES = ['pending_agent_invoice', 'invoiced'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = v => UUID_RE.test(String(v || ''));

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + (parseInt(n, 10) || 0)));
  return x.toISOString().slice(0, 10);
}

function ageDays(dueDate) {
  const due = new Date(String(dueDate).slice(0, 10) + 'T00:00:00');
  return Math.floor((startOfToday() - due) / 86400000);
}

// Per-open-booking ledger for one agent (or all, if agentId omitted).
async function bookingLedger(propertyId, { agentId } = {}) {
  const params = [propertyId];
  let agentFilter = '';
  if (agentId) { params.push(agentId); agentFilter = `AND b.agent_id = $${params.length}`; }

  const { rows: [settings] } = await db.query(
    'SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1',
    [propertyId]
  );

  const { rows: items } = await db.query(
    `SELECT b.id AS booking_id, b.agent_id, b.check_in_date, b.check_out_date,
            b.folio_status, b.agent_invoice_id, b.bill_tax_rate, b.bill_service_charge_rate,
            g.name AS guest_name, u.name AS unit_name,
            a.name AS agent_name, a.credit_terms_days, bs.label AS booking_source_label,
            ai.issued_on AS invoice_issued_on, ai.invoice_number,
            -- extras the guest paid at the desk are never billed to the agent
            COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                      WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode = 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS charge_subtotal,
            -- activity lines priced with tax included / no tax (migration 078): no service/tax added
            COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                      WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode <> 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS untaxed_subtotal,
            COALESCE((SELECT SUM(amount) FROM agent_payment_allocations
                      WHERE booking_id = b.id), 0) AS allocated
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN units u ON u.id = b.unit_id
     LEFT JOIN agents a ON a.id = b.agent_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     LEFT JOIN agent_invoices ai ON ai.id = b.agent_invoice_id
     WHERE b.property_id = $1
       AND b.folio_status IN ('pending_agent_invoice','invoiced')
       AND b.status NOT IN ('cancelled','no_show')
       ${agentFilter}
     ORDER BY b.check_out_date, b.id`,
    params
  );

  return items.map(r => {
    const rates = billRates(r, settings);   // the booking's own bill rates (081)
    const folio_total = round2(computeFolioTotals(
      parseFloat(r.charge_subtotal), rates.tax_rate, rates.service_charge_rate
    ).total + parseFloat(r.untaxed_subtotal));
    const allocated = round2(parseFloat(r.allocated));
    const balance = round2(folio_total - allocated);
    // Due = invoiced (or checked out, not invoiced yet) + the agent's credit
    // terms; no terms = due straight away. Overdue / aging count from here.
    const due_date = addDays(String((r.invoice_issued_on || r.check_out_date)).slice(0, 10), r.credit_terms_days || 0);
    return {
      booking_id: r.booking_id, agent_id: r.agent_id, agent_name: r.agent_name || 'No agent',
      source_id: r.agent_id, source_label: r.agent_name || 'No agent',   // aliases (pre-084 readers)
      booking_source_label: r.booking_source_label,
      guest_name: r.guest_name, unit_name: r.unit_name,
      check_in_date: String(r.check_in_date).slice(0, 10),
      check_out_date: String(r.check_out_date).slice(0, 10),
      folio_status: r.folio_status, agent_invoice_id: r.agent_invoice_id,
      invoice_number: r.invoice_number || null,
      folio_total, allocated, balance,
      due_date, credit_terms_days: r.credit_terms_days, age_days: ageDays(due_date),
    };
  }).filter(r => r.balance > 0.005);
}

function bucketFor(age) {
  if (age <= 0) return 'current';
  if (age <= 30) return 'd1_30';
  if (age <= 60) return 'd31_60';
  if (age <= 90) return 'd61_90';
  return 'd90_plus';
}

function emptyBuckets(agent) {
  return {
    agent_id: agent.id, agent_name: agent.name, agent_type: agent.agent_type || null,
    source_id: agent.id, source_label: agent.name,   // aliases (pre-084 readers)
    payment_status: agent.payment_status, credit_limit: agent.credit_limit == null ? null : parseFloat(agent.credit_limit),
    current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0,
    total_outstanding: 0, unpaid_commission: 0, open_count: 0,
  };
}

// AR aging: one row per agent (active ones, plus any inactive one still owed
// or owing commission). agentId → just that agent's row.
async function aging(propertyId, { agentId } = {}) {
  const params = [propertyId];
  let idFilter = 'AND is_active = true';
  if (agentId) { params.push(agentId); idFilter = `AND id = $2`; }
  const { rows: agents } = await db.query(
    `SELECT id, name, agent_type, payment_status, credit_limit FROM agents
     WHERE property_id = $1 ${idFilter}
     ORDER BY lower(name)`,
    params
  );

  const bySource = {};
  for (const a of agents) bySource[a.id] = emptyBuckets(a);
  const { rows: all } = await db.query('SELECT id, name, agent_type, payment_status, credit_limit FROM agents WHERE property_id = $1', [propertyId]);
  const known = Object.fromEntries(all.map(a => [a.id, a]));
  const rowFor = id => bySource[id] || (bySource[id] = emptyBuckets(known[id] || { id, name: 'No agent', payment_status: null }));

  const ledger = await bookingLedger(propertyId, { agentId });
  for (const item of ledger) {
    const row = rowFor(item.agent_id);
    const b = bucketFor(item.age_days);
    row[b] = round2(row[b] + item.balance);
    row.total_outstanding = round2(row.total_outstanding + item.balance);
    row.open_count += 1;
  }

  const commParams = [propertyId];
  let commFilter = '';
  if (agentId) { commParams.push(agentId); commFilter = `AND agent_id = $2`; }
  const { rows: comm } = await db.query(
    `SELECT agent_id, COALESCE(SUM(amount), 0) AS unpaid
     FROM agent_commissions
     WHERE property_id = $1 AND status = 'unpaid' ${commFilter}
     GROUP BY agent_id`,
    commParams
  );
  for (const c of comm) {
    rowFor(c.agent_id).unpaid_commission = round2(parseFloat(c.unpaid));
  }

  const rows = Object.values(bySource);
  return agentId ? (bySource[agentId] || emptyBuckets(known[agentId] || { id: agentId, name: 'No agent', payment_status: null })) : rows;
}

// Full per-agent statement payload for the detail page.
async function statement(propertyId, agentId) {
  if (!isUuid(agentId)) return null;
  const { rows: [agent] } = await db.query(
    `SELECT *, name AS label, agent_type AS source_type FROM agents WHERE id = $1 AND property_id = $2`,
    [agentId, propertyId]
  );
  if (!agent) return null;

  const [openItems, agingRow] = await Promise.all([
    bookingLedger(propertyId, { agentId }),
    aging(propertyId, { agentId }),
  ]);

  const { rows: payments } = await db.query(
    `SELECT ap.*, (SELECT name FROM users WHERE id = ap.voided_by) AS voided_by_name,
            COALESCE(json_agg(json_build_object(
              'booking_id', al.booking_id, 'amount', al.amount,
              'guest_name', g.name, 'check_out_date', b.check_out_date
            ) ORDER BY b.check_out_date) FILTER (WHERE al.id IS NOT NULL), '[]') AS allocations
     FROM agent_payments ap
     LEFT JOIN agent_payment_allocations al ON al.agent_payment_id = ap.id
     LEFT JOIN bookings b ON b.id = al.booking_id
     LEFT JOIN guests g ON g.id = b.guest_id
     WHERE ap.property_id = $1 AND ap.agent_id = $2
     GROUP BY ap.id
     ORDER BY ap.is_voided, ap.received_on DESC, ap.created_at DESC`,
    [propertyId, agentId]
  );

  const { rows: invoices } = await db.query(
    `SELECT ai.*,
            (SELECT COUNT(*) FROM bookings WHERE agent_invoice_id = ai.id) AS booking_count
     FROM agent_invoices ai
     WHERE ai.property_id = $1 AND ai.agent_id = $2
     ORDER BY ai.issued_on DESC, ai.created_at DESC`,
    [propertyId, agentId]
  );

  const { rows: commissions } = await db.query(
    `SELECT ac.id, ac.amount, ac.status, ac.computed_at, ac.booking_id,
            g.name AS guest_name, b.check_out_date
     FROM agent_commissions ac
     JOIN bookings b ON b.id = ac.booking_id
     JOIN guests g ON g.id = b.guest_id
     WHERE ac.property_id = $1 AND ac.agent_id = $2
     ORDER BY ac.computed_at DESC`,
    [propertyId, agentId]
  );

  // Every booking with this agent (migration 084) — upcoming, in house,
  // checked out, cancelled — so the page shows them all, not only the money.
  const { rows: bookings } = await db.query(
    `SELECT b.id, b.reservation_group_id, b.check_in_date, b.check_out_date, b.nights, b.status, b.folio_status,
            b.total_amount, COALESCE(b.discount_amount, 0) AS discount_amount, b.commission_type, b.commission_value,
            g.name AS guest_name, u.name AS unit_name, ai.invoice_number,
            (SELECT COALESCE(SUM(amount), 0) FROM agent_commissions ac WHERE ac.booking_id = b.id) AS commission_posted
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN units u ON u.id = b.unit_id
     LEFT JOIN agent_invoices ai ON ai.id = b.agent_invoice_id
     WHERE b.property_id = $1 AND b.agent_id = $2
     ORDER BY b.check_in_date DESC, u.name
     LIMIT 1000`,
    [propertyId, agentId]
  );

  return { agent, aging: agingRow, open_items: openItems, payments, invoices, commissions, bookings };
}

async function reconcileBookingStatuses(client, propertyId, bookingIds) {
  const ids = [...new Set(bookingIds)];
  if (!ids.length) return;
  const { rows: [settings] } = await client.query(
    'SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1',
    [propertyId]
  );
  for (const id of ids) {
    const { rows: [b] } = await client.query(
      'SELECT id, agent_invoice_id, folio_status, bill_tax_rate, bill_service_charge_rate FROM bookings WHERE id = $1 AND property_id = $2',
      [id, propertyId]
    );
    if (!b || !['pending_agent_invoice', 'invoiced', 'paid'].includes(b.folio_status)) continue;
    const { rows: [{ subtotal, untaxed }] } = await client.query(
      `SELECT COALESCE(SUM(fc.amount) FILTER (WHERE fc.tax_mode = 'added'), 0) AS subtotal,
              COALESCE(SUM(fc.amount) FILTER (WHERE fc.tax_mode <> 'added'), 0) AS untaxed
       FROM folio_charges fc
       WHERE fc.booking_id = $1 AND fc.is_voided = false AND NOT ${PAID_AT_DESK_SQL}`,
      [id]
    );
    const { rows: [{ allocated }] } = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS allocated FROM agent_payment_allocations WHERE booking_id = $1',
      [id]
    );
    const rates = billRates(b, settings);
    const total = round2(computeFolioTotals(parseFloat(subtotal), rates.tax_rate, rates.service_charge_rate).total + parseFloat(untaxed));
    const covered = parseFloat(allocated) + 0.005 >= total && total > 0;
    const next = covered ? 'paid' : (b.agent_invoice_id ? 'invoiced' : 'pending_agent_invoice');
    if (next !== b.folio_status) {
      await client.query('UPDATE bookings SET folio_status = $1, updated_at = NOW() WHERE id = $2', [next, id]);
    }
  }
}

function autoAllocate(amount, ledger) {
  const out = [];
  let remaining = round2(amount);
  for (const l of ledger) {
    if (remaining <= 0.005) break;
    const take = round2(Math.min(remaining, l.balance));
    if (take > 0) { out.push({ booking_id: l.booking_id, amount: take }); remaining = round2(remaining - take); }
  }
  return out;
}

async function recordPayment(propertyId, agentId, body, userId) {
  const amount = round2(parseFloat(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount must be a positive number' };
  if (!isUuid(agentId)) return { error: 'Agent not found' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [agent] } = await client.query(
      'SELECT id FROM agents WHERE id = $1 AND property_id = $2', [agentId, propertyId]
    );
    if (!agent) { await client.query('ROLLBACK'); return { error: 'Agent not found' }; }

    const ledger = await bookingLedger(propertyId, { agentId });
    const balByBooking = Object.fromEntries(ledger.map(l => [l.booking_id, l.balance]));

    let allocs;
    if (Array.isArray(body.allocations) && body.allocations.length) {
      allocs = body.allocations
        .map(a => ({ booking_id: a.booking_id, amount: round2(parseFloat(a.amount)) }))
        .filter(a => a.amount > 0);
      for (const a of allocs) {
        if (!(a.booking_id in balByBooking)) { await client.query('ROLLBACK'); return { error: 'An allocation references a booking that is not an open item' }; }
        if (a.amount - balByBooking[a.booking_id] > 0.005) { await client.query('ROLLBACK'); return { error: `An allocation exceeds the open balance for booking ${a.booking_id.slice(0, 8)}` }; }
      }
    } else {
      allocs = autoAllocate(amount, ledger);
    }

    if (round2(allocs.reduce((s, a) => s + a.amount, 0)) - amount > 0.005) {
      await client.query('ROLLBACK');
      return { error: 'Allocations exceed the payment amount' };
    }

    const { rows: [payment] } = await client.query(
      `INSERT INTO agent_payments (property_id, agent_id, amount, method, received_on, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8) RETURNING *`,
      [propertyId, agentId, amount, body.method || null, body.received_on || null,
        body.reference || null, body.notes || null, userId || null]
    );
    for (const a of allocs) {
      await client.query(
        'INSERT INTO agent_payment_allocations (agent_payment_id, booking_id, amount) VALUES ($1,$2,$3)',
        [payment.id, a.booking_id, a.amount]
      );
    }
    await reconcileBookingStatuses(client, propertyId, allocs.map(a => a.booking_id));
    await client.query('COMMIT');
    return { payment, allocations: allocs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updatePayment(propertyId, paymentId, body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [payment] } = await client.query(
      'SELECT * FROM agent_payments WHERE id = $1 AND property_id = $2', [paymentId, propertyId]
    );
    if (!payment) { await client.query('ROLLBACK'); return { error: 'Payment not found' }; }
    if (payment.is_voided) { await client.query('ROLLBACK'); return { error: 'This payment was voided — it can\'t be changed' }; }

    const { rows: oldAllocs } = await client.query(
      'SELECT booking_id FROM agent_payment_allocations WHERE agent_payment_id = $1', [paymentId]
    );
    const affected = oldAllocs.map(a => a.booking_id);

    if (Array.isArray(body.allocations)) {
      const ledger = await bookingLedger(propertyId, { agentId: payment.agent_id });
      // add back this payment's current allocations to each booking's available balance
      const currentByBooking = {};
      const { rows: cur } = await client.query(
        'SELECT booking_id, amount FROM agent_payment_allocations WHERE agent_payment_id = $1', [paymentId]
      );
      for (const c of cur) currentByBooking[c.booking_id] = round2(parseFloat(c.amount));
      const availByBooking = {};
      for (const l of ledger) availByBooking[l.booking_id] = round2(l.balance + (currentByBooking[l.booking_id] || 0));
      // bookings that were on this payment but are now 'paid' (not in ledger) still allow re-allocation up to their current allocation
      for (const [bid, amt] of Object.entries(currentByBooking)) {
        if (!(bid in availByBooking)) availByBooking[bid] = amt;
      }

      const allocs = body.allocations
        .map(a => ({ booking_id: a.booking_id, amount: round2(parseFloat(a.amount)) }))
        .filter(a => a.amount > 0);
      for (const a of allocs) {
        if (!(a.booking_id in availByBooking)) { await client.query('ROLLBACK'); return { error: 'An allocation references a booking that is not an open item' }; }
        if (a.amount - availByBooking[a.booking_id] > 0.005) { await client.query('ROLLBACK'); return { error: `An allocation exceeds the open balance for booking ${a.booking_id.slice(0, 8)}` }; }
      }
      if (round2(allocs.reduce((s, a) => s + a.amount, 0)) - parseFloat(payment.amount) > 0.005) {
        await client.query('ROLLBACK');
        return { error: 'Allocations exceed the payment amount' };
      }
      await client.query('DELETE FROM agent_payment_allocations WHERE agent_payment_id = $1', [paymentId]);
      for (const a of allocs) {
        await client.query(
          'INSERT INTO agent_payment_allocations (agent_payment_id, booking_id, amount) VALUES ($1,$2,$3)',
          [paymentId, a.booking_id, a.amount]
        );
      }
      affected.push(...allocs.map(a => a.booking_id));
    }

    const sets = [];
    const vals = [];
    for (const f of ['method', 'received_on', 'reference', 'notes']) {
      if (body[f] !== undefined) { vals.push(body[f] === '' ? null : body[f]); sets.push(`${f} = $${vals.length}`); }
    }
    if (sets.length) {
      vals.push(paymentId, propertyId);
      await client.query(
        `UPDATE agent_payments SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND property_id = $${vals.length}`,
        vals
      );
    }

    await reconcileBookingStatuses(client, propertyId, affected);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Voids an agent payment recorded by mistake (migration 100): the row is kept
// (who / when / why, and the allocations it had), never counted again; the
// stays it paid are unpaid again. Reason required.
async function voidPayment(propertyId, paymentId, reason, userId) {
  const why = String(reason || '').trim().slice(0, 500);
  if (!why) return { error: 'A reason is required', code: 'REASON_REQUIRED', status: 400 };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [payment] } = await client.query(
      'SELECT * FROM agent_payments WHERE id = $1 AND property_id = $2 FOR UPDATE', [paymentId, propertyId]
    );
    if (!payment) { await client.query('ROLLBACK'); return { error: 'Payment not found', status: 404 }; }
    if (payment.is_voided) { await client.query('ROLLBACK'); return { error: 'This payment is already voided', status: 409 }; }
    const { rows: allocs } = await client.query(
      'DELETE FROM agent_payment_allocations WHERE agent_payment_id = $1 RETURNING booking_id, amount', [paymentId]
    );
    await client.query(
      `UPDATE agent_payments SET is_voided = true, voided_at = NOW(), voided_by = $1, void_reason = $2, voided_allocations = $3 WHERE id = $4`,
      [userId || null, why, JSON.stringify(allocs), paymentId]
    );
    await reconcileBookingStatuses(client, propertyId, allocs.map(a => a.booking_id));
    const ids = allocs.map(a => a.booking_id);
    if (ids.length) {
      await client.query(
        'INSERT INTO booking_events (booking_id, note, created_by) SELECT unnest($1::uuid[]), $2, $3',
        [ids, `Agent payment of Rp ${Math.round(parseFloat(payment.amount)).toLocaleString('id-ID')} voided — this stay is unpaid by the agent again. Reason: ${why}`.slice(0, 1000), userId || null]);
    }
    await client.query('COMMIT');
    return { ok: true, amount: parseFloat(payment.amount), bookings: ids };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function nextInvoiceNumber(client, propertyId) {
  const now = new Date();
  const prefix = `AG-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*) AS count FROM agent_invoices WHERE property_id = $1 AND invoice_number LIKE $2`,
    [propertyId, prefix + '%']
  );
  return prefix + String(parseInt(count) + 1).padStart(3, '0');
}

async function createInvoice(propertyId, agentId, body, userId) {
  if (!isUuid(agentId)) return { error: 'Agent not found' };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [agent] } = await client.query(
      'SELECT id FROM agents WHERE id = $1 AND property_id = $2', [agentId, propertyId]
    );
    if (!agent) { await client.query('ROLLBACK'); return { error: 'Agent not found' }; }

    const ledger = await bookingLedger(propertyId, { agentId });
    let targets = ledger.filter(l => l.folio_status === 'pending_agent_invoice');
    if (Array.isArray(body.booking_ids) && body.booking_ids.length) {
      const wanted = new Set(body.booking_ids);
      targets = targets.filter(l => wanted.has(l.booking_id));
    } else if (body.period_start || body.period_end) {
      targets = targets.filter(l =>
        (!body.period_start || l.check_out_date >= body.period_start) &&
        (!body.period_end || l.check_out_date <= body.period_end)
      );
    }
    if (!targets.length) { await client.query('ROLLBACK'); return { error: 'No un-invoiced open bookings match' }; }

    const total = round2(targets.reduce((s, t) => s + t.folio_total, 0));
    const invoiceNumber = await nextInvoiceNumber(client, propertyId);
    const { rows: [invoice] } = await client.query(
      `INSERT INTO agent_invoices (property_id, agent_id, invoice_number, period_start, period_end, total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [propertyId, agentId, invoiceNumber, body.period_start || null, body.period_end || null,
        total, body.notes || null, userId || null]
    );
    await client.query(
      `UPDATE bookings SET agent_invoice_id = $1, folio_status = 'invoiced', updated_at = NOW()
       WHERE property_id = $2 AND id = ANY($3::uuid[]) AND folio_status = 'pending_agent_invoice'`,
      [invoice.id, propertyId, targets.map(t => t.booking_id)]
    );
    await client.query('COMMIT');
    return { invoice };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Data for the consolidated invoice PDF.
async function invoicePayload(propertyId, invoiceId) {
  const { rows: [invoice] } = await db.query(
    'SELECT * FROM agent_invoices WHERE id = $1 AND property_id = $2', [invoiceId, propertyId]
  );
  if (!invoice) return null;

  const { rows: [agent] } = await db.query(
    `SELECT id, name AS label, billing_address, tax_id, contact_name, contact_email, contact_phone, credit_terms_days
     FROM agents WHERE id = $1 AND property_id = $2`,
    [invoice.agent_id, propertyId]
  );
  const { rows: [property] } = await db.query(
    `SELECT property_name, property_address, property_phone, property_email, logo_url,
            tax_rate, service_charge_rate
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const { rows: bookings } = await db.query(
    `SELECT b.id AS booking_id, b.check_in_date, b.check_out_date, g.name AS guest_name, u.name AS unit_name,
            b.bill_tax_rate, b.bill_service_charge_rate,
            COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                      WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode = 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS charge_subtotal,
            -- activity lines priced with tax included / no tax (migration 078): no service/tax added
            COALESCE((SELECT SUM(fc.amount) FROM folio_charges fc
                      WHERE fc.booking_id = b.id AND fc.is_voided = false AND fc.tax_mode <> 'added' AND NOT ${PAID_AT_DESK_SQL}), 0) AS untaxed_subtotal,
            COALESCE((SELECT SUM(amount) FROM agent_payment_allocations WHERE booking_id = b.id), 0) AS allocated
     FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
     WHERE b.agent_invoice_id = $1 AND b.property_id = $2
     ORDER BY b.check_out_date, b.id`,
    [invoiceId, propertyId]
  );

  const lines = bookings.map(b => {
    const rates = billRates(b, property);
    const total = round2(computeFolioTotals(parseFloat(b.charge_subtotal), rates.tax_rate, rates.service_charge_rate).total + parseFloat(b.untaxed_subtotal));
    return {
      booking_id: b.booking_id,
      guest_name: b.guest_name, unit_name: b.unit_name,
      check_in_date: String(b.check_in_date).slice(0, 10),
      check_out_date: String(b.check_out_date).slice(0, 10),
      amount: total,
      paid: round2(parseFloat(b.allocated)),
    };
  });
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const paid = round2(lines.reduce((s, l) => s + l.paid, 0));

  const terms = parseInt(agent?.credit_terms_days, 10) || 0;
  const due_date = addDays(String(invoice.issued_on instanceof Date ? invoice.issued_on.toISOString() : invoice.issued_on).slice(0, 10), terms);
  return { invoice, agent: agent || {}, property: property || {}, lines, total, paid, balance: round2(total - paid), due_date, credit_terms_days: terms };
}

// Voids an agent invoice issued by mistake. The invoice is kept (number and
// all, marked voided); its stays are un-invoiced again — back on the agent's
// open items, ready for a new invoice. Payments the agent already made stay
// allocated to the stays they paid (a stay fully paid stays "paid").
async function voidInvoice(propertyId, invoiceId, reason, userId) {
  const why = String(reason || '').trim().slice(0, 500);
  if (!why) return { error: 'A reason is required', code: 'REASON_REQUIRED', status: 400 };
  if (!isUuid(invoiceId)) return { error: 'Invoice not found', status: 404 };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inv] } = await client.query(
      'SELECT * FROM agent_invoices WHERE id = $1 AND property_id = $2 FOR UPDATE', [invoiceId, propertyId]);
    if (!inv) { await client.query('ROLLBACK'); return { error: 'Invoice not found', status: 404 }; }
    if (inv.voided_at) { await client.query('ROLLBACK'); return { error: 'This invoice is already voided', status: 409 }; }
    const { rows: stays } = await client.query(
      'UPDATE bookings SET agent_invoice_id = NULL, updated_at = NOW() WHERE agent_invoice_id = $1 AND property_id = $2 RETURNING id',
      [inv.id, propertyId]);
    const ids = stays.map(r => r.id);
    await reconcileBookingStatuses(client, propertyId, ids);   // invoiced → pending_agent_invoice (a paid stay stays paid)
    await client.query('UPDATE agent_invoices SET voided_at = NOW(), voided_by = $1, void_reason = $2 WHERE id = $3', [userId || null, why, inv.id]);
    if (ids.length) {
      await client.query(
        'INSERT INTO booking_events (booking_id, note, created_by) SELECT unnest($1::uuid[]), $2, $3',
        [ids, `Agent invoice ${inv.invoice_number} voided — this stay can be invoiced again. Reason: ${why}`.slice(0, 1000), userId || null]);
    }
    await client.query('COMMIT');
    return { ok: true, invoice_number: inv.invoice_number, bookings: ids };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function setCommissionStatus(propertyId, commissionId, status) {
  if (!['paid', 'unpaid'].includes(status)) return { error: 'status must be paid or unpaid' };
  const { rows: [row] } = await db.query(
    `UPDATE agent_commissions SET status = $1
     WHERE id = $2 AND property_id = $3 RETURNING *`,
    [status, commissionId, propertyId]
  );
  if (!row) return { error: 'Commission not found' };
  return { commission: row };
}

module.exports = {
  bookingLedger, aging, statement, recordPayment, updatePayment, voidPayment,
  createInvoice, invoicePayload, setCommissionStatus, voidInvoice,
};
