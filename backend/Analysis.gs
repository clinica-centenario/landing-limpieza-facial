/**
 * Evaluación cosmética: el informe se arma en el teléfono (public/evaluation.js) y acá solo se GUARDA,
 * cuando la persona marca la casilla para enviar su resumen a la profesional (consentimiento aparte del de contacto).
 *
 *  - Nunca llega la foto: si viene una imagen, se rechaza.
 *  - Se guarda solo texto acotado de categorías conocidas, más números de la foto para calibrar.
 *  - Nada de esto va a los logs ni a la analítica: el evento registra solo que hubo un envío.
 *  - Solo mayores de 18, con la solicitud de contacto ya creada (token).
 */

var REPORT_VERSION_PREFIX = 'v4-';
var REPORT_CATEGORIES = ['brillo', 'poros', 'textura', 'puntos_oscuros', 'puntos_claros', 'enrojecimiento', 'tono', 'descamacion'];
var REPORT_STATUS = ['observado', 'no_observado', 'no_evaluable'];
// Números medidos en el teléfono (se guardan redondeados, para calibrar los umbrales provisorios).
var PHOTO_METRICS = ['shineT', 'shineC', 'redDiff', 'texture', 'toneCv', 'noseSpots', 'noseBlobs'];

function handleSaveReport_(cfg, body) {
  if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
  if (body.adult !== true || body.share !== true) return fail_('consent_required');
  if (body.image || body.photo) return fail_('invalid_request'); // la imagen nunca debe salir del teléfono
  var report = cleanReport_(body.report);
  if (!report) return fail_('invalid_request');
  var metrics = report.photo === 'analizada' ? cleanMetrics_(body.metrics) : null;
  var contact = readContact_(cfg, String(body.requestId));
  if (!contact) return fail_('invalid_token');
  appendAnalysis_(cfg, contact, report, metrics);
  logEvent_(cfg, body.requestId, 'resumen_enviado', { foto: report.photo, version: report.version }); // sin contenido
  return { ok: true, status: 'saved' };
}

function shortText_(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max || 300) : ''; }
function textList_(v, maxItems) { return (Array.isArray(v) ? v : []).map(function (x) { return shortText_(x); }).filter(String).slice(0, maxItems || 12); }

/** Estructura cerrada: lo que no se reconoce se descarta. Devuelve null si falta lo esencial. */
function cleanReport_(r) {
  if (!r || typeof r !== 'object') return null;
  var version = shortText_(r.version, 20);
  if (version.indexOf(REPORT_VERSION_PREFIX) !== 0) return null;
  var photo = r.photo === 'analizada' ? 'analizada' : r.photo === 'sin_foto' ? 'sin_foto' : null;
  if (!photo) return null;
  var seen = {};
  var observations = (Array.isArray(r.observations) ? r.observations : []).filter(function (o) {
    if (!o || REPORT_CATEGORIES.indexOf(o.category) < 0 || REPORT_STATUS.indexOf(o.status) < 0 || seen[o.category]) return false;
    seen[o.category] = true; return true;
  }).map(function (o) { return { category: o.category, status: o.status, text: shortText_(o.text) }; });
  return {
    version: version, photo: photo,
    tendency: shortText_(r.tendency, 80) || 'sin orientar',
    observations: photo === 'analizada' ? observations : [],
    declared: textList_(r.declared),
    orientations: textList_(r.orientations, 8),
    preReview: textList_(r.preReview, 8)
  };
}

function cleanMetrics_(m) {
  if (!m || typeof m !== 'object') return null;
  var out = {}, any = false;
  PHOTO_METRICS.forEach(function (k) {
    var v = m[k];
    if (v === null || v === undefined || v === '') return;
    v = Number(v);
    if (isFinite(v) && Math.abs(v) < 1000) { out[k] = Math.round(v * 1000) / 1000; any = true; }
  });
  return any ? out : null;
}
