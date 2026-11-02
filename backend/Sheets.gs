/**
 * Registro de seguimiento en Google Sheets.
 * La planilla NO es el mecanismo anti-conflicto de agenda: eso lo resuelven
 * el lock del script + la revalidación en Calendar (ver Booking.gs).
 */

var TAB_CONTACTS = 'Contactos';
var TAB_EVENTS = 'Eventos';
var TAB_CONFIG = 'Configuración';
var TAB_RECON = 'Conciliación';

var CONTACT_HEADERS = [
  'ID solicitud', 'Creada', 'Nombre y apellido', 'Celular', 'Email',
  'Estado reserva', 'Fecha reservada', 'Hora reservada', 'Profesional', 'Consultorio',
  'ID reserva', 'ID evento profesional', 'ID evento consultorio',
  'Precio lista (UYU)', 'Precio pago anticipado ofrecido (UYU)', 'Estado de pago',
  'Consentimiento versión', 'Consentimiento fecha', 'Acepta novedades',
  'URL origen', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid',
  'Solicitudes previas (mismo contacto)', 'Entorno', 'Actualizada', 'Notas internas'
];
var EVENT_HEADERS = ['Fecha', 'ID solicitud', 'Evento', 'Detalle', 'Entorno'];
var RECON_HEADERS = ['Fecha', 'ID solicitud', 'ID reserva', 'Problema', 'Datos para resolver', 'Resuelto'];

var STATUS = {
  RECEIVED: 'Datos recibidos',
  CONFIRMED: 'Reserva confirmada',
  RECONCILE: 'Pendiente de conciliación'
};
var PAYMENT_STATUS_DEFAULT = 'Sin pago registrado';

/**
 * Ejecutar UNA vez desde el editor (cuenta ccentenario3090@gmail.com).
 * Crea la planilla si SHEET_ID está vacío, o completa pestañas faltantes.
 */
function setupSheet() {
  var props = PropertiesService.getScriptProperties();
  var cfg = getConfig();
  var ss = cfg.SHEET_ID ? SpreadsheetApp.openById(cfg.SHEET_ID)
                        : SpreadsheetApp.create('Clínica Centenario — Limpieza facial — Solicitudes');
  ss.setSpreadsheetTimeZone(cfg.TIMEZONE);
  ensureTab_(ss, TAB_CONTACTS, CONTACT_HEADERS);
  ensureTab_(ss, TAB_EVENTS, EVENT_HEADERS);
  ensureTab_(ss, TAB_RECON, RECON_HEADERS);
  writeConfigTab_(ss, cfg);
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  props.setProperty('SHEET_ID', ss.getId());
  Logger.log('Planilla lista: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e9eddd');
    sh.setFrozenRows(1);
  }
  // Todo como texto plano: refuerzo adicional contra fórmulas.
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), headers.length).setNumberFormat('@');
  return sh;
}

/** Parámetros operativos NO sensibles, como referencia para el equipo. */
function writeConfigTab_(ss, cfg) {
  var sh = ss.getSheetByName(TAB_CONFIG) || ss.insertSheet(TAB_CONFIG);
  sh.clear();
  var rows = [['Parámetro', 'Valor', 'Nota']];
  ['ENV', 'TIMEZONE', 'WORKING_DAYS', 'OPEN_TIME', 'CLOSE_TIME', 'LAST_START_TIME', 'DURATION_MIN',
   'SLOT_STEP_MIN', 'BUFFER_BEFORE_MIN', 'BUFFER_AFTER_MIN', 'MIN_NOTICE_HOURS', 'HORIZON_DAYS',
   'CLOSED_DATES', 'LIST_PRICE_UYU', 'PREPAID_PRICE_UYU', 'CONSENT_VERSION'].forEach(function (k) {
    rows.push([k, String(cfg[k]), '']);
  });
  rows.push(['Calendario profesional configurado', cfg.PRO_CALENDAR_ID ? 'Sí' : 'PENDIENTE', 'El ID vive en Propiedades del script']);
  rows.push(['Consultorios habilitados', cfg.ROOM_CALENDAR_LIST.length ? String(cfg.ROOM_CALENDAR_LIST.length) : 'PENDIENTE', cfg.ROOM_LABELS]);
  rows.push(['Medio de pago / plazo del descuento', 'PENDIENTE', 'No publicado en la landing hasta definirlo']);
  rows.push(['Reglas de cancelación / reprogramación', 'PENDIENTE', '']);
  rows.push(['Nota', 'Esta pestaña es informativa. La configuración efectiva está en el script.', 'Nunca guardar tokens ni contraseñas acá.']);
  rows = rows.map(function (r) { return r.map(sheetSafe_); });
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e9eddd');
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
    set('Nombre y apellido', tag + rec.name);
    set('Celular', rec.phone);
    set('Email', rec.email);
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

function nowLocal_(cfg) { return Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
