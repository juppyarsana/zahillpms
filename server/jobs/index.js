const cron = require('node-cron');
const { runNightAuditAllProperties } = require('./nightAudit');
const {
  refreshCompetitorsAllProperties,
  refreshSearchTrendsAllProperties,
  refreshAiSummaryAllProperties,
  refreshHolidays,
} = require('./marketInsights');
const { runYieldAllProperties } = require('./yieldPricing');
const { sendPreArrivalEmails, sendPostCheckoutEmails } = require('./communications');
const smartReports = require('../services/smartReports');

function registerJobs() {
  // Night audit — 03:00 every night, audits the day that just ended. Not
  // right after midnight: guests on a late flight often arrive 00:30–02:30,
  // and the audit marks everyone not checked in by then as a no-show. A guest
  // arriving later still is put back from Check-in / out → "Arrived late".
  cron.schedule('0 3 * * *', async () => {
    try {
      await runNightAuditAllProperties('auto');
    } catch (err) {
      console.error('[Jobs] Night audit cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Night audit scheduled at 03:00 WITA (Bali)');

  // Channel manager (migration 122): a Telegram alert once sending / reading
  // has failed for 15 minutes.
  cron.schedule('*/5 * * * *', async () => {
    try { await require('../services/channelHealth').checkAlerts(); }
    catch (err) { console.error('[Jobs] Channel health check failed:', err.message); }
  }, { timezone: 'Asia/Makassar' });

  // Channel manager (migration 120): send every linked property's free rooms
  // and prices again in full — after the night audit and the yield run, and
  // it adds the new last night of the 365-night window.
  cron.schedule('10 4 * * *', async () => {
    try {
      await require('../services/channelSync').syncAllFull();
    } catch (err) {
      console.error('[Jobs] Channel full resend failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Competitor ratings — daily at 06:00 WITA
  cron.schedule('0 6 * * *', async () => {
    try {
      await refreshCompetitorsAllProperties();
    } catch (err) {
      console.error('[Jobs] Competitor ratings cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Search trends — weekly, Monday 06:30 WITA
  cron.schedule('30 6 * * 1', async () => {
    try {
      await refreshSearchTrendsAllProperties();
    } catch (err) {
      console.error('[Jobs] Search trends cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // AI market summary — weekly, Monday 07:00 WITA (after ratings + trends refresh)
  cron.schedule('0 7 * * 1', async () => {
    try {
      await refreshAiSummaryAllProperties();
    } catch (err) {
      console.error('[Jobs] AI summary cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Market insights scheduled — competitor ratings daily 06:00, search trends weekly Mon 06:30, AI summary weekly Mon 07:00 (WITA)');

  // Pre-arrival email — daily at 10:00 WITA (bookings checking in tomorrow)
  cron.schedule('0 10 * * *', async () => {
    try {
      await sendPreArrivalEmails();
    } catch (err) {
      console.error('[Jobs] Pre-arrival email cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Post-checkout email — daily at 11:00 WITA (bookings that checked out yesterday)
  cron.schedule('0 11 * * *', async () => {
    try {
      await sendPostCheckoutEmails();
    } catch (err) {
      console.error('[Jobs] Post-checkout email cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Holiday sync — daily at 01:30 WITA, before yield pricing runs at 03:15 so that
  // night's auto rates see any newly-added/changed holiday.
  cron.schedule('30 1 * * *', async () => {
    try {
      await refreshHolidays();
    } catch (err) {
      console.error('[Jobs] Holiday sync cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Holiday sync scheduled daily 01:30 WITA (api.co.id)');

  // Yield pricing — daily at 03:15 WITA (after the 03:00 night audit has closed the day, so occupancy is current)
  cron.schedule('15 3 * * *', async () => {
    try {
      await runYieldAllProperties();
    } catch (err) {
      console.error('[Jobs] Yield pricing cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Yield pricing scheduled daily 03:15 WITA');

  // Smart Reports — Morning Brief daily at 07:00 WITA (only properties with
  // the smart_reports module on, only recipients subscribed to it).
  cron.schedule('0 7 * * *', async () => {
    try {
      await smartReports.runReportAllProperties('morning_brief');
    } catch (err) {
      console.error('[Jobs] Morning Brief cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Daily Close — 03:30 WITA, after the 03:00 night audit has closed the day.
  cron.schedule('30 3 * * *', async () => {
    try {
      await smartReports.runReportAllProperties('daily_close');
    } catch (err) {
      console.error('[Jobs] Daily Close cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Tomorrow Preview — 19:00 WITA, for the next day.
  cron.schedule('0 19 * * *', async () => {
    try {
      await smartReports.runReportAllProperties('tomorrow_preview');
    } catch (err) {
      console.error('[Jobs] Tomorrow Preview cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Weekly Owner Report — Monday 08:00 WITA, for last week (Mon–Sun).
  cron.schedule('0 8 * * 1', async () => {
    try {
      await smartReports.runReportAllProperties('weekly_owner');
    } catch (err) {
      console.error('[Jobs] Weekly Owner Report cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Monthly Report — the 1st at 08:00 WITA, for last month.
  cron.schedule('0 8 1 * *', async () => {
    try {
      await smartReports.runReportAllProperties('monthly_report');
    } catch (err) {
      console.error('[Jobs] Monthly Report cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Smart Reports scheduled — Daily Close 03:30, Morning Brief 07:00, Tomorrow Preview 19:00, Weekly Mon 08:00, Monthly 1st 08:00 WITA');

  // Room tablets that stopped reporting — every 5 minutes (services/tabletAlerts.js).
  cron.schedule('*/5 * * * *', async () => {
    try {
      await require('../services/tabletAlerts').checkOffline();
    } catch (err) {
      console.error('[Jobs] Tablet offline check failed:', err.message);
    }
  });

  // Room tablet connection history (services/tabletLink.js): each room's first /
  // last request of the day every 5 minutes; anything older than 30 days at 03:20.
  cron.schedule('*/5 * * * *', () => {
    require('../services/tabletLink').flushDays().catch(err => console.error('[Jobs] Tablet day flush failed:', err.message));
  });
  cron.schedule('20 3 * * *', async () => {
    try {
      const n = await require('../services/tabletLink').prune();
      if (n) console.log(`[Jobs] Tablet history: ${n} old rows removed`);
    } catch (err) {
      console.error('[Jobs] Tablet history prune failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Forecast snapshot — 03:50 WITA, after the night audit (no-shows marked)
  // and the Daily Close: what is on the books for the next 120 nights, kept
  // for pickup (services/forecastSnapshot.js). One read + one insert per
  // property. A server that was down then catches up a minute after it starts.
  cron.schedule('50 3 * * *', async () => {
    try {
      await require('../services/forecastSnapshot').snapshotAllProperties();
    } catch (err) {
      console.error('[Jobs] Forecast snapshot cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });
  setTimeout(() => {
    require('../services/forecastSnapshot').snapshotAllProperties({ onlyMissing: true })
      .then(n => { if (n) console.log(`[Jobs] Forecast snapshot caught up for ${n} propert${n === 1 ? 'y' : 'ies'}`); })
      .catch(err => console.error('[Jobs] Forecast snapshot catch-up failed:', err.message));
  }, 60 * 1000).unref();

  // Telegram Connect links still waiting for a Start press survive a restart.
  require('../services/telegramLink').ensurePolling();

  console.log('[Jobs] Guest communication scheduled — pre-arrival daily 10:00, post-checkout daily 11:00 (WITA)');
}

module.exports = { registerJobs };
