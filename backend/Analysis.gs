/**
 * Orientación de la piel: cuestionario (siempre) + foto opcional descrita por IA.
 *
 * Principios:
 *  - Orientación COSMÉTICA, no diagnóstico. No se nombran enfermedades ni se deriva: lo complejo
 *    queda para evaluar en la consulta. No se recomiendan productos ni técnicas.
 *  - El tipo de piel sale del cuestionario (Orientation.gs). La IA solo describe lo visible en la foto.
 *    Es un modelo general, NO validado para piel: la landing lo dice ("orientativo y analizado por IA").
 *  - La foto viaja al proveedor de IA solo con consentimiento específico y NO se guarda
 *    (ni Sheets, ni Drive, ni logs). Las respuestas del cuestionario tampoco se guardan:
 *    en la planilla queda solo el resultado y lo que hay que evaluar en la consulta.
 *  - Solo mayores de 18. Primero se guardan los datos de contacto (lead) para vincularlo con la reserva.
 *
 * La foto requiere AI_ENABLED=true y el secreto ANTHROPIC_API_KEY en Propiedades del script.
 */

// Lo que la IA puede informar de la foto: categorías cosméticas descriptivas y cerradas.
var PHOTO_CATEGORIES = ['brillo_zona_t', 'brillo_general', 'poros_visibles', 'puntos_negros_aparentes', 'textura_irregular',
                        'zonas_secas_aparentes', 'enrojecimiento_visible', 'tono_desparejo', 'zona_para_evaluar'];
var PHOTO_AREAS = { frente: 'Frente', nariz: 'Nariz', mejillas: 'Mejillas', menton: 'Mentón', zona_t: 'Zona T', general: 'Rostro' };

// Términos diagnósticos o promesas que no deben aparecer en el texto que ve la persona.
var BLOCKED_TERMS_ = /\b(acn[eé]|ros[aá]cea|melasma|dermatitis|psoriasis|eczema|ecz[eé]ma|c[aá]ncer|carcinoma|melanoma|tumor|infecci[oó]n|hongo|herpes|vitiligo|vit[ií]ligo|queratosis|lupus|milium|diagn[oó]stic|patolog|enfermedad|sindrome|s[ií]ndrome|cura|curar|garantiz|eliminar? (las )?manchas|rejuvenec|cerrar? (los )?poros|m[eé]dico|dermat[oó]log)/i;

var AI_SYSTEM_PROMPT = [
  'Sos un asistente de orientación cosmética de Clínica Centenario (Montevideo, Uruguay). Una persona subió una foto de su rostro antes de reservar una limpieza facial profunda con una licenciada en cosmetología.',
  'Tu única tarea es describir características cosméticas claramente visibles en la foto. No definís el tipo de piel: eso sale de un cuestionario aparte.',
  'Escribí en español rioplatense, cercano y profesional, con voseo.',
  '',
  'Reglas obligatorias:',
  '1. No diagnosticás. No nombres enfermedades, condiciones médicas ni lesiones (por ejemplo acné, rosácea, melasma, dermatitis, infecciones, milium, lunares). Usá solo términos cosméticos y neutros.',
  '2. Informá una observación solo si es claramente visible. Si dudás, no la incluyas: es mejor no informar que inventar. No hace falta llegar a ninguna cantidad.',
  '3. Usá solo estas categorías: brillo_zona_t, brillo_general, poros_visibles, puntos_negros_aparentes, textura_irregular, zonas_secas_aparentes, enrojecimiento_visible, tono_desparejo, zona_para_evaluar.',
  '4. Usá zona_para_evaluar, con un texto neutro y sin nombrar ninguna condición, si ves lesiones, granos muy inflamados, heridas, manchas o lunares irregulares, o irritación fuerte. Ese texto solo dice que conviene que la profesional lo mire en persona.',
  '5. Lenguaje prudente ("se observa", "parece"). Nada de porcentajes, puntajes, edad de la piel ni grados.',
  '6. No prometas resultados. No recomiendes productos, técnicas ni tratamientos.',
  '7. No comentes edad, atractivo, peso, rasgos, etnia, género ni emociones. No identifiques a la persona.',
  '8. Si la persona parece menor de 18 años, devolvé status "not_allowed".',
  '9. Si no hay un rostro claro, hay más de una persona, la foto está oscura, borrosa, lejos, con filtros o mucho maquillaje evidentes, devolvé status "retry" con un retry_reason corto y amable que diga qué mejorar.',
  '10. photo_limits: una frase corta sobre lo que la foto no permite ver bien (luz, ángulo, cámara), o vacío.',
  '11. Cada texto de observación tiene hasta 20 palabras.'
].join('\n');

// Salida estructurada (output_config.format): todos los objetos con additionalProperties:false y required.
var AI_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'retry_reason', 'observations', 'photo_limits'],
  properties: {
    status: { type: 'string', enum: ['ok', 'retry', 'not_allowed'] },
    retry_reason: { type: 'string' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'area', 'text'],
        properties: {
          category: { type: 'string', enum: PHOTO_CATEGORIES },
          area: { type: 'string', enum: Object.keys(PHOTO_AREAS) },
          text: { type: 'string' }
        }
      }
    },
    photo_limits: { type: 'string' }
  }
};

var QUIZ_ONLY_ERRORS_ = ['ai_not_configured', 'rate_limited', 'ai_error'];

function handleAnalyze_(cfg, body) {
  if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
  if (body.adult !== true) return fail_('consent_required');
  var answers = cleanAnswers_(body.answers);

  var obs = [], photoState = 'sin_foto', photoLimits = '', photoError = '';
  if (body.image) {
    var ph = analyzePhoto_(cfg, body);
    if (ph.status === 'retry' || ph.status === 'not_allowed') { ph.ok = true; return ph; } // la persona repite la foto o sigue sin ella
    if (ph.ok === false) {
      // Si la foto no se pudo analizar, la orientación sale igual con el cuestionario.
      if (QUIZ_ONLY_ERRORS_.indexOf(ph.code) < 0) return ph;
      photoState = 'no_disponible'; photoError = ph.code;
    } else {
      obs = ph.observations; photoLimits = ph.photo_limits; photoState = 'analizada';
    }
  }

  var result = buildOrientation_(answers, obs, photoState);
  result.photoLimits = photoLimits;
  result.photoError = photoError;
  logEvent_(cfg, body.requestId, 'analisis_piel', { foto: photoState, reglas: result.rulesVersion }); // sin respuestas ni resultado
  try {
    var contact = readContact_(cfg, String(body.requestId));
    if (contact) appendAnalysis_(cfg, contact, result);
  } catch (e) { console.warn('No se pudo guardar el análisis: ' + shortErr_(e)); }
  result.ok = true;
  result.status = 'ok';
  return result;
}

/** Valida consentimiento, topes e imagen, y pide la descripción a la IA. */
function analyzePhoto_(cfg, body) {
  var key = getSecret_('ANTHROPIC_API_KEY');
  if (!cfg.AI_ENABLED || !key) return fail_('ai_not_configured');
  if (body.photoConsent !== true) return fail_('consent_required');
  if (!verifyTurnstile_(body.turnstileToken)) return fail_('captcha_failed');
  var img = validateImage_(body.image, body.mediaType);
  if (!img) return fail_('invalid_image');

  // Control de costo y abuso (no hay IP en Apps Script): tope global y por dispositivo.
  if (rateLimited_('ai:global:h', cfg.AI_MAX_PER_HOUR, 3600)) return fail_('rate_limited');
  if (rateLimited_('ai:global:d', cfg.AI_MAX_PER_DAY, 86400)) return fail_('rate_limited');
  var client = String(body.clientId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (client && rateLimited_('ai:c:' + client, cfg.AI_MAX_PER_CLIENT_DAY, 86400)) return fail_('rate_limited');

  var resp;
  try { resp = callVisionModel_(cfg, key, img); }
  catch (e) { console.warn('IA: ' + shortErr_(e)); return fail_('ai_error'); }
  return sanitizeAnalysis_(resp) || fail_('ai_error');
}

/** Acepta JPEG/PNG/WebP en base64, hasta 2,5 MB decodificados. */
function validateImage_(b64, mediaType) {
  var mt = String(mediaType || '');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mt) < 0) return null;
  var data = String(b64 || '').replace(/^data:[^,]+,/, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(data) || data.length < 2000) return null;
  if (data.length * 0.75 > 2.5 * 1024 * 1024) return null;
  return { data: data, mediaType: mt };
}

/**
 * Messages API por HTTP (Apps Script no tiene SDK oficial).
 * Salida estructurada con output_config.format (el modelo actual no admite tool_choice forzado),
 * y fallbacks "default": si el clasificador de seguridad rechaza, el servidor reintenta con otro modelo.
 */
function callVisionModel_(cfg, key, img) {
  var payload = {
    model: cfg.AI_MODEL,
    max_tokens: 16000,
    system: AI_SYSTEM_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_OUTPUT_SCHEMA } },
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: 'Describí lo claramente visible en esta foto siguiendo las reglas.' }
      ]
    }]
  };
  var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(payload)
  });
  var code = r.getResponseCode ? r.getResponseCode() : 200;
  if (code >= 300) throw new Error('HTTP ' + code);
  var json = JSON.parse(r.getContentText());
  if (json.stop_reason === 'refusal') throw new Error('rechazo del clasificador de seguridad');
  if (json.stop_reason === 'max_tokens') throw new Error('respuesta incompleta');
  var text = (json.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  if (!text) throw new Error('sin respuesta estructurada');
  return JSON.parse(text);
}

/** Normaliza y filtra lo que devuelve el modelo antes de usarlo. */
function sanitizeAnalysis_(r) {
  if (!r || typeof r !== 'object') return null;
  var clean = function (s, max) { return cleanText_(s, max || 220); };
  var ok = function (s) { return s && !BLOCKED_TERMS_.test(s) && !/\d+\s*%/.test(s); };
  var status = ['ok', 'retry', 'not_allowed'].indexOf(r.status) >= 0 ? r.status : null;
  if (!status) return null;
  if (status === 'not_allowed') return { status: 'not_allowed' };
  if (status === 'retry') {
    var why = clean(r.retry_reason, 200);
    return { status: 'retry', retry_reason: ok(why) ? why : 'Probá con una foto de frente, con luz pareja, sin filtros ni maquillaje.' };
  }
  var seen = {};
  var observations = (Array.isArray(r.observations) ? r.observations : []).map(function (o) {
    o = o || {};
    return { category: o.category, area: o.area, areaLabel: PHOTO_AREAS[o.area] || '', text: clean(o.text, 160) };
  }).filter(function (o) {
    var k = o.category + '|' + o.area;
    if (PHOTO_CATEGORIES.indexOf(o.category) < 0 || !ok(o.text) || seen[k]) return false;
    seen[k] = true; return true;
  }).slice(0, 6);
  var limits = clean(r.photo_limits, 200);
  return { status: 'ok', observations: observations, photo_limits: ok(limits) ? limits : '' };
}
