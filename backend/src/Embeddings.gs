/**
 * Embeddings.gs — Embeddings sync endpoint (SRS §6, Phase 4 contract).
 *
 * Serves the current embeddings for kiosk apps to sync periodically.
 * The embeddings are stored as a JSON string in the Embeddings sheet tab,
 * or optionally as a Drive file. This endpoint is the single source
 * the kiosk reads from.
 *
 * Schema (must match ml-training output exactly):
 * {
 *   "version": "<incrementing integer>",
 *   "generated_at": "<ISO 8601 timestamp>",
 *   "model_version": "<model identifier string>",
 *   "entries": [
 *     {
 *       "enrollment_no": "...",
 *       "embedding_vector": [0.123, -0.456, ...]
 *     }
 *   ]
 * }
 */

/**
 * Handles a request to get the current embeddings.
 * @returns {Object} The embeddings JSON object.
 */
function handleGetEmbeddings() {
  var config = getConfig();

  try {
    var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.EMBEDDINGS_TAB);
    var data = getAllData(sheet);

    // The Embeddings tab stores the full JSON in cell A1 (row 1 after header,
    // or row 1 if no header). If the tab has a header row "embeddings_json",
    // the data is in A2.
    var jsonString = '';

    if (data.length >= 2) {
      // Has header row — data is in row 2, col A
      jsonString = data[1][0];
    } else if (data.length === 1) {
      // Single row — could be header or data
      jsonString = data[0][0];
    }

    if (!jsonString) {
      // No embeddings yet — return empty but valid structure
      return {
        success: true,
        embeddings: {
          version: 0,
          generated_at: '',
          model_version: '',
          entries: []
        }
      };
    }

    var embeddings = JSON.parse(jsonString);

    return {
      success: true,
      embeddings: embeddings
    };

  } catch (err) {
    return {
      success: false,
      error: 'Failed to read embeddings: ' + err.message
    };
  }
}

/**
 * Updates the embeddings store (called by the ML pipeline after retraining).
 * @param {Object} payload - The full embeddings object matching the schema.
 * @returns {Object} Response object.
 */
function handleUpdateEmbeddings(payload) {
  if (!payload.embeddings) {
    return {
      success: false,
      error: 'embeddings object is required'
    };
  }

  var embeddings = payload.embeddings;

  // Validate schema
  if (typeof embeddings.version === 'undefined' ||
      typeof embeddings.generated_at === 'undefined' ||
      typeof embeddings.model_version === 'undefined' ||
      !Array.isArray(embeddings.entries)) {
    return {
      success: false,
      error: 'Invalid embeddings schema. Required: version, generated_at, model_version, entries[]'
    };
  }

  var config = getConfig();

  try {
    var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.EMBEDDINGS_TAB);
    var jsonString = JSON.stringify(embeddings);

    // Clear and write: header in A1, JSON in A2
    sheet.clear();
    sheet.getRange(1, 1).setValue('embeddings_json');
    sheet.getRange(2, 1).setValue(jsonString);
    SpreadsheetApp.flush();

    return {
      success: true,
      message: 'Embeddings updated',
      version: embeddings.version,
      entry_count: embeddings.entries.length
    };

  } catch (err) {
    return {
      success: false,
      error: 'Failed to update embeddings: ' + err.message
    };
  }
}
