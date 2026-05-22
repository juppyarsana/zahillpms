const cron = require('node-cron');
const { runNightAudit } = require('./nightAudit');

function registerJobs() {
  // Night audit — runs at 00:05 every night (after midnight, audits the just-completed day)
  cron.schedule('5 0 * * *', async () => {
    try {
      await runNightAudit('auto');
    } catch (err) {
      console.error('[Jobs] Night audit cron failed:', err.message);
    }
  }, { timezone: 'Asia/Makassar' });

  console.log('[Jobs] Night audit scheduled at 00:05 WITA (Bali)');
}

module.exports = { registerJobs };
