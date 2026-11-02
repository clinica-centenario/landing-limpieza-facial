/**
 * Validación, saneamiento, tokens y antiabuso.
 */

/** Evita inyección de fórmulas en Sheets (=, +, -, @, tab, CR). */
function sheetSafe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return v;
  var s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function cleanText_(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

/** Nombre y apellido: letras, espacios, apóstrofes y guiones; al menos 2 palabras. */
function validateName_(raw) {
  var s = cleanText_(raw, 80);
  if (s.length < 4) return null;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿÑñ' .\-]+$/.test(s)) return null;
  if (s.split(' ').filter(function (w) { return w.replace(/[.'\-]/g, '').length > 0; }).length < 2) return null;
  return s;
}

/**
 * Celular uruguayo → E.164 (+5989XXXXXXX).
 * Acepta: 09X XXX XXX · 9X XXX XXX · +598 9X XXX XXX · 598 9X… · 00598 9X…
 */
function normalizeUyMobile_(raw) {
  var d = String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
  if (d.indexOf('+') > 0) return null;
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (/^598/.test(d)) d = d.slice(3);
  if (/^0/.test(d)) d = d.slice(1);
  if (!/^9\d{7}$/.test(d)) return null;          // celulares UY: 9 + 7 dígitos
  return '+598' + d;
}

function validateEmail_(raw) {
  var s = cleanText_(raw, 120).toLowerCase();
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

function validateUrl_(raw) {
  var s = cleanText_(raw, 500);
  return /^https?:\/\/[^\s]+$/.test(s) ? s : '';
}

var UTM_KEYS_ = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid'];
function cleanUtm_(obj) {
  var out = {};
  if (!obj || typeof obj !== 'object') return out;
  UTM_KEYS_.forEach(function (k) {
    if (obj[k]) out[k] = cleanText_(obj[k], 150).replace(/[^\w\-.~:%|+ ]/g, '');
  });
  return out;
}

// ── Identificadores y tokens ─────────────────────────────────

function newRequestId_(now, tz) {
  var stamp = Utilities.formatDate(now, tz, 'yyMMdd');
  var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  return 'CC-' + stamp + '-' + rand;
}

function hmacHex_(text) {
  var secret = getSecret_('LEAD_SECRET');
  if (!secret) throw new Error('LEAD_SECRET no configurado');
  var bytes = Utilities.computeHmacSha256Signature(text, secret);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Token que prueba que quien pide agenda/reserva es quien guardó la solicitud. */
function leadToken_(requestId) { return hmacHex_('lead:' + requestId).slice(0, 40); }

function checkLeadToken_(requestId, token) {
  if (!/^CC-\d{6}-[0-9A-F]{6}$/.test(String(requestId || ''))) return false;
  var expected = leadToken_(requestId);
  var given = String(token || '');
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * ID de reserva determinista a partir de (solicitud, clave de idempotencia).
 * El mismo intento repetido (doble clic / reintento) produce el mismo ID y los
 * mismos IDs de evento de Google Calendar → el segundo insert choca (409) en vez de duplicar.
 */
function bookingIdFor_(requestId, idemKey) { return 'R' + hmacHex_('book:' + requestId + ':' + idemKey).slice(0, 10).toUpperCase(); }

/** IDs de evento válidos para Calendar: base32hex (a-v, 0-9), 5–1024 caracteres. */
function calendarEventId_(bookingId, role) {
  var hex = hmacHex_('evt:' + bookingId + ':' + role).slice(0, 26);
  return 'cc' + role + hex; // role: 'p' (profesional) | 'r' (consultorio); hex ⊂ base32hex
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

// ── Antiabuso ────────────────────────────────────────────────

/** true si se excede el límite. Usa CacheService (ventanas aproximadas). */
function rateLimited_(key, limit, windowSec) {
  var cache = CacheService.getScriptCache();
  var k = 'rl:' + key;
  var n = Number(cache.get(k) || 0);
  if (n >= limit) return true;
  cache.put(k, String(n + 1), windowSec);
  return false;
}

/** Turnstile opcional: si no hay TURNSTILE_SECRET configurado, no se exige. */
function verifyTurnstile_(token) {
  var secret = getSecret_('TURNSTILE_SECRET');
  if (!secret) return true;
  if (!token) return false;
  try {
    var r = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post', payload: { secret: secret, response: String(token) }, muteHttpExceptions: true
    });
    return JSON.parse(r.getContentText()).success === true;
  } catch (e) { return false; }
}
