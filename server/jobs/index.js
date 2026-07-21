const cron = require('node-cron');
const { runNightAuditAllProperties } = require('./nightAudit');
const {
  refreshCompetitorsAllProperties,
  refreshSearchTrendsAllProperties,
  refreshAiSummaryAllProperties,
} = require('./marketInsights');
const { sendPreArrivalEmails, sendPostCheckoutEmails } = require('./communications');

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

  console.log('[Jobs] Guest communication scheduled — pre-arrival daily 10:00, post-checkout daily 11:00 (WITA)');
}

module.exports = { registerJobs };
