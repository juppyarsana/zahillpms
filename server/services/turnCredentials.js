const crypto = require('crypto');

// Short-lived TURN REST API credentials (coturn's `use-auth-secret` scheme):
// username = "<expiry-unix-ts>:<propertyId>", credential = base64(HMAC-SHA1(secret, username)).
// Embedding propertyId lets coturn's logs attribute relay bandwidth per
// property even though the credential itself carries no authorization
// beyond "valid until expiry" — coturn doesn't understand multi-tenancy,
// this is purely for later usage/abuse attribution.
// Returns null (caller falls back to STUN-only) until TURN is configured.
const TTL_SECONDS = 3600;

function getTurnCredentials(propertyId) {
  const secret = process.env.TURN_SECRET;
  const urls = process.env.TURN_URLS;
  if (!secret || !urls) return null;

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}:${propertyId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return {
    urls: urls.split(',').map(u => u.trim()),
    username,
    credential,
  };
}

module.exports = { getTurnCredentials };
