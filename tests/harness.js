// Banco de pruebas: carga los .gs reales en un contexto con servicios de Google simulados.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function toSigned(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }

function fmtDate(date, tz, fmt) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).forEach(p => parts[p.type] = p.value);
  if (fmt === 'Z') {
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const off = Math.round((asUtc - date.getTime()) / 60000);
    const s = off < 0 ? '-' : '+'; const a = Math.abs(off);
    return s + String(Math.floor(a / 60)).padStart(2, '0') + String(a % 60).padStart(2, '0');
  }
  return fmt.replace('yyyy', parts.year).replace('yy', parts.year.slice(2)).replace('MM', parts.month)
    .replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

function makeCalendar(state) {
  const cal = id => (state.cals[id] = state.cals[id] || []);
  const active = id => cal(id).filter(e => e.status !== 'cancelled');
  return {
    Freebusy: {
      query(req) {
        state.calls.freebusy++;
        const tMin = new Date(req.timeMin), tMax = new Date(req.timeMax);
        const calendars = {};
        req.items.forEach(({ id }) => {
          if (state.noAccess.has(id)) { calendars[id] = { errors: [{ reason: 'notFound' }] }; return; }
          calendars[id] = {
            busy: active(id).filter(e => e.transparency !== 'transparent')
              .filter(e => new Date(e.start.dateTime) < tMax && new Date(e.end.dateTime) > tMin)
              .map(e => ({ start: e.start.dateTime, end: e.end.dateTime }))
          };
        });
        return { calendars };
      }
    },
    Events: {
      insert(ev, calId) {
        state.calls.insert++;
        if (state.failInsert.has(calId)) throw new Error('API call to calendar.events.insert failed with error: Backend Error 500');
        if (cal(calId).some(e => e.id === ev.id)) throw new Error('API call failed with error: The requested identifier already exists. 409');
        const stored = JSON.parse(JSON.stringify(ev)); stored.status = 'confirmed';
        cal(calId).push(stored);
        if (state.afterInsert) state.afterInsert(calId, stored);
        return stored;
      },
      get(calId, id) {
        const e = cal(calId).find(x => x.id === id);
        if (!e) throw new Error('Not Found 404');
        return e;
      },
      remove(calId, id) {
        if (state.failDelete.has(calId)) throw new Error('Backend Error 503');
        const e = cal(calId).find(x => x.id === id);
        if (!e || e.status === 'cancelled') throw new Error('Resource has been deleted 410');
        e.status = 'cancelled';
      },
      list(calId, opt) {
        const tMin = new Date(opt.timeMin), tMax = new Date(opt.timeMax);
        return { items: active(calId).filter(e => new Date(e.start.dateTime) < tMax && new Date(e.end.dateTime) > tMin) };
      }
    },
    CalendarList: { get(id) { return { accessRole: 'writer' }; } }
  };
}

function makeSheets(state) {
  function sheetObj(name) {
    const rows = state.sheets[name];
    const api = {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      getMaxRows: () => Math.max(rows.length, 1000),
      appendRow(r) {
        if (state.failSheetWrite) throw new Error('Service Spreadsheets failed');
        rows.push(r.map(v => (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v));
      },
      getRange(a, b, nr, nc) {
        if (typeof a === 'string') {
          return { createTextFinder: (t) => ({ matchEntireCell: () => ({ findNext: () => {
            const i = rows.findIndex(r => String(r[0]) === t); return i < 0 ? null : { getRow: () => i + 1 }; } }) }) };
        }
        const chain = {
          getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const r = rows[a - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (_, j) => r[b - 1 + j] ?? '')); } return out; },
          getDisplayValues: () => chain.getValues().map(r => r.map(v => String(v))),
          setValues: (vals) => {
            if (state.failSheetWrite && a > 1) throw new Error('Service Spreadsheets failed');
            vals.forEach((r, i) => { rows[a - 1 + i] = rows[a - 1 + i] || []; r.forEach((v, j) => rows[a - 1 + i][b - 1 + j] = (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v); });
            return chain;
          },
          setFontWeight: () => chain, setBackground: () => chain, setNumberFormat: () => chain
        };
        return chain;
      },
      setFrozenRows() {}, clear() { rows.length = 0; }
    };
    return api;
  }
  const ss = {
    getId: () => 'SHEET123', getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEET123',
    setSpreadsheetTimeZone() {},
    getSheetByName: (n) => state.sheets[n] ? sheetObj(n) : null,
    insertSheet: (n) => { state.sheets[n] = []; return sheetObj(n); },
    getSheets: () => Object.keys(state.sheets).map(sheetObj), deleteSheet() {}
  };
  return { openById: () => { if (state.failSheetRead) throw new Error('Service Spreadsheets failed'); return ss; }, getActiveSpreadsheet: () => ss, flush() {} };
}

function createEnv(opts = {}) {
  const state = {
    cals: {}, sheets: {}, props: {}, cache: {},
    noAccess: new Set(), failInsert: new Set(), failDelete: new Set(), failSheetWrite: false,
    afterInsert: null, locked: false, calls: { freebusy: 0, insert: 0 }, logs: []
  };
  const ctx = {
    console: { log: () => {}, warn: (m) => state.logs.push(m), error: (m) => state.logs.push(m) },
    Intl, JSON, Math, Date, Object, Array, String, Number, Error, RegExp, isNaN, encodeURIComponent,
    Calendar: makeCalendar(state),
    SpreadsheetApp: makeSheets(state),
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...state.props }), getProperty: k => state.props[k] ?? null, setProperty: (k, v) => { state.props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => state.cache[k] ?? null, put: (k, v) => { state.cache[k] = v; }, remove: k => { delete state.cache[k]; } }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (state.locked) return false; state.locked = true; return true; },
      waitLock: () => { if (state.locked) throw new Error('Lock timeout'); state.locked = true; },
      releaseLock: () => { state.locked = false; } }) },
    Utilities: {
      formatDate: fmtDate,
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (t, k) => toSigned(crypto.createHmac('sha256', k).update(t).digest()),
      computeDigest: (alg, t) => toSigned(crypto.createHash('sha256').update(t, 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, sleep: () => {}
    },
    UrlFetchApp: { fetch: (url, o) => { state.logs.push('fetch ' + url.split('?')[0]); return { getContentText: () => '{"success":true}' }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: JSON.parse(s) }) }) },
    Logger: { log: (m) => state.logs.push(m) }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'backend');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

  Object.assign(state.props, {
    LEAD_SECRET: 'test-secret-only-for-tests',
    PRO_CALENDAR_ID: 'pro@cal', ROOM_CALENDAR_IDS: 'roomA@cal,roomB@cal', ROOM_LABELS: 'Consultorio A,Consultorio B',
    ...(opts.props || {})
  });
  if (opts.now) ctx.now_ = () => new Date(opts.now);
  vm.runInContext('setupSheet()', ctx);
  // Pestaña Horarios: por defecto lunes a viernes de 9 a 21 (cada test puede cambiarla con setHours).
  const setHours = (rows) => {
    state.sheets['Horarios'].splice(1, Infinity, ...rows.map(r => [r[0], r[1], r[2], r[3] ?? 'Sí', '']));
    delete state.cache.sheet_settings_v1;
  };
  const setParam = (key, value) => {
    const r = state.sheets['Configuración'].find(x => x[3] === key); r[1] = String(value);
    delete state.cache.sheet_settings_v1;
  };
  const setClosed = (dates) => {
    state.sheets['Días cerrados'].splice(1, Infinity, ...dates.map(d => [d, '']));
    delete state.cache.sheet_settings_v1;
  };
  setHours(opts.hours || ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].map(d => [d, '09:00', '21:00']));
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body;
  return { ctx, state, post, setHours, setParam, setClosed };
}

module.exports = { createEnv };
