/**
 * Análisis orientativo de la piel a partir de una foto (IA de visión).
 *
 * Principios:
 *  - Orientación COSMÉTICA, no diagnóstico. No se nombran enfermedades.
 *  - La foto NO se guarda en ningún lado (ni Sheets, ni Drive, ni logs). Solo se envía al proveedor de IA para responder.
 *  - Solo mayores de 18 con consentimiento explícito.
 *  - Primero se guardan los datos de contacto (lead): el resultado queda en la pestaña "Análisis de piel"
 *    vinculado a esa solicitud, y si después reserva no se le vuelven a pedir los datos.
 *  - Si se observa algo que amerita consulta médica, se recomienda consultar, sin nombrar la condición.
 *
 * Requiere: AI_ENABLED=true y el secreto ANTHROPIC_API_KEY en Propiedades del script.
 */

var AI_TOOL_NAME = 'reportar_analisis';

// Lo que la sesión puede trabajar (solo técnicas del protocolo confirmado; sin peeling químico).
var SESSION_FOCUS_KEYS = ['higiene', 'exfoliacion_manual', 'punta_diamante', 'extraccion', 'mascara_descongestiva', 'activos', 'led', 'hidratacion', 'rutina_casa'];
var SKIN_TYPES = ['seca', 'grasa', 'mixta', 'normal', 'indeterminado'];

// Términos diagnósticos que no deben aparecer en el texto que ve la persona.
var BLOCKED_TERMS_ = /\b(acn[eé]|ros[aá]cea|melasma|dermatitis|psoriasis|eczema|ecz[eé]ma|c[aá]ncer|carcinoma|melanoma|tumor|infecci[oó]n|hongo|herpes|vitiligo|vit[ií]ligo|queratosis|lupus|diagn[oó]stic|patolog|enfermedad|sindrome|s[ií]ndrome|cura|curar|garantiz|eliminar? (las )?manchas|rejuvenec|cerrar? (los )?poros)/i;

var AI_SYSTEM_PROMPT = [
  'Sos un asistente de orientación cosmética de Clínica Centenario (Montevideo, Uruguay). Una persona subió una foto de su rostro para recibir una orientación general antes de reservar una limpieza facial profunda personalizada con una licenciada.',
  'Respondé SIEMPRE llamando a la herramienta reportar_analisis. Escribí en español rioplatense, cercano y profesional, con voseo ("tu piel", "podés").',
  '',
  'Reglas obligatorias:',
  '1. No diagnosticás. No nombres enfermedades ni condiciones médicas (por ejemplo acné, rosácea, melasma, dermatitis, infecciones, lunares sospechosos). Describí solo lo que se ve en términos cosméticos y neutros: brillo, poros visibles, puntos negros aparentes, zonas con textura irregular, zonas con aspecto seco o tirante, enrojecimiento visible, falta de luminosidad.',
  '2. Si ves algo que conviene que revise un médico (lesiones, granos muy inflamados o extendidos, manchas o lunares irregulares, heridas, signos de irritación fuerte), poné see_doctor=true y explicá en see_doctor_reason, sin nombrar ninguna condición, que conviene una consulta médica antes de un tratamiento estético.',
  '3. Usá lenguaje prudente: "se observa", "parece", "podría". La foto tiene límites (luz, cámara, maquillaje, filtros): la confianza nunca es alta.',
  '4. No prometas resultados ni hables de curar, eliminar manchas, cerrar poros ni rejuvenecer.',
  '5. No comentes edad, atractivo, peso, rasgos, etnia ni género. No identifiques a la persona.',
  '6. Si la persona parece menor de 18 años, devolvé status="not_allowed".',
  '7. Si no hay un rostro claro, hay más de una persona, la foto está muy oscura, borrosa, lejos, con filtros evidentes o mucho maquillaje, devolvé status="retry" y un retry_reason corto y amable con qué mejorar.',
  '8. session_focus solo puede contener claves de la lista permitida, y siempre son sugerencias que la profesional confirma en la evaluación. No existe peeling químico en este tratamiento.',
  '9. home_tips: consejos generales y seguros (limpieza suave, hidratación, protector solar). Nada de medicamentos ni productos de marca.',
  '10. Sé breve: summary de 1 o 2 oraciones; cada observación de hasta 20 palabras.'
].join('\n');

var AI_TOOL_SCHEMA = {
  name: AI_TOOL_NAME,
  description: 'Devuelve la orientación cosmética estructurada para mostrar a la persona.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'retry', 'not_allowed'] },
      retry_reason: { type: 'string', description: 'Solo si status=retry: qué mejorar en la foto.' },
      skin_type: { type: 'string', enum: SKIN_TYPES },
      skin_type_confidence: { type: 'string', enum: ['baja', 'media'] },
      summary: { type: 'string', description: '1 o 2 oraciones, tono prudente.' },
      observations: {
        type: 'array', maxItems: 4,
        items: { type: 'object', properties: { area: { type: 'string' }, text: { type: 'string' } }, required: ['area', 'text'] }
      },
      session_focus: { type: 'array', maxItems: 3, items: { type: 'string', enum: SESSION_FOCUS_KEYS } },
      home_tips: { type: 'array', maxItems: 3, items: { type: 'string' } },
      see_doctor: { type: 'boolean' },
      see_doctor_reason: { type: 'string' }
    },
    required: ['status']
  }
};

function handleAnalyze_(cfg, body) {
  var key = getSecret_('ANTHROPIC_API_KEY');
  if (!cfg.AI_ENABLED || !key) return fail_('ai_not_configured');
  if (!checkLeadToken_(body.requestId, body.token)) return fail_('invalid_token');
  if (body.consent !== true || body.adult !== true) return fail_('consent_required');
  if (!verifyTurnstile_(body.turnstileToken)) return fail_('captcha_failed');

  // Control de costo y abuso (no hay IP en Apps Script): tope global y por dispositivo.
  if (rateLimited_('ai:global:h', cfg.AI_MAX_PER_HOUR, 3600)) return fail_('rate_limited');
  if (rateLimited_('ai:global:d', cfg.AI_MAX_PER_DAY, 86400)) return fail_('rate_limited');
  var client = String(body.clientId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (client && rateLimited_('ai:c:' + client, cfg.AI_MAX_PER_CLIENT_DAY, 86400)) return fail_('rate_limited');

  var img = validateImage_(body.image, body.mediaType);
  if (!img) return fail_('invalid_image');

  var resp;
  try { resp = callVisionModel_(cfg, key, img); }
  catch (e) { console.warn('IA: ' + shortErr_(e)); return fail_('ai_error'); }

  var result = sanitizeAnalysis_(resp);
  if (!result) return fail_('ai_error');
  logEvent_(cfg, body.requestId, 'analisis_piel', { status: result.status }); // sin resultado ni datos de la persona
  if (result.status === 'ok') {
    try {
      var contact = readContact_(cfg, String(body.requestId));
      if (contact) appendAnalysis_(cfg, contact, result);
    } catch (e) { console.warn('No se pudo guardar el análisis: ' + shortErr_(e)); }
  }
  result.ok = true;
  return result;
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

function callVisionModel_(cfg, key, img) {
  var payload = {
    model: cfg.AI_MODEL,
    max_tokens: 1200,
    system: AI_SYSTEM_PROMPT,
    tools: [AI_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: AI_TOOL_NAME },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: 'Analizá esta foto siguiendo las reglas y respondé con la herramienta.' }
      ]
    }]
  };
  var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload)
  });
  var code = r.getResponseCode ? r.getResponseCode() : 200;
  if (code >= 300) throw new Error('HTTP ' + code);
  var json = JSON.parse(r.getContentText());
  var block = (json.content || []).filter(function (c) { return c.type === 'tool_use' && c.name === AI_TOOL_NAME; })[0];
  if (!block) throw new Error('sin respuesta estructurada');
  return block.input;
}

/** Normaliza y filtra lo que devuelve el modelo antes de mostrarlo. */
function sanitizeAnalysis_(r) {
  if (!r || typeof r !== 'object') return null;
  var clean = function (s, max) { return cleanText_(s, max || 220); };
  var ok = function (s) { return s && !BLOCKED_TERMS_.test(s); };
  var status = ['ok', 'retry', 'not_allowed'].indexOf(r.status) >= 0 ? r.status : null;
  if (!status) return null;
  if (status === 'not_allowed') return { status: 'not_allowed' };
  if (status === 'retry') {
    var why = clean(r.retry_reason, 200);
    return { status: 'retry', retry_reason: ok(why) ? why : 'Probá con una foto de frente, con buena luz natural, sin filtros ni maquillaje.' };
  }
  var summary = clean(r.summary, 300);
  var out = {
    status: 'ok',
    skin_type: SKIN_TYPES.indexOf(r.skin_type) >= 0 ? r.skin_type : 'indeterminado',
    skin_type_confidence: r.skin_type_confidence === 'media' ? 'media' : 'baja',
    summary: ok(summary) ? summary : '',
    observations: (Array.isArray(r.observations) ? r.observations : []).slice(0, 4).map(function (o) {
      return { area: clean(o && o.area, 40), text: clean(o && o.text, 180) };
    }).filter(function (o) { return o.text && ok(o.text) && ok(o.area); }),
    session_focus: (Array.isArray(r.session_focus) ? r.session_focus : []).filter(function (k, i, a) {
      return SESSION_FOCUS_KEYS.indexOf(k) >= 0 && a.indexOf(k) === i;
    }).slice(0, 3),
    home_tips: (Array.isArray(r.home_tips) ? r.home_tips : []).slice(0, 3).map(function (t) { return clean(t, 160); }).filter(ok),
    see_doctor: r.see_doctor === true,
    see_doctor_reason: ''
  };
  if (out.see_doctor) {
    var reason = clean(r.see_doctor_reason, 220);
    out.see_doctor_reason = ok(reason) ? reason : 'Observamos algo que conviene que revise un médico antes de hacer un tratamiento estético.';
  }
  return out;
}
