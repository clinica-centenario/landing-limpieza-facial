/**
 * Clínica Centenario — Landing "Limpieza facial profunda"
 * Configuración operativa del backend (Google Apps Script).
 *
 * Valores NO sensibles: se pueden dejar acá o sobreescribir desde
 * Propiedades del script (Configuración del proyecto → Propiedades del script).
 * Una propiedad del script con el mismo nombre SIEMPRE gana sobre este archivo.
 *
 * Secretos (LEAD_SECRET, META_CAPI_TOKEN, TURNSTILE_SECRET) e IDs privados
 * (SHEET_ID, calendarios) van SOLO en Propiedades del script: este repositorio es público.
 *
 * Los días y horarios de atención, las fechas cerradas y los parámetros de agenda
 * se editan en la planilla "Datos Landing" (pestañas Horarios, Días cerrados y
 * Configuración). Lo que esté cargado en la planilla gana sobre este archivo.
 *
 * Todo lo marcado PENDIENTE no está definido todavía: no inventar valores.
 */
var DEFAULT_CONFIG = {
  // ── Entorno ───────────────────────────────────────────────
  ENV: 'production', // 'development' | 'production'. En development las filas y eventos llevan prefijo [TEST].

  // ── Calendarios ───────────────────────────────────────────
  PRO_CALENDAR_ID: '',            // Opcional: calendario de la profesional. Vacío = no se cruza ni se escribe en él.
  ROOM_CALENDAR_IDS: '',          // Lo completa setupRoomCalendar() en Propiedades del script (no pegar acá)
  ROOM_LABELS: 'Con 3 - Camilla 1', // Nombre del calendario del consultorio en la cuenta (se usa para encontrarlo)
  TIMEZONE: 'America/Montevideo',

  // ── Agenda (valores por defecto; la planilla los sobrescribe) ──
  // Días y franjas horarias: pestaña "Horarios". Fechas cerradas: pestaña "Días cerrados".
  DURATION_MIN: 60,
  SLOT_STEP_MIN: 30,              // cada cuánto puede empezar una sesión
  BUFFER_BEFORE_MIN: 0,           // margen libre antes de la sesión
  BUFFER_AFTER_MIN: 0,            // margen libre después de la sesión
  MIN_NOTICE_HOURS: 0,            // PENDIENTE (regla de anticipación). 0 = solo excluye horarios ya pasados.
  HORIZON_DAYS: 60,               // hasta cuántos días hacia adelante se puede reservar
  MAX_DAYS_PER_QUERY: 7,
  RECOMMEND_WITHIN_HOURS: 24,     // se priorizan horarios dentro de esta ventana
  RECOMMEND_COUNT: 3,             // cuántos horarios se le ofrecen a la persona
  WHATSAPP_NUMBER: '',            // contacto si ningún horario le sirve (con código de país, sin +)

  // ── Servicio y precios ────────────────────────────────────
  SERVICE_NAME: 'Limpieza facial profunda personalizada',
  PROFESSIONAL_NAME: 'Lic. Jaqueline Mansilla',
  ADDRESS: 'Av. Centenario 3090A, Montevideo',
  LIST_PRICE_UYU: 2280,
  PREPAID_PRICE_UYU: 1824,
  CONSENT_VERSION: 'v1-2026-10',

  // ── Contenido de los eventos de calendario ────────────────
  // El evento del consultorio NUNCA lleva datos del paciente.
  // El evento de la profesional lleva nombre y celular para que pueda contactar.
  PRO_EVENT_INCLUDES_CONTACT: true,

  // ── Planilla ──────────────────────────────────────────────
  SHEET_ID: '',                   // Lo completa setupSheet() en Propiedades del script (no pegar acá)

  // ── Antiabuso ─────────────────────────────────────────────
  MIN_FILL_MS: 2500,              // envíos más rápidos que esto se tratan como bot
  MAX_LEADS_PER_CONTACT_HOUR: 5,
  MAX_LEADS_GLOBAL_MINUTE: 30,
  ALLOWED_ORIGINS: '',            // opcional, orígenes esperados (solo informativo para logs)

  // ── Análisis de piel con IA (opcional) ────────────────────
  // Requiere además el secreto ANTHROPIC_API_KEY en Propiedades del script.
  AI_ENABLED: false,
  AI_MODEL: 'claude-sonnet-5-5',
  AI_MAX_PER_HOUR: 60,            // tope global por hora (control de costo)
  AI_MAX_PER_DAY: 300,            // tope global por día
  AI_MAX_PER_CLIENT_DAY: 5,       // por dispositivo (identificador anónimo del navegador)

  // ── Meta Conversions API (opcional) ───────────────────────
  META_PIXEL_ID: '',              // PENDIENTE
  CAPI_ENABLED: false,
  CAPI_SEND_HASHED_USER_DATA: false, // por defecto NO se envían email/teléfono ni siquiera hasheados
  CAPI_TEST_EVENT_CODE: ''
};

/** Parámetros que el equipo puede cambiar desde la pestaña Configuración. */
var SHEET_KEYS_ = ['DURATION_MIN', 'SLOT_STEP_MIN', 'MIN_NOTICE_HOURS', 'HORIZON_DAYS', 'RECOMMEND_WITHIN_HOURS',
                   'RECOMMEND_COUNT', 'BUFFER_BEFORE_MIN', 'BUFFER_AFTER_MIN', 'WHATSAPP_NUMBER'];

/**
 * Configuración efectiva: planilla (solo SHEET_KEYS_) > Propiedades del script > DEFAULT_CONFIG.
 * cfg.WEEKLY = { 1..7: [{from, to}] } en minutos; vacío si la planilla no se puede leer (falla cerrada).
 */
function getConfig() {
  var props = {};
  try { props = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { props = {}; }
  var tz = props.TIMEZONE || DEFAULT_CONFIG.TIMEZONE;
  var sheet = readSheetSettings_(props.SHEET_ID || DEFAULT_CONFIG.SHEET_ID, tz);
  var cfg = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    var def = DEFAULT_CONFIG[k];
    var raw = Object.prototype.hasOwnProperty.call(props, k) ? props[k] : def;
    if (SHEET_KEYS_.indexOf(k) >= 0 && sheet.params[k] !== undefined && sheet.params[k] !== '') raw = sheet.params[k];
    if (typeof def === 'number') cfg[k] = Number(raw);
    else if (typeof def === 'boolean') cfg[k] = (raw === true || raw === 'true');
    else cfg[k] = String(raw == null ? '' : raw);
  });
  cfg.ROOM_CALENDAR_LIST = splitList_(cfg.ROOM_CALENDAR_IDS);
  cfg.ROOM_LABEL_LIST = splitList_(cfg.ROOM_LABELS);
  if (!(cfg.DURATION_MIN > 0)) cfg.DURATION_MIN = DEFAULT_CONFIG.DURATION_MIN;
  if (!(cfg.SLOT_STEP_MIN > 0)) cfg.SLOT_STEP_MIN = DEFAULT_CONFIG.SLOT_STEP_MIN;
  if (!(cfg.RECOMMEND_COUNT > 0)) cfg.RECOMMEND_COUNT = DEFAULT_CONFIG.RECOMMEND_COUNT;
  cfg.WHATSAPP_NUMBER = cfg.WHATSAPP_NUMBER.replace(/\D/g, '');
  cfg.WEEKLY = sheet.weekly;
  cfg.CLOSED_DATE_LIST = sheet.closed;
  return cfg;
}

function splitList_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

/** Qué falta para que la reserva funcione de verdad. */
function missingConfig_(cfg) {
  var missing = [];
  if (!cfg.ROOM_CALENDAR_LIST.length) missing.push('ROOM_CALENDAR_IDS (correr setupRoomCalendar)');
  if (!cfg.SHEET_ID) missing.push('SHEET_ID');
  if (!getSecret_('LEAD_SECRET')) missing.push('LEAD_SECRET (correr setupSecrets)');
  return missing;
}

function getSecret_(name) {
  try { return PropertiesService.getScriptProperties().getProperty(name) || ''; } catch (e) { return ''; }
}

function roomLabel_(cfg, calId) {
  var i = cfg.ROOM_CALENDAR_LIST.indexOf(calId);
  return (i >= 0 && cfg.ROOM_LABEL_LIST[i]) ? cfg.ROOM_LABEL_LIST[i] : ('Consultorio ' + (i + 1));
}
