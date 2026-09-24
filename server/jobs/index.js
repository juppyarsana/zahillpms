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
  // Night audit — runs at 00:05 every night (after midnight, audits the just-completed day)
  cron.schedule('5 0 * * *', async () => {
    try {
      await runNightAuditAllProperties('auto');
    } catch (err) {
      console.error('[Jobs] Night audit cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Night audit scheduled at 00:05 WITA (Bali)');

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

  // Holiday sync — daily at 01:30 WITA, before yield pricing runs at 02:00 so that
  // night's auto rates see any newly-added/changed holiday.
  cron.schedule('30 1 * * *', async () => {
    try {
      await refreshHolidays();
    } catch (err) {
      console.error('[Jobs] Holiday sync cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Holiday sync scheduled daily 01:30 WITA (api.co.id)');

  // Yield pricing — daily at 02:00 WITA (after night audit has closed the day, so occupancy is current)
  cron.schedule('0 2 * * *', async () => {
    try {
      await runYieldAllProperties();
    } catch (err) {
      console.error('[Jobs] Yield pricing cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Yield pricing scheduled daily 02:00 WITA');

  // Smart Reports — Morning Brief daily at 07:00 WITA (only properties with
  // the smart_reports module on, only recipients subscribed to it).
  cron.schedule('0 7 * * *', async () => {
    try {
      await smartReports.runReportAllProperties('morning_brief');
    } catch (err) {
      console.error('[Jobs] Morning Brief cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  // Daily Close — 00:30 WITA, after the 00:05 night audit has closed the day.
  cron.schedule('30 0 * * *', async () => {
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

  console.log('[Jobs] Smart Reports scheduled — Daily Close 00:30, Morning Brief 07:00, Tomorrow Preview 19:00, Weekly Mon 08:00 WITA');

  // Telegram Connect links still waiting for a Start press survive a restart.
  require('../services/telegramLink').ensurePolling();

  console.log('[Jobs] Guest communication scheduled — pre-arrival daily 10:00, post-checkout daily 11:00 (WITA)');
}

module.exports = { registerJobs };
