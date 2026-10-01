/**
 * Embeddings.gs — Embeddings version-check endpoint.
 *
 * ARCHITECTURE (per SRS §6, PRD §8):
 * The full embeddings.json lives in Google Drive as a versioned file,
 * NOT routed through Apps Script. This avoids Apps Script payload/execution
 * limits as the student count grows (NFR-7).
 *
 * Flow:
 *   - ML pipeline (GitHub Actions) generates embeddings.json and uploads
 *     it to a Google Drive folder.
 *   - ML pipeline also updates the Embeddings Sheet tab with just the
 *     version number and Drive file ID (lightweight metadata).
 *   - Kiosk app calls this endpoint to check the current version.
 *     If version > local version, kiosk downloads embeddings.json
 *     directly from Drive using the file ID.
 *
 * This endpoint only serves metadata — never the full embedding vectors.
 *
 * Embeddings Sheet tab layout:
 *   Row 1 (header): version | generated_at | model_version | drive_file_id | entry_count
 *   Row 2 (data):   3       | 2026-10-01.. | facenet-v1    | 1AbC...xyz    | 152
 */

// Column indices for Embeddings tab (1-based)
var EMB_COL_VERSION = 1;
var EMB_COL_GENERATED_AT = 2;
var EMB_COL_MODEL_VERSION = 3;
var EMB_COL_DRIVE_FILE_ID = 4;
var EMB_COL_ENTRY_COUNT = 5;

/**
 * Returns the current embeddings version metadata.
 * The kiosk uses this to decide whether to re-download from Drive.
 *
 * @returns {Object} Response with version metadata.
 */
function handleGetEmbeddingsVersion() {
  var config = getConfig();

  try {
    var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.EMBEDDINGS_TAB);
    var data = getAllData(sheet);

    // No data or only header
    if (data.length < 2) {
      return {
        success: true,
        version: 0,
        generated_at: '',
        model_version: '',
        drive_file_id: '',
        entry_count: 0,
        download_url: ''
      };
    }

    var row = data[1]; // Data row (0 = header, 1 = data)
    var driveFileId = row[EMB_COL_DRIVE_FILE_ID - 1] || '';

    return {
      success: true,
      version: parseInt(row[EMB_COL_VERSION - 1]) || 0,
      generated_at: row[EMB_COL_GENERATED_AT - 1] || '',
      model_version: row[EMB_COL_MODEL_VERSION - 1] || '',
      drive_file_id: driveFileId,
      entry_count: parseInt(row[EMB_COL_ENTRY_COUNT - 1]) || 0,
      download_url: driveFileId
        ? 'https://drive.google.com/uc?export=download&id=' + driveFileId
        : ''
    };

  } catch (err) {
    return {
      success: false,
      error: 'Failed to read embeddings version: ' + err.message,
      error_code: 'server_error'
    };
  }
}

/**
 * Updates the embeddings metadata after the ML pipeline uploads a new
 * embeddings.json to Drive. Called by the pipeline (not the kiosk).
 *
 * @param {Object} payload - Metadata about the new embeddings.
 * @param {number} payload.version - New version number.
 * @param {string} payload.generated_at - ISO 8601 timestamp.
 * @param {string} payload.model_version - Model identifier.
 * @param {string} payload.drive_file_id - Google Drive file ID.
 * @param {number} payload.entry_count - Number of entries in the file.
 * @returns {Object} Response object.
 */
function handleUpdateEmbeddingsMeta(payload) {
  if (!payload.version || !payload.drive_file_id) {
    return {
      success: false,
      error: 'version and drive_file_id are required',
      error_code: 'validation_error'
    };
  }

  var config = getConfig();

  try {
    var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.EMBEDDINGS_TAB);

    // Clear and write: header in row 1, data in row 2
    sheet.clear();
    sheet.appendRow([
      'version', 'generated_at', 'model_version', 'drive_file_id', 'entry_count'
    ]);
    sheet.appendRow([
      parseInt(payload.version),
      payload.generated_at || '',
      payload.model_version || '',
      payload.drive_file_id,
      parseInt(payload.entry_count) || 0
    ]);
    SpreadsheetApp.flush();

    return {
      success: true,
      message: 'Embeddings metadata updated',
      version: parseInt(payload.version)
    };

  } catch (err) {
    return {
      success: false,
      error: 'Failed to update embeddings metadata: ' + err.message,
      error_code: 'server_error'
    };
  }
}
