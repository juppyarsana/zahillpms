CREATE TYPE board_category AS ENUM ('activity', 'dining', 'property', 'notice');

CREATE TABLE guest_board_cards (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(120)    NOT NULL,
  body         TEXT            NOT NULL,
  category     board_category  NOT NULL,
  meta         VARCHAR(120),
  image_url    VARCHAR(255),
  active       BOOLEAN         NOT NULL DEFAULT true,
  sort_order   INTEGER         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_board_cards_category ON guest_board_cards (category);
CREATE INDEX idx_board_cards_active   ON guest_board_cards (active);
