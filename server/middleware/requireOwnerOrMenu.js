// Owner always passes (same rule as the client's AuthContext.can()); anyone
// else needs the given menu key in their JWT's allowed_menus (see
// routes/auth.js — set at login, not re-fetched per request, so a role
// change needs re-login to take effect, same as the client-side check).
//
// Introduced for the resto ordering feature: products/tables mutation used
// to be strictly requireRole('owner') (still true for every other caller of
// these routes, e.g. the PMS Sales page) — this additively opens the same
// routes to a non-owner role that's been granted resto_menu/resto_tables,
// so a resto manager can maintain the menu/tables from resto-display without
// needing the property's actual owner login.
function requireOwnerOrMenu(menuKey) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'owner') return next();
    if (Array.isArray(req.user.allowed_menus) && req.user.allowed_menus.includes(menuKey)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = requireOwnerOrMenu;
