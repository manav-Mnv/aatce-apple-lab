/**
 * Config.gs — Constants and placeholder Sheet IDs
 * Replace SHEET_IDS with your real Google Sheet IDs before deploying.
 */
const CONFIG = {
  // --- Placeholder Sheet IDs (swap in real ones) ---
  SHEET_IDS: {
    ENROLLED: 'SHEET_ID_ENROLLED',   // Master enrollment sheet
    SCANS: 'SHEET_ID_SCANS',         // Scan log sheet
  },

  // --- Sheet tab names ---
  TABS: {
    ENROLLED: 'Enrolled',
    SCANS: 'Scans',
  },

  // --- Shared secret key stored in Script Properties ---
  SECRET_KEY: 'API_SHARED_SECRET',

  // --- Rate-limit / dedup settings ---
  SCAN_COOLDOWN_MS: 30000, // 30s — ignore duplicate scan within this window
};
