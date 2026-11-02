/**
 * Orientación de la piel: cuestionario (siempre) + indicadores medidos en la foto (opcional).
 *
 * Principios:
 *  - Orientación COSMÉTICA, no diagnóstico. No se nombran enfermedades ni se deriva: lo complejo
 *    queda para evaluar en la consulta. No se recomiendan productos ni técnicas.
 *  - El tipo de piel sale del cuestionario (Orientation.gs).
 *  - La foto se analiza SOLO en el teléfono (MediaPipe Face Landmarker, Apache-2.0). Acá nunca llega
 *    la imagen: solo las categorías encontradas y los números medidos, que se guardan para calibrar.
 *  - Las respuestas del cuestionario no se guardan: en la planilla queda el resultado con su fundamento.
 *  - Solo mayores de 18. Primero se guardan los datos de contacto (lead) para vincularlo con la reserva.
 */

// Lo que el teléfono puede informar de la foto: categorías cerradas.
var PHOTO_FINDINGS = ['brillo_zona_t', 'brillo_general', 'textura_irregular', 'tono_desparejo', 'enrojecimiento_visible'];
// Números medidos en el teléfono (se guardan redondeados, para calibrar los umbrales).
var PHOTO_METRICS = ['brilloZonaT', 'brilloMejillas', 'rojezDif', 'texturaMejillas', 'tonoMejillas'];

function handleAnalyze_(cfg, body) {
  if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
  if (body.adult !== true) return fail_('consent_required');
  if (body.image) return fail_('invalid_request'); // la imagen nunca debe salir del teléfono
  var answers = cleanAnswers_(body.answers);
  var photo = cleanPhoto_(body.photo);

  var result = buildOrientation_(answers, photo ? photo.findings : [], photo ? 'analizada' : 'sin_foto');
  result.photoMetrics = photo ? photo.metrics : null;
  logEvent_(cfg, body.requestId, 'analisis_piel', { foto: result.photo, reglas: result.rulesVersion }); // sin respuestas ni resultado
  try {
    var contact = readContact_(cfg, String(body.requestId));
    if (contact) appendAnalysis_(cfg, contact, result);
  } catch (e) { console.warn('No se pudo guardar el análisis: ' + shortErr_(e)); }
  delete result.photoMetrics; // los números quedan en la planilla, no hace falta devolverlos
  result.ok = true;
  result.status = 'ok';
  return result;
}

/** Solo categorías conocidas y números acotados; cualquier otra cosa se descarta. */
function cleanPhoto_(p) {
  if (!p || typeof p !== 'object') return null;
  var findings = (Array.isArray(p.findings) ? p.findings : []).filter(function (f, i, a) {
    return PHOTO_FINDINGS.indexOf(f) >= 0 && a.indexOf(f) === i;
  });
  if (findings.indexOf('brillo_general') >= 0) findings = findings.filter(function (f) { return f !== 'brillo_zona_t'; });
  var metrics = {};
  var m = (p.metrics && typeof p.metrics === 'object') ? p.metrics : {};
  PHOTO_METRICS.forEach(function (k) {
    var v = Number(m[k]);
    if (isFinite(v) && Math.abs(v) < 1000) metrics[k] = Math.round(v * 1000) / 1000;
  });
  return { findings: findings, metrics: metrics };
}
