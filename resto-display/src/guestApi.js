import axios from 'axios';

// Guest QR surface. Deliberately NO auth interceptor and NO localStorage use
// at all — the qr_token travels only in the URL path (see App.jsx's
// /t/:qrToken route), so a guest's phone never retains table access after
// they leave. session_id (once ordering) lives in sessionStorage instead,
// scoped to that one browser tab — see GuestOrderScreen.jsx.
export default axios.create({ baseURL: '/api/resto/guest' });
