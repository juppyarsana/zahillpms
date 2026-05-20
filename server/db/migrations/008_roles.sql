CREATE TABLE IF NOT EXISTS roles (
  id            VARCHAR(50)  PRIMARY KEY,
  label         VARCHAR(100) NOT NULL,
  allowed_menus TEXT[]       NOT NULL DEFAULT '{}'
);

INSERT INTO roles (id, label, allowed_menus) VALUES
  ('owner', 'Owner', ARRAY[
    'dashboard','reservations','quick_checkin','checkin_full','guests',
    'operations','sales','loyalty','allotments','pricing',
    'units','users','settings','room_controllers'
  ]),
  ('staff', 'Staff', ARRAY[
    'dashboard','reservations','quick_checkin','checkin_full',
    'guests','operations','loyalty','allotments'
  ])
ON CONFLICT (id) DO NOTHING;
