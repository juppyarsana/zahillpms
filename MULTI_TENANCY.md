# Multi-tenancy Migration Guide

## Status as of 2026-07-17 — everything below this box is the original plan

**Done: migrations 019–026, all applied and verified end-to-end against a live second property (Birdnest).**

### What's live
- **019–021** — core multi-tenancy: `property_id` on every table, every route scoped, per-property `display_token` (replacing the old global `DISPLAY_TOKEN` env var), fixed unique constraints that would've collided across two properties (`booking_sources.id`, `payment_methods.id`, `roles.id`, `competitors.place_id`, `search_trends`).
- **022** — property module system. `property_modules` table, `server/modules.js` (module → route map), `middleware/moduleGuard.js`. Routes are gated in `server/index.js`; disabled modules return `403 {"error":"Module not enabled for this property"}`. `GET /api/settings/modules` (owner-only) returns the enabled/disabled state for the frontend nav.
- **023–026** — superadmin + property onboarding API. `middleware/authSuperAdmin.js`, `routes/admin.js`, `utils/seedPropertyDefaults.js`. A superadmin (separate from property owners — `is_superadmin` flag on `users`, `property_id` nullable for them) can create a property via `POST /api/admin/properties` and it's fully seeded (settings, modules, booking sources, payment methods, roles) in one call.

### Credentials to know about
- **Superadmin**: `admin@platform.com` / `superadmin123` — **change this password before going anywhere near production**, it's a seeded placeholder.
- **Demo second property** ("Birdnest", slug `birdnest`) exists in the dev DB from verification — has its own owner login `owner@birdnest.com` / `testpass123`. Delete it or keep it as a reference; it's harmless either way (fully isolated from Zahill's data).

### Bugs found & fixed while building this (all pre-existing, only surfaced when a second property was actually onboarded for real — not just checked via SQL)
- `property_settings.id` / `ai_market_summary.id` were `smallint DEFAULT 1` with `CHECK (id = 1)` — true-singleton leftovers migration 019 never cleaned up. Every new property's row collided on the PK. Fixed in 024–025.
- `users.role` (20 chars), `bookings.source` (30), `payments.method` (20) were too narrow for the namespaced `<id>-<property_uuid>` values a new property's cloned roles/sources/methods get (~42–50 chars). Widened all three to 50 in 026 — without this, creating a user/booking/payment for a new property failed outright.
- `seedPropertyDefaults.js`'s clone queries had a type-ambiguous SQL placeholder (used as both `text` and `uuid`) and no `property_id IS NULL` template rows existed for it to clone from — both fixed.
- Superadmin seed's bcrypt hash didn't actually match `superadmin123` — regenerated.

### Known gaps / not yet done (next steps)
- **No frontend yet** for any of this — `routes/admin.js` is API-only, no superadmin UI; the client doesn't yet call `GET /api/settings/modules` to hide/show nav items.
- **Login doesn't resolve property by subdomain/tenant first** — `POST /api/auth/login` looks up a user by email alone (now globally unique per migration 023, so this is safe, just not subdomain-aware yet). Fine for now; worth revisiting once there are real multiple properties with real staff overlap.
- `booking_sources`/`payment_methods`/`roles` still use raw string IDs as their identity (namespaced per property) rather than a surrogate key — works, but is a slightly unusual shape if it ever needs a proper FK from another table.

Full detail on all of the above is also saved in Claude's persistent memory for this project.

---

Run `019_multi_tenancy.sql` first, then make these backend changes.

---

## 1. JWT — add property_id to the token

**`server/routes/auth.js`** — when signing the token, include `property_id`:

```js
// Before
const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, ...);

// After
const token = jwt.sign(
  { userId: user.id, role: user.role, propertyId: user.property_id },
  JWT_SECRET, ...
);
```

---

## 2. Auth middleware — expose req.propertyId

**`server/middleware/auth.js`** — after verifying the token:

```js
req.userId     = decoded.userId;
req.userRole   = decoded.role;
req.propertyId = decoded.propertyId;  // ← add this line
```

---

## 3. Every route query — add WHERE property_id = $n

This is the bulk of the work. Every SELECT, INSERT, UPDATE, DELETE in every route file needs to be scoped. Pattern:

```js
// SELECT — always filter
const { rows } = await db.query(
  'SELECT * FROM units WHERE property_id = $1',
  [req.propertyId]
);

// INSERT — always include
await db.query(
  'INSERT INTO units (name, type, property_id) VALUES ($1, $2, $3)',
  [name, type, req.propertyId]
);

// UPDATE — include in WHERE
await db.query(
  'UPDATE units SET name = $1 WHERE id = $2 AND property_id = $3',
  [name, id, req.propertyId]
);

// DELETE — include in WHERE
await db.query(
  'DELETE FROM units WHERE id = $1 AND property_id = $2',
  [id, req.propertyId]
);
```

### Route files to update (all of them):
- `routes/units.js`
- `routes/bookings.js`
- `routes/guests.js`
- `routes/payments.js`
- `routes/checkin.js`
- `routes/tasks.js`
- `routes/sales.js`
- `routes/loyalty.js`
- `routes/products.js`
- `routes/pricing.js`
- `routes/allotments.js`
- `routes/dashboard.js`
- `routes/reports.js`
- `routes/settings.js`
- `routes/users.js`
- `routes/insights.js`
- `routes/nightAudit.js`
- `routes/board.js`
- `routes/calls.js`
- `routes/iot.js`

---

## 4. Singleton tables — property_settings & ai_market_summary

These were `WHERE id = 1`. Change to `WHERE property_id = $1`:

```js
// Before
await db.query('SELECT * FROM property_settings WHERE id = 1');

// After
await db.query('SELECT * FROM property_settings WHERE property_id = $1', [req.propertyId]);
```

For INSERT/upsert when a new property is onboarded:
```js
await db.query(
  `INSERT INTO property_settings (property_id) VALUES ($1) ON CONFLICT (property_id) DO NOTHING`,
  [propertyId]
);
```

---

## 5. Market Insights jobs — scope to property

**`server/jobs/marketInsights.js`** — currently runs globally. Needs to loop over active properties and run per-property:

```js
const { rows: properties } = await db.query(
  'SELECT id FROM properties WHERE is_active = true'
);
for (const prop of properties) {
  await refreshCompetitors(prop.id);
  await refreshTrends(prop.id);
}
```

---

## 6. Display route — no JWT, use property_id via unit lookup

**`routes/display.js`** — called by Room Display / TV Display without staff JWT.
It looks up state by `roomId` (ESP32 controller_id). This already chains through `units`, so it's fine — just ensure the unit lookup uses the controller_id join correctly. No change needed here beyond verifying the query still works.

---

## 7. New property onboarding — seed defaults

When a new property is created, seed their default rows:

```js
async function seedPropertyDefaults(propertyId) {
  // booking_sources
  await db.query(`
    INSERT INTO booking_sources (id, label, is_ota, color, sort_order, property_id)
    SELECT id || '_' || $1, label, is_ota, color, sort_order, $1
    FROM booking_sources WHERE property_id IS NULL
    ON CONFLICT DO NOTHING
  `, [propertyId]);

  // payment_methods
  await db.query(`
    INSERT INTO payment_methods (id, label, sort_order, property_id)
    SELECT id || '_' || $1, label, sort_order, $1
    FROM payment_methods WHERE property_id IS NULL
    ON CONFLICT DO NOTHING
  `, [propertyId]);

  // roles
  await db.query(`
    INSERT INTO roles (id, label, allowed_menus, property_id)
    SELECT id || '_' || $1, label, allowed_menus, $1
    FROM roles WHERE property_id IS NULL
    ON CONFLICT DO NOTHING
  `, [propertyId]);

  // property_settings singleton row
  await db.query(`
    INSERT INTO property_settings (property_id) VALUES ($1)
    ON CONFLICT (property_id) DO NOTHING
  `, [propertyId]);

  // ai_market_summary singleton row
  await db.query(`
    INSERT INTO ai_market_summary (property_id) VALUES ($1)
    ON CONFLICT (property_id) DO NOTHING
  `, [propertyId]);
}
```

---

## 8. Environment variable

Add to `server/.env`:
```
ZAHILL_PROPERTY_ID=00000000-0000-0000-0000-000000000001
```

Useful for scripts and jobs that need to reference Zahill without a JWT context.

---

## Order of work for Claude Code

1. Run `019_multi_tenancy.sql` via `npm run migrate`
2. Update `auth.js` token signing (Step 1)
3. Update `middleware/auth.js` (Step 2)
4. Update route files one by one — start with `units.js` and `bookings.js` as the most critical
5. Update singleton table queries (Step 4)
6. Update `jobs/marketInsights.js` (Step 5)
7. Test: login as Zahill owner, verify all pages still load with correct data
