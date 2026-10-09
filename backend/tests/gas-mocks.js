/**
 * In-memory stand-ins for the Apps Script services the backend uses, and a
 * loader that runs the real src/*.gs files in a Node VM against them.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const IST_OFFSET_MS = 330 * 60 * 1000;

function createEnvironment() {
  const env = {
    clock: Date.parse('2026-10-05T10:00:00+05:30'),
    props: {},
    spreadsheets: {},
    driveItems: {},
    sentMail: [],
    triggers: [],
    activeUser: 'owner@example.com'
  };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length) super(...args); else super(env.clock);
    }
    static now() { return env.clock; }
  }

  // ── Spreadsheets ──────────────────────────────────────────────────────────
  function makeSheet(rows) {
    const sheet = {
      rows,
      getDataRange: () => ({ getValues: () => (rows.length ? rows.map(r => [...r]) : [['']]) }),
      appendRow: (row) => { rows.push([...row]); },
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
      setFrozenRows: () => {},
      getRange: (row, col, numRows = 1, numCols = 1) => {
        const range = {
          setValue: (v) => {
            while (rows.length < row) rows.push([]);
            while (rows[row - 1].length < col) rows[row - 1].push('');
            rows[row - 1][col - 1] = v;
            return range;
          },
          setValues: (values) => {
            values.forEach((vals, i) => vals.forEach((v, j) => {
              while (rows.length < row + i) rows.push([]);
              rows[row + i - 1][col + j - 1] = v;
            }));
            return range;
          },
          getValues: () => Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => (rows[row + i - 1] || [])[col + j - 1] ?? '')),
          setFontWeight: () => range
        };
        return range;
      }
    };
    return sheet;
  }

  function spreadsheet(id) {
    if (!env.spreadsheets[id]) throw new Error('Spreadsheet not found: ' + id);
    const tabs = env.spreadsheets[id];
    return {
      getSheetByName: (name) => (tabs[name] ? makeSheet(tabs[name]) : null),
      insertSheet: (name) => { tabs[name] = []; return makeSheet(tabs[name]); }
    };
  }

  // ── Drive ─────────────────────────────────────────────────────────────────
  function iterator(items) {
    let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++] };
  }

  function driveItem(id) {
    const item = env.driveItems[id];
    if (!item) throw new Error('No item with the given ID could be found');
    return item.kind === 'folder' ? folderApi(item) : fileApi(item);
  }

  function children(folderId, kind) {
    return Object.values(env.driveItems).filter(i => i.parent === folderId && i.kind === kind);
  }

  function addFile(parent, name, bytes, mimeType) {
    const id = 'file-' + crypto.randomUUID();
    env.driveItems[id] = { id, kind: 'file', parent, name, bytes: Buffer.from(bytes), mimeType };
    return fileApi(env.driveItems[id]);
  }

  function folderApi(item) {
    return {
      getId: () => item.id,
      getName: () => item.name,
      getParents: () => iterator(item.parent ? [driveItem(item.parent)] : []),
      getFolders: () => iterator(children(item.id, 'folder').map(folderApi)),
      getFoldersByName: (name) => iterator(children(item.id, 'folder').filter(f => f.name === name).map(folderApi)),
      getFilesByType: (mime) => iterator(children(item.id, 'file').filter(f => f.mimeType === mime).map(fileApi)),
      createFolder: (name) => {
        const id = 'folder-' + crypto.randomUUID();
        env.driveItems[id] = { id, kind: 'folder', parent: item.id, name };
        return folderApi(env.driveItems[id]);
      },
      createFile: (blobOrName, content, mimeType) => (typeof blobOrName === 'string'
        ? addFile(item.id, blobOrName, Buffer.from(content, 'utf8'), mimeType)
        : addFile(item.id, blobOrName.name, blobOrName.bytes, blobOrName.type))
    };
  }

  function fileApi(item) {
    return {
      getId: () => item.id,
      getName: () => item.name,
      getSize: () => item.bytes.length,
      getParents: () => iterator(item.parent ? [driveItem(item.parent)] : []),
      getBlob: () => ({
        getDataAsString: () => item.bytes.toString('utf8'),
        getBytes: () => Array.from(new Int8Array(item.bytes.buffer, item.bytes.byteOffset, item.bytes.length))
      })
    };
  }

  env.addFolder = (id, name, parent = null) => {
    env.driveItems[id] = { id, kind: 'folder', parent, name };
  };
  env.filesIn = (folderId) => children(folderId, 'file');
  env.foldersIn = (folderId) => children(folderId, 'folder');

  // ── Utilities ─────────────────────────────────────────────────────────────
  function formatDate(date, tz, pattern) {
    const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const Y = d.getUTCFullYear(), M = p(d.getUTCMonth() + 1), D = p(d.getUTCDate());
    const h = p(d.getUTCHours()), m = p(d.getUTCMinutes()), s = p(d.getUTCSeconds());
    switch (pattern) {
      case "yyyy-MM-dd'T'HH:mm:ssXXX": return `${Y}-${M}-${D}T${h}:${m}:${s}+05:30`;
      case 'yyyy-MM-dd': return `${Y}-${M}-${D}`;
      case 'yyyyMMdd-HHmmss': return `${Y}${M}${D}-${h}${m}${s}`;
      case 'EEEE, d MMMM':
        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      default: throw new Error('Unsupported pattern in mock: ' + pattern);
    }
  }

  const sandbox = {
    Date: FakeDate,
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => env.props[k] ?? null }) },
    SpreadsheetApp: { openById: spreadsheet, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: {
      getScriptTimeZone: () => 'Asia/Kolkata',
      getActiveUser: () => ({ getEmail: () => env.activeUser }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      base64Decode: (s) => {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Could not decode string.');
        const b = Buffer.from(s, 'base64');
        return Array.from(new Int8Array(b.buffer, b.byteOffset, b.length));
      },
      base64Encode: (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes: Buffer.from(Uint8Array.from(bytes)), type, name })
    },
    DriveApp: { getFolderById: driveItem, getFileById: driveItem },
    MimeType: { JPEG: 'image/jpeg' },
    MailApp: { sendEmail: (msg) => { env.sentMail.push(msg); } },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => env.triggers.map(name => ({ getHandlerFunction: () => name })),
      deleteTrigger: (t) => { env.triggers.splice(env.triggers.indexOf(t.getHandlerFunction()), 1); },
      newTrigger: (name) => {
        const builder = { timeBased: () => builder, everyDays: () => builder, atHour: () => builder,
          create: () => { env.triggers.push(name); } };
        return builder;
      }
    },
    HtmlService: {
      createTemplateFromFile: (file) => {
        const template = { file };
        template.evaluate = () => {
          const out = { template, setTitle: () => out, addMetaTag: () => out };
          return out;
        };
        return template;
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; } })
    }
  };

  const context = vm.createContext(sandbox);
  const srcDir = path.join(__dirname, '..', 'src');
  fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).sort().forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), context, { filename: file });
  });

  env.gs = context;
  env.post = (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  env.postRaw = (contents) => JSON.parse(context.doPost({ postData: { contents } }).content);
  env.advance = (minutes) => { env.clock += minutes * 60 * 1000; };
  return env;
}

module.exports = { createEnvironment };
