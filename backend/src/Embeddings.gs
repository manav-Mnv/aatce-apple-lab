/**
 * Embeddings.gs — Face dataset and embeddings exchange (FR-4, Phase 4).
 *
 * Nothing biometric is ever shared by public link. Drive files stay private to
 * the script owner and only move through authenticated actions:
 *
 *   kiosk     embeddings_version   → current version metadata
 *   kiosk     embeddings_download  → the current embeddings.json (≈5 KB per person)
 *   pipeline  face_manifest        → every face photo in Face-Dataset/<enrollment_no>/
 *   pipeline  face_images          → up to MAX_FACE_IMAGES_PER_CALL photos as base64
 *   pipeline  publish_embeddings   → store a new embeddings.json and bump the version
 *
 * The Embeddings tab holds one data row:
 *   version | generated_at | model_version | drive_file_id | entry_count
 */

function handleEmbeddingsVersion_() {
  var meta = embeddingsMeta_();
  return {
    success: true,
    version: meta ? Number(meta.version) || 0 : 0,
    generated_at: meta ? String(meta.generated_at || '') : '',
    model_version: meta ? String(meta.model_version || '') : '',
    entry_count: meta ? Number(meta.entry_count) || 0 : 0
  };
}

function handleEmbeddingsDownload_() {
  var meta = embeddingsMeta_();
  if (!meta || !meta.drive_file_id) {
    return errorResult_('No embeddings have been published yet', 'not_found');
  }
  var content = DriveApp.getFileById(String(meta.drive_file_id)).getBlob().getDataAsString();
  return { success: true, embeddings: JSON.parse(content) };
}

function handlePublishEmbeddings_(body) {
  var embeddings = body.embeddings;
  var problem = embeddingsProblem_(embeddings);
  if (problem) return errorResult_(problem, 'validation_error');

  var table = aatceTable_(TABS.EMBEDDINGS);
  var meta = table.records[0];
  var current = meta ? Number(meta.version) || 0 : 0;
  if (embeddings.version <= current) {
    return errorResult_('version must be greater than the current version ' + current, 'version_conflict');
  }

  var folder = DriveApp.getFolderById(requireProp_('EMBEDDINGS_FOLDER_ID'));
  var file = folder.createFile('embeddings-v' + embeddings.version + '.json',
    JSON.stringify(embeddings), 'application/json');

  var fields = {
    version: embeddings.version,
    generated_at: embeddings.generated_at,
    model_version: embeddings.model_version,
    drive_file_id: file.getId(),
    entry_count: embeddings.entries.length
  };
  if (meta) updateRecord_(table, meta, fields); else appendRecord_(table, fields);

  return { success: true, version: embeddings.version, entry_count: fields.entry_count };
}

function handleFaceManifest_() {
  var people = [];
  var folders = faceRoot_().getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    var enrollmentNo = cleanEnrollmentNo_(folder.getName());
    if (!enrollmentNo) continue;

    var files = [];
    var it = folder.getFilesByType(MimeType.JPEG);
    while (it.hasNext()) {
      var f = it.next();
      files.push({ id: f.getId(), name: f.getName(), size: f.getSize() });
    }
    if (files.length) people.push({ enrollment_no: enrollmentNo, files: files });
  }
  return { success: true, people: people };
}

function handleFaceImages_(body) {
  var ids = body.file_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FACE_IMAGES_PER_CALL) {
    return errorResult_('file_ids must be an array of 1–' + MAX_FACE_IMAGES_PER_CALL + ' Drive file IDs', 'validation_error');
  }

  var images = [];
  for (var i = 0; i < ids.length; i++) {
    var file = null;
    try {
      file = DriveApp.getFileById(String(ids[i]));
    } catch (err) {
      // reported as not_found below
    }
    if (!file || !isInFaceDataset_(file)) return errorResult_('File not found: ' + ids[i], 'not_found');
    images.push({ file_id: String(ids[i]), data: Utilities.base64Encode(file.getBlob().getBytes()) });
  }
  return { success: true, images: images };
}

/** Only Face-Dataset/<enrollment_no>/<photo> files may be read through face_images. */
function isInFaceDataset_(file) {
  var rootId = requireProp_('FACE_DATASET_FOLDER_ID');
  var parents = file.getParents();
  while (parents.hasNext()) {
    var grandparents = parents.next().getParents();
    while (grandparents.hasNext()) {
      if (grandparents.next().getId() === rootId) return true;
    }
  }
  return false;
}

function faceRoot_() {
  return DriveApp.getFolderById(requireProp_('FACE_DATASET_FOLDER_ID'));
}

function embeddingsMeta_() {
  return aatceTable_(TABS.EMBEDDINGS).records[0] || null;
}

/** @returns {string} a description of the first schema problem, or '' if valid. */
function embeddingsProblem_(e) {
  if (!e || typeof e !== 'object') return 'embeddings must be an object';
  if (!(Number.isInteger(e.version) && e.version > 0)) return 'version must be a positive integer';
  if (typeof e.generated_at !== 'string' || !e.generated_at) return 'generated_at must be an ISO 8601 string';
  if (typeof e.model_version !== 'string' || !e.model_version) return 'model_version must be a non-empty string';
  if (!Array.isArray(e.entries)) return 'entries must be an array';

  var seen = {};
  for (var i = 0; i < e.entries.length; i++) {
    var entry = e.entries[i];
    var id = entry && cleanEnrollmentNo_(entry.enrollment_no);
    if (!id) return 'entries[' + i + '].enrollment_no is invalid';
    if (seen[id]) return 'entries[' + i + '] duplicates enrollment_no ' + id;
    seen[id] = true;
    var v = entry.embedding_vector;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
      return 'entries[' + i + '].embedding_vector must have ' + EMBEDDING_DIM + ' numbers';
    }
    for (var j = 0; j < v.length; j++) {
      if (typeof v[j] !== 'number' || !isFinite(v[j])) return 'entries[' + i + '].embedding_vector has a non-numeric value';
    }
  }
  return '';
}
