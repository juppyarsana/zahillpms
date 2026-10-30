# Maintenance & Assets — plan

Written 2026-10-30. First user: **Zahill Kintamani Resort**. Not started.
Next free migration number today: **146** (re-check before building; purchase requests 144–145 are released, not deployed).

## Why

Things break at the resort: AC or heater, water heaters, pumps, the genset, TVs, room tablets. Today a breakdown reaches engineering by word of mouth or WhatsApp. The PMS only knows about it if someone puts the room Out of Order, and then it keeps no history.

The aim is **fewer room-nights lost to surprise breakdowns**, and an owner who can see what each room and each machine costs to keep running. This is not a full CMMS and not fixed-asset accounting (see *Not in v1*).

## What is already there (build on it, don't duplicate)

| Piece | Where | How v1 uses it |
|---|---|---|
| Room Out of Order | `units.status = 'out_of_order'` + `status_reason`, `status_expected_back` (migration 059), `PATCH /api/units/:id/status` in `routes/units.js` | Becomes **dated** (see 1). The PATCH stays as a shortcut |
| OOO in availability / OTAs | `services/availabilityService.js:57`, `services/channelSync.js:102` (skips OOO nights until `expected_back`) | Both read the new dated blocks instead |
| Old kanban | `tasks` table (001), type `maintenance`, `/operations` | Out of Order stops creating a `maintenance` task; open ones move to work orders |
| Housekeeping | `routes/housekeeping.js`, `Housekeeping.jsx`, migration 132 | *Report an issue* per room |
| Room tablet housekeeping entry | PIN entry from Room check / minibar (091) | *Report an issue* behind the same PIN |
| Room tablets | `room_display_devices` (052), alerts (103), WiFi history (115) | The first assets (phase 2: offline / battery feeds the asset) |
| Stock | `raw_materials` + movements, Stock page (136) | Spare parts used on a job come off stock |
| Expenses / Payables | `expenses` (055, category `maintenance`), supplier bills (129), `suppliers` (053) | Outside technician cost = an expense or a supplier bill tied to the job |
| Departments | `costCategories.js`, `engineering` | Costs go to Engineering / Maintenance |
| Telegram alerts | `alert_*` recipient settings | New `alert_maintenance` |
| Accounts | 1510 Fixed assets, 1590 Accumulated depreciation (111) | Not used in v1 |

## Module and permissions

- New module in `server/modules.js`: `maintenance: { label: 'Maintenance & Assets', routes: ['maintenance', 'assets'] }`. Default OFF (`seedPropertyDefaults.js` DEFAULT_OFF), turned on for Zahill.
- Menu: **Operations → Maintenance** (tabs: Jobs · Assets · Schedules · Reports).
- Permissions (owners always have them):
  - `maintenance`: see and work jobs (engineering staff).
  - `assets`: add or edit assets and schedules, print QR labels (chief engineer).
- **Reporting an issue needs only a login** (plain `auth`, like `/housekeeping`), so any housekeeper, front desk or F&B staff member can report one. The room tablet uses the housekeeping PIN.

## 1. Dated Out of Order (build first, on its own)

Today OOO can't be set for the future and keeps no history, and occupancy only counts rooms out of order *today* (ROADMAP "Known limits").

```sql
CREATE TABLE unit_blocks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id        UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  from_date      DATE NOT NULL,
  to_date        DATE,                -- first night back on sale; NULL = until released
  reason         TEXT NOT NULL,
  work_order_id  UUID,                -- FK added in the work-orders migration
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at    TIMESTAMPTZ,         -- released early = to_date set to that day
  released_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at   TIMESTAMPTZ          -- a future block taken back, never happened
);
CREATE INDEX idx_unit_blocks_unit ON unit_blocks(unit_id, from_date);
```

- One helper (`services/unitBlocks.js`): `isBlocked(unit, night)` and `blockedNights(property, from, to)`. Availability, channel sync, the room board, night audit occupancy and Forecast all use it.
- `units.status` stays as the "today" view: set when a block starts or ends (when it is saved, and in the night audit). Old code that reads `units.status` keeps working.
- Saving a block that overlaps a stay that is already booked → warning listing the bookings (move them first). It does not block the save.
- Every change pushes availability for those dates to the channel manager (as today).
- `PATCH /api/units/:id/status` becomes "block from today, until expected back", and stops creating a `tasks` row.
- Migration: one open block per room currently `out_of_order`, from `status_updated_at`'s date.
- New figure: **room-nights out of order** per room and month (Insights → Rooms, owner's monthly pack).

## 2. Asset register + QR labels

```sql
CREATE TABLE assets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  asset_no        INT NOT NULL,                       -- shown AS-0001
  name            VARCHAR(120) NOT NULL,              -- "Water heater — Villa 3"
  category        VARCHAR(20) NOT NULL CHECK (category IN ('ac_heater','water_heater','electrical',
                    'plumbing','pump','generator','tv','room_tablet','it_network','furniture','bedding',
                    'kitchen','laundry','pool','vehicle','other')),
  unit_id         UUID REFERENCES units(id) ON DELETE SET NULL,  -- in a room …
  area            VARCHAR(80),                        -- … or an area: Restaurant, Pump house, Lobby
  brand           VARCHAR(80), model VARCHAR(80), serial_no VARCHAR(80),
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  purchased_on    DATE, purchase_cost NUMERIC(14,2), warranty_until DATE,
  status          VARCHAR(12) NOT NULL DEFAULT 'working' CHECK (status IN ('working','broken','retired')),
  retired_on      DATE, retired_reason TEXT,
  qr_token        VARCHAR(24) NOT NULL,               -- random, printed on the label
  photo_url       TEXT,
  room_display_device_id UUID REFERENCES room_display_devices(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_assets_no ON assets(property_id, asset_no);
CREATE UNIQUE INDEX uq_assets_qr ON assets(qr_token);
```

- **Start small.** The Assets tab opens with *Add the usual items to every room*: tick categories (AC or heater, water heater, TV, tablet, mattress) and one row per room is created, with details filled in later. Areas (pumps, genset, kitchen) are added by hand. Excel import comes later if wanted.
- `status` is set by jobs: an open job → `broken`, all jobs done → `working`.
- **QR labels:** a printable PDF sheet (one asset or a whole room / category), with label size chosen in Settings. The QR opens `/a/<qr_token>`. Not logged in → login, then back. Logged in → the asset page with **Report an issue** first, then its history.
- Asset page: details, photo, warranty badge (expired / ends in < 30 days), open jobs, and the history of all jobs with cost and downtime.

## 3. Jobs (work orders) and reporting an issue

One table holds both "something is wrong" and the work to fix it. A report *is* a job in status `reported`.

```sql
CREATE TABLE work_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  wo_no           INT NOT NULL,                       -- shown WO-0001
  asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
  unit_id         UUID REFERENCES units(id) ON DELETE SET NULL,
  area            VARCHAR(80),
  title           VARCHAR(160) NOT NULL,
  description     TEXT,
  priority        VARCHAR(8) NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  status          VARCHAR(14) NOT NULL DEFAULT 'reported' CHECK (status IN
                    ('reported','assigned','in_progress','waiting_parts','done','cancelled')),
  source          VARCHAR(12) NOT NULL CHECK (source IN
                    ('housekeeping','front_desk','tablet','qr','schedule','guest','other')),
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,  -- guest in the room / damage
  schedule_id     UUID,                               -- FK in the schedules migration
  reported_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name VARCHAR(120),                      -- tablet (PIN) reports
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at          TIMESTAMPTZ,
  started_at      TIMESTAMPTZ, done_at TIMESTAMPTZ, done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution      TEXT,                               -- what was done
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_work_orders_no ON work_orders(property_id, wo_no);
CREATE INDEX idx_work_orders_open ON work_orders(property_id, status) WHERE status NOT IN ('done','cancelled');

CREATE TABLE work_order_photos (id UUID PK, work_order_id UUID → CASCADE, kind ('before','after'), url TEXT, created_at);
CREATE TABLE work_order_log    (id UUID PK, work_order_id UUID → CASCADE, at TIMESTAMPTZ, by UUID, by_name,
                                action VARCHAR(20), note TEXT);   -- status changes, comments, reassigns
ALTER TABLE unit_blocks ADD FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL;
```

**Report an issue** works the same everywhere (one bottom sheet, mobile first):
room or area → asset (optional, the room's assets as chips) → what's wrong (+ quick picks per category: *no hot water*, *not cooling / heating*, *leak*, *no power*, *TV / tablet not working*) → photo → urgency → **Block the room?** (only offered when the room is free tonight, or with a warning if a guest is in).

Entry points:
1. **Housekeeping page:** a button on each room card.
2. **Room tablet:** behind the housekeeping PIN, next to Room check.
3. **QR label:** the asset page.
4. **Front desk:** from the room board, or from a booking (guest complaint → `source='guest'`, `booking_id` set).
5. **Room board Out of Order:** setting OOO from the board asks for (or creates) a job.

**Jobs tab:** a list grouped by status (on a phone: Open / Mine / Done), filters for room, area, category and priority. Job page: assign, start, *Waiting for parts* (with a link to raise a purchase request), add photos and comments, parts and costs (4), *Done* (resolution + after photo).

- **Done** → the room's block is released (asks first if `to_date` is in the future), the asset goes back to `working`, and housekeeping gets a *Room back — check & clean* (room set to dirty, as after a check-out).
- **Telegram `alert_maintenance`:** new urgent / high job, room blocked, job overdue (`due_at` passed), job done that released a room. Every message links to the job. The recipient role for Engineering is added the way housekeeping was (096).
- **Old kanban:** a migration moves open `tasks` with `type='maintenance'` into work orders. The kanban hides the type from then on.

## 4. Parts and costs

```sql
CREATE TABLE work_order_parts (
  id UUID PK, work_order_id UUID → CASCADE,
  raw_material_id UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  qty NUMERIC(12,3) NOT NULL, unit_cost NUMERIC(14,2) NOT NULL,   -- the item's average cost when used
  stock_movement_id UUID, created_by UUID, created_at TIMESTAMPTZ
);
ALTER TABLE expenses ADD COLUMN work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;
-- supplier bills (129): same column
```

- Parts used → taken off stock with the Stock page's *used* adjustment, department Engineering.
- An outside technician or a part bought for this job → *Add cost* on the job opens the existing Expense / supplier-bill form, pre-filled (category `maintenance`, department `engineering`, the supplier, `work_order_id`). The money rules stay where they are.
- **Job cost** = parts + linked expenses / bills. **Asset cost to date** = the sum over its jobs.
- No labour cost in v1 (staff are paid anyway). Time on the job is still shown (`started_at` → `done_at`).

## 5. Preventive schedules

```sql
CREATE TABLE maintenance_schedules (
  id UUID PK, property_id UUID → CASCADE,
  title VARCHAR(160) NOT NULL,                        -- "Descale water heater"
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,   -- one asset …
  category VARCHAR(20),                               -- … or every working asset of a category
  every_n INT NOT NULL, every_unit VARCHAR(6) NOT NULL CHECK (every_unit IN ('day','week','month')),
  from_done BOOLEAN NOT NULL DEFAULT TRUE,            -- next due counts from when it was done (else fixed calendar)
  lead_days INT NOT NULL DEFAULT 3,                   -- job appears this many days early
  checklist JSONB NOT NULL DEFAULT '[]',              -- ["Drain tank", "Check anode", …]
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  needs_room_free BOOLEAN NOT NULL DEFAULT FALSE,     -- only do it on a night the room is empty
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ
);
CREATE TABLE maintenance_schedule_assets (schedule_id, asset_id, next_due DATE, last_done DATE,
                                          PRIMARY KEY (schedule_id, asset_id));
CREATE TABLE work_order_checks (work_order_id → CASCADE, idx INT, label TEXT, done BOOLEAN, note TEXT);
```

- A daily job in `server/jobs/` (after the night audit) creates a `source='schedule'` job for each asset whose `next_due - lead_days <= today` and that has no open job from the same schedule. The checklist is copied to `work_order_checks`.
- `needs_room_free`: the job page shows the room's next empty nights. It does not block the room by itself.
- When a schedule job is done, `last_done` is set and `next_due` moves on.
- **Schedules tab:** list + a month calendar of what's due. Starter templates for Zahill: water heater (3 months), AC or heater filter (1 month), AC service (6 months), pumps (1 month), genset test run (1 week) + service (by hours, kept as a date in v1), pool (1 week), fire extinguishers (1 year). Zahill's engineering lead sets the real intervals.

## 6. Reports

Maintenance → Reports, also in the Reports library and the owner's monthly pack:

- **Open jobs:** age, overdue, by priority / area.
- **Room-nights out of order** per room and month, and their value at the average rate for those nights.
- **Asset cost:** repairs per asset over 12 months, assets past warranty, *repair costs ≥ X% of purchase cost* (replace?).
- **Response time:** reported → started, started → done, per category.
- **Preventive done on time** %.

Excel + PDF like the other reports. The `maintenance` permission covers them.

## Build order (sessions)

1. **Dated Out of Order** (`unit_blocks`, helper, availability + channel sync + night audit + Forecast + room board, the PATCH shortcut, migration of current OOO). It touches selling rooms, so it ships and gets tested on its own. Test: block next week's dates on a copy of production and check that the OTA closes those nights only.
2. **Assets + QR labels** (register, *add the usual items to every room*, asset page, label PDF, `/a/:token`).
3. **Jobs + Report an issue** (Housekeeping, tablet PIN, QR, front desk, room board), Telegram, release on done → housekeeping, old kanban moved over.
4. **Parts and costs** (stock *used*, expense / bill link, job and asset cost).
5. **Preventive schedules** + daily job + Zahill templates.
6. **Reports**, owner's monthly pack, **guide chapters** (`maintenance.en.md` / `maintenance.id.md`; update `housekeeping` and `stock`).

Each session: migration, routes, screens, CLAUDE.md write-up, ROADMAP entry, as with the other modules.

## Not in v1

- Depreciation and fixed-asset journal entries (accounts 1510 / 1590 are ready when wanted).
- Charging guest damage to the folio. Small follow-up: from a job with `booking_id`, *Charge the guest* = a Sales sale to the room, like Room check.
- Room tablet telemetry raising jobs on its own (offline / battery). Phase 2, after the asset link exists.
- Meter readings (genset hours, water / electricity meters), contracts, multiple warehouses, Excel import of assets.
- Linen and amenity par levels. That's stock, not assets: the planned *room supplies per occupied room-night* on the Stock page.

## To ask Zahill before building

1. How are breakdowns reported and logged today (WhatsApp group, book, the kanban)? Who fixes them, and are there in-house technicians or outside vendors?
2. Who should get the Telegram alerts? Should engineering staff have PMS logins, or only the chief?
3. Which machines matter most: hot water, heating, pumps, genset? Their current service intervals?
4. Is there an existing asset list (purchase records, a spreadsheet) to start from?
5. Label size and printer for the QR stickers (they need to survive damp bathrooms).
