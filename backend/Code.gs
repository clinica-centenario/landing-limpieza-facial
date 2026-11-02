/**
 * Punto de entrada del Web App.
 * Desplegar como: Ejecutar como "Yo (ccentenario3090@gmail.com)" · Acceso: "Cualquier persona".
 * El navegador envía POST con Content-Type text/plain (evita preflight CORS) y JSON en el cuerpo.
 */

function doGet() {
  var cfg = getConfig();
  var missing = missingConfig_(cfg);
  return json_({ ok: true, service: 'cc-limpieza-facial', env: cfg.ENV, ready: missing.length === 0, missing: missing });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_(fail_('invalid_request')); }
  var cfg = getConfig();
  var now = new Date();
  try {
    switch (body.action) {
      case 'lead': return json_(handleLead_(cfg, body, now));
      case 'availability': return json_(handleAvailability_(cfg, body, now));
      case 'book': return json_(handleBook_(cfg, body, now));
      case 'track': return json_(handleTrack_(cfg, body));
      case 'analyze': return json_(handleAnalyze_(cfg, body));
      default: return json_(fail_('invalid_request'));
    }
  } catch (err) {
    // Sin datos personales en logs.
    console.error('doPost ' + body.action + ': ' + shortErr_(err));
    return json_(fail_('server_error'));
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ── 1) Datos del formulario → Sheets ─────────────────────────
function handleLead_(cfg, body, now) {
  var missing = missingConfig_(cfg).filter(function (m) { return m.indexOf('CALENDAR') < 0; });
  if (missing.length) return fail_('not_configured');

  // Bots: honeypot y tiempo mínimo de llenado.
  if (body.website) return fail_('invalid_request');
  if (Number(body.elapsedMs || 0) < cfg.MIN_FILL_MS) return fail_('too_fast');
  if (rateLimited_('global', cfg.MAX_LEADS_GLOBAL_MINUTE, 60)) return fail_('rate_limited');
  if (!verifyTurnstile_(body.turnstileToken)) return fail_('captcha_failed');

  var errors = {};
  var name = validateName_(body.name); if (!name) errors.name = 'invalid';
  var phone = normalizeUyMobile_(body.phone); if (!phone) errors.phone = 'invalid';
  var email = validateEmail_(body.email); if (!email) errors.email = 'invalid';
  if (body.consent !== true) errors.consent = 'required';
  if (Object.keys(errors).length) return fail_('validation', { errors: errors });

  var contactKey = sha256Hex_(email).slice(0, 16), phoneKey = sha256Hex_(phone).slice(0, 16);
  if (rateLimited_('c:' + contactKey, cfg.MAX_LEADS_PER_CONTACT_HOUR, 3600) ||
      rateLimited_('p:' + phoneKey, cfg.MAX_LEADS_PER_CONTACT_HOUR, 3600)) return fail_('rate_limited');

  // Idempotencia del formulario: el mismo envío repetido devuelve la misma solicitud.
  var submitKey = String(body.submitKey || '');
  var cache = CacheService.getScriptCache();
  if (/^[A-Za-z0-9_-]{16,64}$/.test(submitKey)) {
    var prior = cache.get('sub:' + submitKey);
    if (prior) { var p = JSON.parse(prior); p.replay = true; return p; }
  }

  var requestId = newRequestId_(now, cfg.TIMEZONE);
  var rec = {
    requestId: requestId,
    createdLocal: Utilities.formatDate(now, cfg.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    name: name, phone: phone, email: email,
    marketing: body.marketing === true,
    consentVersion: cfg.CONSENT_VERSION,
    pageUrl: validateUrl_(body.pageUrl),
    utm: cleanUtm_(body.utm)
  };
  var res = appendContact_(cfg, rec); // lanza si no quedó escrito → server_error, sin éxito falso
  logEvent_(cfg, requestId, 'datos_recibidos', { previas: res.previous, utm_source: rec.utm.utm_source || '' });

  var out = { ok: true, requestId: requestId, token: leadToken_(requestId), leadEventId: 'lead_' + requestId };
  if (submitKey) cache.put('sub:' + submitKey, JSON.stringify(out), 1800);
  if (body.trackingConsent === true) sendCapi_(cfg, 'Lead', out.leadEventId, rec.pageUrl, body, { email: email, phone: phone });
  return out;
}

// ── 2) Disponibilidad real ───────────────────────────────────
function handleAvailability_(cfg, body, now) {
  if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
  if (!cfg.PRO_CALENDAR_ID || !cfg.ROOM_CALENDAR_LIST.length) return fail_('calendar_not_configured');
  var from = parseYmd_(body.from);
  if (!from) { var lp = localParts_(now, cfg.TIMEZONE); from = { y: lp.y, m: lp.m, d: lp.d }; }
  var days = Math.min(Math.max(Number(body.days) || 5, 1), cfg.MAX_DAYS_PER_QUERY);

  var cache = CacheService.getScriptCache();
  var ck = 'av:' + (cache.get('av_gen') || '0') + ':' + ymd_(from) + ':' + days;
  var cached = cache.get(ck);
  var result;
  if (cached) result = JSON.parse(cached);
  else {
    var r = computeAvailability_(cfg, from, days, now);
    result = { slots: r.slots.map(publicSlot_), calendarErrors: r.calendarErrors };
    cache.put(ck, JSON.stringify(result), 45); // caché corta: igual se revalida al confirmar
  }
  if (result.calendarErrors) logEvent_(cfg, body.requestId, 'error_lectura_calendario', {});
  if (result.slots.length && !cache.get('vh:' + body.requestId)) {
    cache.put('vh:' + body.requestId, '1', 21600);
    logEvent_(cfg, body.requestId, 'vio_horarios', { desde: ymd_(from), cantidad: result.slots.length });
  }
  var horizonEnd = new Date(now.getTime() + cfg.HORIZON_DAYS * 86400000);
  return {
    ok: true, from: ymd_(from), days: days, timezone: cfg.TIMEZONE,
    slots: result.slots,
    horizonEnd: ymd_(localParts_(horizonEnd, cfg.TIMEZONE)),
    degraded: !!result.calendarErrors
  };
}

// ── 3) Reserva ───────────────────────────────────────────────
function handleBook_(cfg, body, now) {
  if (!cfg.PRO_CALENDAR_ID || !cfg.ROOM_CALENDAR_LIST.length) return fail_('calendar_not_configured');
  var res = bookSlot_(cfg, body, now);
  if (res.ok && !res.replay) { var c = CacheService.getScriptCache(); c.put('av_gen', String(Number(c.get('av_gen') || 0) + 1), 21600); }
  if (!res.ok && res.code === 'slot_unavailable') { var c2 = CacheService.getScriptCache(); c2.put('av_gen', String(Number(c2.get('av_gen') || 0) + 1), 21600); }
  if (res.ok && !res.replay && body.trackingConsent === true) {
    sendCapi_(cfg, 'Schedule', res.scheduleEventId, validateUrl_(body.pageUrl), body, null);
  }
  return res;
}

// ── Hitos del embudo informados por el navegador (sin datos personales) ──
var TRACKABLE_ = ['formulario_abierto', 'eligio_horario'];
function handleTrack_(cfg, body) {
  if (TRACKABLE_.indexOf(body.event) < 0) return fail_('invalid_request');
  if (body.event === 'eligio_horario') {
    if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
    if (rateLimited_('tr:' + body.requestId, 30, 3600)) return { ok: true };
    logEvent_(cfg, body.requestId, 'eligio_horario', { start: cleanText_(body.start, 40) });
  }
  // formulario_abierto no se registra por solicitud (todavía no existe); queda solo en el píxel.
  return { ok: true };
}
