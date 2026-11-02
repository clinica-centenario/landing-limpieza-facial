/**
 * Clínica Centenario — Landing "Limpieza facial profunda"
 * Configuración operativa del backend (Google Apps Script).
 *
 * Valores NO sensibles: se pueden dejar acá o sobreescribir desde
 * Propiedades del script (Configuración del proyecto → Propiedades del script).
 * Una propiedad del script con el mismo nombre SIEMPRE gana sobre este archivo.
 *
 * Secretos (LEAD_SECRET, META_CAPI_TOKEN, TURNSTILE_SECRET) van SOLO en
 * Propiedades del script. Nunca en este archivo ni en la planilla.
 *
 * Todo lo marcado PENDIENTE no está definido todavía: no inventar valores.
 */
var DEFAULT_CONFIG = {
  // ── Entorno ───────────────────────────────────────────────
  ENV: 'development', // 'development' | 'production'. En development las filas llevan prefijo [TEST].

  // ── Calendarios ───────────────────────────────────────────
  PRO_CALENDAR_ID: '',            // PENDIENTE: calendario de la Lic. Jaqueline Mansilla (compartido con permiso de edición)
  ROOM_CALENDAR_IDS: '',          // PENDIENTE: IDs de consultorios habilitados, separados por coma, en orden de preferencia
  ROOM_LABELS: '',                // Opcional: nombres internos en el mismo orden (p.ej. "Consultorio 5,Con 3 - Camilla 1")
  TIMEZONE: 'America/Montevideo',

  // ── Agenda ────────────────────────────────────────────────
  WORKING_DAYS: '1,2,3,4,5',      // 1 = lunes … 7 = domingo
  OPEN_TIME: '09:00',
  CLOSE_TIME: '21:00',
  LAST_START_TIME: '20:00',
  DURATION_MIN: 60,
  SLOT_STEP_MIN: 30,              // cada cuánto puede empezar una sesión
  BUFFER_BEFORE_MIN: 0,           // margen libre antes de la sesión
  BUFFER_AFTER_MIN: 0,            // margen libre después de la sesión
  MIN_NOTICE_HOURS: 0,            // PENDIENTE (regla de anticipación). 0 = solo excluye horarios ya pasados.
  HORIZON_DAYS: 60,               // hasta cuántos días hacia adelante se puede reservar
  CLOSED_DATES: '',               // fechas cerradas YYYY-MM-DD separadas por coma (feriados, licencias)
  MAX_DAYS_PER_QUERY: 7,

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
  SHEET_ID: '',                   // Se completa solo al correr setupSheet(), o pegá el ID de una planilla existente

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

/** Lee la configuración efectiva: Propiedades del script > DEFAULT_CONFIG. */
function getConfig() {
  var props = {};
  try { props = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { props = {}; }
  var cfg = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    var def = DEFAULT_CONFIG[k];
    var raw = Object.prototype.hasOwnProperty.call(props, k) ? props[k] : def;
    if (typeof def === 'number') cfg[k] = Number(raw);
    else if (typeof def === 'boolean') cfg[k] = (raw === true || raw === 'true');
    else cfg[k] = String(raw == null ? '' : raw);
  });
  cfg.ROOM_CALENDAR_LIST = splitList_(cfg.ROOM_CALENDAR_IDS);
  cfg.ROOM_LABEL_LIST = splitList_(cfg.ROOM_LABELS);
  cfg.WORKING_DAY_LIST = splitList_(cfg.WORKING_DAYS).map(Number);
  cfg.CLOSED_DATE_LIST = splitList_(cfg.CLOSED_DATES);
  return cfg;
}

function splitList_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

/** Qué falta para que la reserva funcione de verdad. */
function missingConfig_(cfg) {
  var missing = [];
  if (!cfg.PRO_CALENDAR_ID) missing.push('PRO_CALENDAR_ID');
  if (!cfg.ROOM_CALENDAR_LIST.length) missing.push('ROOM_CALENDAR_IDS');
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
