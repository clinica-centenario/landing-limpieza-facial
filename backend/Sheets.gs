/**
 * Registro de seguimiento en Google Sheets.
 * La planilla NO es el mecanismo anti-conflicto de agenda: eso lo resuelven
 * el lock del script + la revalidación en Calendar (ver Booking.gs).
 */

var TAB_CONTACTS = 'Contactos';
var TAB_HOURS = 'Horarios';
var TAB_CLOSED = 'Días cerrados';
var TAB_CONFIG = 'Configuración';
var TAB_ANALYSIS = 'Análisis de piel';
var TAB_EVENTS = 'Eventos';
var TAB_RECON = 'Conciliación';

var CONTACT_HEADERS = [
  'ID solicitud', 'Creada', 'Nombre', 'Apellido', 'Celular', 'Email', 'Origen',
  'Estado reserva', 'Fecha reservada', 'Hora reservada', 'Consultorio',
  'ID reserva', 'ID evento consultorio',
  'Precio lista (UYU)', 'Precio pago anticipado ofrecido (UYU)', 'Estado de pago',
  'Consentimiento versión', 'Consentimiento fecha', 'Acepta novedades',
  'URL origen', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid',
  'Solicitudes previas (mismo contacto)', 'Entorno', 'Actualizada', 'Notas internas'
];
var EVENT_HEADERS = ['Fecha', 'ID solicitud', 'Evento', 'Detalle', 'Entorno'];
var RECON_HEADERS = ['Fecha', 'ID solicitud', 'ID reserva', 'Problema', 'Datos para resolver', 'Resuelto'];
var HOURS_HEADERS = ['Día', 'Desde', 'Hasta', 'Activo', 'Nota'];
var CLOSED_HEADERS = ['Fecha (AAAA-MM-DD)', 'Motivo'];
var CONFIG_HEADERS = ['Parámetro', 'Valor', 'Nota', 'Clave (no modificar)'];
var ANALYSIS_HEADERS = ['ID análisis', 'Fecha', 'ID solicitud', 'Nombre', 'Apellido', 'Celular', 'Email', 'Tipo de piel',
                        'Observaciones', 'Foco sugerido para la sesión', 'Cuidados en casa', 'Reservó', 'Entorno'];
var DAY_NAMES_ = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

var STATUS = {
  RECEIVED: 'Datos recibidos',
  CONFIRMED: 'Reserva confirmada',
  RECONCILE: 'Pendiente de conciliación'
};
var PAYMENT_STATUS_DEFAULT = 'Sin pago registrado';

/**
 * Ejecutar desde el editor del script vinculado a "Datos Landing" (cuenta ccentenario3090@gmail.com).
 * Guarda SHEET_ID en Propiedades del script y completa solo las pestañas que falten:
 * nunca borra horarios ni configuración cargados por el equipo.
 */
function setupSheet() {
  var props = PropertiesService.getScriptProperties();
  var cfg = getConfig();
  var ss = cfg.SHEET_ID ? SpreadsheetApp.openById(cfg.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abrí el script desde la planilla (Extensiones → Apps Script) o cargá SHEET_ID en Propiedades del script.');
  ss.setSpreadsheetTimeZone(cfg.TIMEZONE);
  ensureTab_(ss, TAB_CONTACTS, CONTACT_HEADERS);
  ensureTab_(ss, TAB_HOURS, HOURS_HEADERS, DAY_NAMES_.map(function (d) { return [d, '', '', 'No', '']; }));
  ensureTab_(ss, TAB_CLOSED, CLOSED_HEADERS);
  ensureTab_(ss, TAB_CONFIG, CONFIG_HEADERS, defaultConfigRows_());
  ensureTab_(ss, TAB_ANALYSIS, ANALYSIS_HEADERS);
  ensureTab_(ss, TAB_EVENTS, EVENT_HEADERS);
  ensureTab_(ss, TAB_RECON, RECON_HEADERS);
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  props.setProperty('SHEET_ID', ss.getId());
  clearSheetSettingsCache_();
  Logger.log('Planilla lista: ' + ss.getUrl());
  return ss.getUrl();
}

/** Crea la pestaña con encabezados (y filas iniciales) solo si está vacía. */
function ensureTab_(ss, name, headers, initialRows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e9eddd');
    sh.setFrozenRows(1);
    // Todo como texto plano: refuerzo adicional contra fórmulas y conversiones automáticas.
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), headers.length).setNumberFormat('@');
    if (initialRows && initialRows.length) sh.getRange(2, 1, initialRows.length, headers.length).setValues(initialRows);
  }
  return sh;
}

function defaultConfigRows_() {
  var d = DEFAULT_CONFIG;
  return [
    ['Duración de la sesión (min)', String(d.DURATION_MIN), '', 'DURATION_MIN'],
    ['Intervalo entre inicios (min)', String(d.SLOT_STEP_MIN), 'Cada cuánto puede empezar un turno', 'SLOT_STEP_MIN'],
    ['Anticipación mínima (horas)', String(d.MIN_NOTICE_HOURS), '0 = solo se ocultan los horarios ya pasados', 'MIN_NOTICE_HOURS'],
    ['Días hacia adelante para reservar', String(d.HORIZON_DAYS), '', 'HORIZON_DAYS'],
    ['Ventana de recomendación (horas)', String(d.RECOMMEND_WITHIN_HOURS), 'Se priorizan los horarios libres dentro de esta ventana', 'RECOMMEND_WITHIN_HOURS'],
    ['Horarios a recomendar', String(d.RECOMMEND_COUNT), '', 'RECOMMEND_COUNT'],
    ['Margen antes de la sesión (min)', String(d.BUFFER_BEFORE_MIN), '', 'BUFFER_BEFORE_MIN'],
    ['Margen después de la sesión (min)', String(d.BUFFER_AFTER_MIN), '', 'BUFFER_AFTER_MIN'],
    ['WhatsApp de contacto', d.WHATSAPP_NUMBER, 'Número con código de país, sin espacios. Ej.: 59899123456', 'WHATSAPP_NUMBER'],
    ['Franja: primera hora de la tarde', d.BAND_EARLY_AFTERNOON, 'Se ofrece un horario que empiece en esta franja', 'BAND_EARLY_AFTERNOON'],
    ['Franja: media tarde', d.BAND_MID_AFTERNOON, 'Se ofrece un horario que empiece en esta franja', 'BAND_MID_AFTERNOON'],
    ['Franja: noche', d.BAND_EVENING, 'Se ofrece un horario que empiece en esta franja', 'BAND_EVENING']
  ];
}

// ── Lectura de Horarios, Días cerrados y Configuración ───────

var SHEET_SETTINGS_CACHE_KEY_ = 'sheet_settings_v1';

/**
 * { weekly: {1..7: [{from,to}]}, closed: ['YYYY-MM-DD'], params: {CLAVE: 'valor'} }
 * Caché de 60 s: un cambio en la planilla se ve en la landing en menos de un minuto.
 * Si la planilla no se puede leer, devuelve todo vacío → no se ofrecen horarios.
 */
function readSheetSettings_(sheetId, tz) {
  var empty = { weekly: {}, closed: [], params: {} };
  if (!sheetId) return empty;
  var cache = null;
  try { cache = CacheService.getScriptCache(); var hit = cache.get(SHEET_SETTINGS_CACHE_KEY_); if (hit) return JSON.parse(hit); } catch (e) {}
  var out;
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    out = {
      weekly: parseWeekly_(displayRows_(ss.getSheetByName(TAB_HOURS))),
      closed: parseClosedDates_(displayRows_(ss.getSheetByName(TAB_CLOSED))),
      params: parseParams_(displayRows_(ss.getSheetByName(TAB_CONFIG)))
    };
  } catch (e) {
    console.warn('No se pudo leer la configuración de la planilla: ' + shortErr_(e));
    return empty;
  }
  try { cache.put(SHEET_SETTINGS_CACHE_KEY_, JSON.stringify(out), 60); } catch (e) {}
  return out;
}

function clearSheetSettingsCache_() {
  try { CacheService.getScriptCache().remove(SHEET_SETTINGS_CACHE_KEY_); } catch (e) {}
}

/** Filas de datos (sin encabezado) tal como se ven en la planilla. */
function displayRows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues();
}

function normalizeWord_(s) {
  return String(s || '').toLowerCase().trim().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');
}

/** Horarios: una fila por franja. Se puede repetir el día para tener varias franjas. */
function parseWeekly_(rows) {
  var days = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
  var weekly = {};
  rows.forEach(function (r) {
    var dow = days[normalizeWord_(r[0])];
    var active = /^(si|s|x|true|verdadero)$/.test(normalizeWord_(r[3]));
    var from = parseSheetTime_(r[1]), to = parseSheetTime_(r[2]);
    if (!dow || !active || from === null || to === null || to <= from) return;
    (weekly[dow] = weekly[dow] || []).push({ from: from, to: to });
  });
  return weekly;
}

/** Acepta 2026-12-25 y 25/12/2026. */
function parseClosedDates_(rows) {
  var out = [];
  rows.forEach(function (r) {
    var s = String(r[0] || '').trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) out.push(m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]));
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) out.push(m[3] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[1]));
  });
  return out;
}

/** Configuración: se lee por la columna "Clave"; solo claves conocidas. */
function parseParams_(rows) {
  var out = {};
  rows.forEach(function (r) {
    var k = String(r[3] || '').trim();
    if (SHEET_KEYS_.indexOf(k) < 0) return;
    var v = String(r[1] == null ? '' : r[1]).trim();
    if (TEXT_SHEET_KEYS_.indexOf(k) < 0 && v !== '' && !/^\d+$/.test(v)) return; // valores numéricos inválidos se ignoran
    out[k] = v;
  });
  return out;
}

function openSS_(cfg) { return SpreadsheetApp.openById(cfg.SHEET_ID); }

function headerIndex_(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  h.forEach(function (name, i) { idx[name] = i; });
  return idx;
}

/** Busca la fila de una solicitud (número de fila 1-based) o -1. */
function findContactRow_(sh, requestId) {
  var f = sh.getRange('A:A').createTextFinder(requestId).matchEntireCell(true).findNext();
  return f ? f.getRow() : -1;
}

function readContact_(cfg, requestId) {
  var sh = openSS_(cfg).getSheetByName(TAB_CONTACTS);
  var row = findContactRow_(sh, requestId);
  if (row < 0) return null;
  var idx = headerIndex_(sh);
  var vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var o = { _row: row };
  Object.keys(idx).forEach(function (k) { o[k] = vals[idx[k]]; });
  return o;
}

/** Solicitudes anteriores del mismo email o celular (para trazabilidad, sin sobrescribir). */
function previousRequestIds_(sh, email, phone) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var idx = headerIndex_(sh);
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var ids = [];
  data.forEach(function (r) {
    var e = String(r[idx['Email']]).replace(/^'/, ''), p = String(r[idx['Celular']]).replace(/^'/, '');
    if (e === email || p === phone) ids.push(String(r[idx['ID solicitud']]));
  });
  return ids.slice(-10);
}

function appendContact_(cfg, rec) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = openSS_(cfg).getSheetByName(TAB_CONTACTS);
    var prev = previousRequestIds_(sh, rec.email, rec.phone);
    var idx = headerIndex_(sh);
    var row = new Array(Object.keys(idx).length).fill('');
    var set = function (k, v) { if (k in idx) row[idx[k]] = sheetSafe_(v); };
    var tag = cfg.ENV === 'production' ? '' : '[TEST] ';
    set('ID solicitud', rec.requestId);
    set('Creada', rec.createdLocal);
    set('Nombre', tag + rec.firstName);
    set('Apellido', rec.lastName);
    set('Celular', rec.phone);
    set('Email', rec.email);
    set('Origen', rec.origin);
    set('Estado reserva', STATUS.RECEIVED);
    set('Precio lista (UYU)', String(cfg.LIST_PRICE_UYU));
    set('Precio pago anticipado ofrecido (UYU)', String(cfg.PREPAID_PRICE_UYU));
    set('Estado de pago', PAYMENT_STATUS_DEFAULT);
    set('Consentimiento versión', rec.consentVersion);
    set('Consentimiento fecha', rec.createdLocal);
    set('Acepta novedades', rec.marketing ? 'Sí' : 'No');
    set('URL origen', rec.pageUrl);
    UTM_KEYS_.forEach(function (k) { set(k, rec.utm[k] || ''); });
    set('Solicitudes previas (mismo contacto)', prev.join(', '));
    set('Entorno', cfg.ENV);
    set('Actualizada', rec.createdLocal);
    sh.appendRow(row);
    SpreadsheetApp.flush();
    if (findContactRow_(sh, rec.requestId) < 0) throw new Error('La fila no quedó escrita');
    return { previous: prev.length };
  } finally {
    lock.releaseLock();
  }
}

/** Actualiza campos de la MISMA fila de la solicitud (no crea filas nuevas). */
function updateContact_(cfg, requestId, fields) {
  var sh = openSS_(cfg).getSheetByName(TAB_CONTACTS);
  var row = findContactRow_(sh, requestId);
  if (row < 0) throw new Error('Solicitud no encontrada en planilla');
  var idx = headerIndex_(sh);
  var range = sh.getRange(row, 1, 1, sh.getLastColumn());
  var vals = range.getValues()[0];
  Object.keys(fields).forEach(function (k) { if (k in idx) vals[idx[k]] = sheetSafe_(fields[k]); });
  if ('Actualizada' in idx) vals[idx['Actualizada']] = nowLocal_(cfg);
  range.setValues([vals]);
  SpreadsheetApp.flush();
}

function logEvent_(cfg, requestId, event, detail) {
  try {
    var sh = openSS_(cfg).getSheetByName(TAB_EVENTS);
    sh.appendRow([nowLocal_(cfg), requestId || '', event, detail ? JSON.stringify(detail) : '', cfg.ENV].map(sheetSafe_));
  } catch (e) {
    console.warn('logEvent falló: ' + event + ' ' + (requestId || ''));
  }
}

function logReconcile_(cfg, requestId, bookingId, problem, data) {
  try {
    var sh = openSS_(cfg).getSheetByName(TAB_RECON);
    sh.appendRow([nowLocal_(cfg), requestId, bookingId, problem, JSON.stringify(data || {}), 'No'].map(sheetSafe_));
  } catch (e) {
    // Último recurso: propiedades del script (sin datos personales).
    PropertiesService.getScriptProperties().setProperty('RECON_' + bookingId, JSON.stringify({ requestId: requestId, problem: problem, data: data }));
  }
}

/** ¿La misma persona (email o celular) ya tuvo una reserva confirmada en otra solicitud? */
function hasPriorBooking_(cfg, requestId, email, phone) {
  var sh = openSS_(cfg).getSheetByName(TAB_CONTACTS);
  var last = sh.getLastRow();
  if (last < 2) return false;
  var idx = headerIndex_(sh);
  var clean = function (v) { return String(v == null ? '' : v).replace(/^'/, ''); };
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().some(function (r) {
    if (clean(r[idx['ID solicitud']]) === requestId) return false;
    var same = (email && clean(r[idx['Email']]) === email) || (phone && clean(r[idx['Celular']]) === phone);
    return same && clean(r[idx['Estado reserva']]) === STATUS.CONFIRMED;
  });
}

/** Guarda el resultado del análisis de piel (nunca la foto) junto a los datos de la solicitud. */
function appendAnalysis_(cfg, contact, result) {
  var sh = openSS_(cfg).getSheetByName(TAB_ANALYSIS);
  var idx = headerIndex_(sh);
  var row = new Array(Object.keys(idx).length).fill('');
  var set = function (k, v) { if (k in idx) row[idx[k]] = sheetSafe_(v); };
  var clean = function (v) { return String(v == null ? '' : v).replace(/^'/, ''); };
  var id = 'AP-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  set('ID análisis', id);
  set('Fecha', nowLocal_(cfg));
  set('ID solicitud', clean(contact['ID solicitud']));
  set('Nombre', clean(contact['Nombre']));
  set('Apellido', clean(contact['Apellido']));
  set('Celular', clean(contact['Celular']));
  set('Email', clean(contact['Email']));
  set('Tipo de piel', result.skin_type + (result.skin_type_confidence ? ' (confianza ' + result.skin_type_confidence + ')' : ''));
  set('Observaciones', [result.summary].concat((result.observations || []).map(function (o) { return o.area + ': ' + o.text; })).filter(Boolean).join(' · '));
  set('Foco sugerido para la sesión', (result.session_focus || []).join(', '));
  set('Cuidados en casa', (result.home_tips || []).join(' · '));
  set('Reservó', 'No');
  set('Entorno', cfg.ENV);
  sh.appendRow(row);
  return id;
}

/** Marca "Reservó = Sí" en los análisis de esa solicitud. */
function markAnalysisBooked_(cfg, requestId) {
  try {
    var sh = openSS_(cfg).getSheetByName(TAB_ANALYSIS);
    var last = sh.getLastRow();
    if (last < 2) return;
    var idx = headerIndex_(sh);
    var range = sh.getRange(2, 1, last - 1, sh.getLastColumn());
    var vals = range.getValues(), changed = false;
    vals.forEach(function (r) { if (String(r[idx['ID solicitud']]) === requestId && r[idx['Reservó']] !== 'Sí') { r[idx['Reservó']] = 'Sí'; changed = true; } });
    if (changed) range.setValues(vals);
  } catch (e) { console.warn('markAnalysisBooked falló'); }
}

function nowLocal_(cfg) { return Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
