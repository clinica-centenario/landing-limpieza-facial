const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const IMG = 'A'.repeat(40000); // base64 válido (~30 KB)
const LEAD = { action: 'lead', firstName: 'Ana', lastName: 'Pérez', phone: '099 123 456', email: 'ana@example.com', consent: true, elapsedMs: 9000, origin: 'analisis' };
const QUIZ = { brillo: 'zona_t', tirantez: 'aveces', descamacion: 'no', reactividad: 'aveces', imperfecciones: ['puntos_negros', 'poros'],
  objetivo: 'suavidad', exfoliantes: 'no', procedimiento: 'no', lesiones: 'no' };
const PHOTO = { image: IMG, mediaType: 'image/jpeg', photoConsent: true, clientId: 'dev_abc123' };

const GOOD = {
  status: 'ok', retry_reason: '', photo_limits: 'La luz cálida puede alterar el tono.',
  observations: [{ category: 'brillo_zona_t', area: 'zona_t', text: 'Se observa brillo en frente y nariz.' },
                 { category: 'puntos_negros_aparentes', area: 'nariz', text: 'Parecen verse puntos negros en los laterales.' }]
};

function envWith(modelOutput, opts = {}) {
  const env = createEnv({ props: { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test', ...(opts.props || {}) } });
  env.sent = [];
  const l = env.post(LEAD);
  env.lead = l;
  env.analyze = (extra = {}) => env.post({ action: 'analyze', requestId: l.requestId, token: l.token, adult: true, answers: QUIZ, ...extra });
  env.ctx.UrlFetchApp.fetch = (url, o) => {
    env.sent.push({ url, o, body: JSON.parse(o.payload) });
    if (opts.httpError) return { getResponseCode: () => 529, getContentText: () => '{}' };
    const resp = opts.refusal ? { stop_reason: 'refusal', content: [] }
      : { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(modelOutput) }] };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(resp) };
  };
  return env;
}
const rows = (env) => { const r = env.state.sheets['Análisis de piel']; return r.slice(1).map(x => Object.fromEntries(r[0].map((k, i) => [k, x[i]]))); };
const dump = (env) => JSON.stringify(env.state.sheets) + JSON.stringify(env.state.props) + JSON.stringify(env.state.cache) + env.state.logs.join();

test('orientación sin foto: perfil, necesidades y beneficios con su origen; no guarda respuestas', () => {
  const env = envWith(GOOD);
  const r = env.analyze();
  assert.equal(r.ok, true); assert.equal(r.photo, 'sin_foto'); assert.equal(env.sent.length, 0, 'sin foto no se llama a la IA');
  assert.equal(r.profile.type, 'Mixta'); assert.equal(r.profile.origin, 'cuestionario'); assert.equal(r.profile.warning, '');
  assert.ok(r.needs.some(n => n.rule === 'NEC-SENS-2') && r.needs.some(n => n.rule === 'NEC-HID-1'));
  assert.ok(r.needs.every(n => n.origin === 'cuestionario'));
  assert.deepEqual(r.benefits.map(b => b.rule).sort(), ['BEN-BRI', 'BEN-PN', 'BEN-POR', 'BEN-TEX'].sort());
  assert.ok(r.limits.length === 1 && r.tips.length <= 3 && r.observations.length === 0);
  const row = rows(env)[0];
  assert.equal(row['ID solicitud'], env.lead.requestId); assert.match(row['Tipo de piel (orientativo)'], /^Mixta \[cuestionario · TIPO-04\]/);
  assert.match(row['Beneficios posibles'], /\[cuestionario · BEN-PN\]/); assert.equal(row['Foto'], 'Sin foto'); assert.equal(row['Versión de reglas'], 'v1-2026-11');
  assert.ok(!/zona_t|aveces|puntos_negros/.test(dump(env)), 'las respuestas crudas no se guardan');
});

test('respuestas contradictorias: muestra el tipo más probable con aviso', () => {
  const env = envWith(GOOD);
  const r = env.analyze({ answers: { ...QUIZ, brillo: 'toda', tirantez: 'siempre', descamacion: 'si' } });
  assert.equal(r.profile.type, 'Mixta'); assert.equal(r.profile.rule, 'TIPO-02'); assert.match(r.profile.warning, /no son del todo coincidentes/);
  assert.ok(r.toEvaluate.some(e => e.rule === 'EVA-TIPO'));
});

test('respuestas incompletas o "No sé": no se inventa un perfil', () => {
  const env = envWith(GOOD);
  const r = env.analyze({ answers: { lesiones: 'no' } });
  assert.equal(r.profile.type, 'Indeterminada'); assert.ok(r.profile.warning);
  assert.equal(r.needs.length, 0, 'sin datos no se afirma ausencia ni presencia');
  assert.deepEqual(r.benefits.map(b => b.rule), ['BEN-LIMP']);
  const bad = env.analyze({ answers: { brillo: 'mucho', imperfecciones: ['granitos', 'cicatrices'], exfoliantes_cual: 'retinoide' } });
  assert.equal(bad.profile.type, 'Indeterminada'); assert.ok(!bad.toEvaluate.some(e => e.rule === 'EVA-EXF'), 'condicional sin su pregunta madre se descarta');
});

test('lesiones, retinoides o procedimientos: quedan para evaluar en la consulta, sin derivar ni nombrar condiciones', () => {
  const env = envWith(GOOD);
  const r = env.analyze({ answers: { ...QUIZ, lesiones: 'si', exfoliantes: 'si', exfoliantes_cual: 'retinoide', procedimiento: 'si', procedimiento_tipo: 'medico', reactividad: 'seguido' } });
  assert.deepEqual(r.toEvaluate.map(e => e.rule), ['EVA-LES', 'EVA-SENS', 'EVA-EXF', 'EVA-PROC']);
  const all = JSON.stringify(r);
  assert.ok(!/\bm[eé]dic[oa]s?\b|dermat[oó]log|deriv/i.test(all), 'no deriva ni nombra especialidades');
  assert.ok(r.tips.some(t => t.rule === 'TIP-SENS'));
});

test('foto con IA: salida estructurada sin tool_choice, observaciones filtradas y foto no guardada', () => {
  const env = envWith({ ...GOOD, observations: [...GOOD.observations,
    { category: 'enrojecimiento_visible', area: 'mejillas', text: 'Signos de rosácea en mejillas.' },
    { category: 'grado_acne', area: 'general', text: 'Acné grado 2.' },
    { category: 'poros_visibles', area: 'nariz', text: 'Poros visibles en un 60 % de la nariz.' }] });
  const r = env.analyze(PHOTO);
  assert.equal(r.ok, true); assert.equal(r.photo, 'analizada');
  const req = env.sent[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.o.headers['anthropic-version'], '2026-10-21'); assert.equal(req.o.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.fallbacks, 'default'); assert.equal(req.body.tool_choice, undefined); assert.equal(req.body.temperature, undefined);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.deepEqual(r.observations.map(o => o.rule), ['OBS-brillo_zona_t', 'OBS-puntos_negros_aparentes'], 'descarta términos diagnósticos, categorías desconocidas y porcentajes');
  assert.ok(r.observations.every(o => o.origin === 'foto (IA)'));
  assert.equal(r.benefits.find(b => b.rule === 'BEN-PN').origin, 'foto (IA)', 'el beneficio indica que surge de la foto');
  assert.equal(r.profile.origin, 'cuestionario', 'el tipo de piel nunca sale de la foto');
  assert.ok(!dump(env).includes(IMG.slice(0, 200)), 'la foto no queda en planilla, propiedades, caché ni logs');
  assert.equal(rows(env)[0]['Foto'], 'Analizada por IA (no guardada)');
});

test('foto que no sirve: pide repetirla y no guarda nada', () => {
  const env = envWith({ status: 'retry', retry_reason: 'La foto está oscura; probá con luz pareja.', observations: [], photo_limits: '' });
  const r = env.analyze(PHOTO);
  assert.equal(r.ok, true); assert.equal(r.status, 'retry'); assert.match(r.retry_reason, /luz/);
  assert.equal(rows(env).length, 0);
  const minor = envWith({ status: 'not_allowed', retry_reason: '', observations: [], photo_limits: '' }).analyze(PHOTO);
  assert.equal(minor.status, 'not_allowed');
});

test('falla el servicio de imágenes o rechaza: la orientación sale igual con el cuestionario', () => {
  for (const opts of [{ httpError: true }, { refusal: true }, { props: { ANTHROPIC_API_KEY: '' } }]) {
    const env = envWith(GOOD, opts);
    const r = env.analyze(PHOTO);
    assert.equal(r.ok, true, JSON.stringify(opts)); assert.equal(r.photo, 'no_disponible'); assert.equal(r.observations.length, 0);
    assert.equal(r.profile.type, 'Mixta');
  }
});

test('consentimientos: mayoría de edad siempre; consentimiento específico para enviar la foto', () => {
  const env = envWith(GOOD);
  assert.equal(env.analyze({ adult: false }).code, 'consent_required');
  assert.equal(env.analyze({ ...PHOTO, photoConsent: false }).code, 'consent_required');
  assert.equal(env.analyze({ ...PHOTO, mediaType: 'image/gif' }).code, 'invalid_image');
  assert.equal(env.sent.length, 0, 'no se llamó a la IA');
});

test('exige los datos de contacto guardados antes de orientar', () => {
  const env = envWith(GOOD);
  assert.equal(env.post({ action: 'analyze', adult: true, answers: QUIZ }).code, 'invalid_token');
  assert.equal(env.analyze({ token: 'otro' }).code, 'invalid_token');
});

test('topes de uso de la IA por dispositivo: al superarlo sigue la orientación sin foto', () => {
  const env = envWith(GOOD, { props: { AI_MAX_PER_CLIENT_DAY: '1' } });
  assert.equal(env.analyze(PHOTO).photo, 'analizada');
  const r = env.analyze(PHOTO);
  assert.equal(r.photo, 'no_disponible'); assert.equal(r.photoError, 'rate_limited'); assert.equal(env.sent.length, 1);
});

test('la misma solicitud reserva sin volver a cargar datos y el análisis queda "Reservó = Sí"', () => {
  const env = envWith(GOOD);
  assert.equal(env.analyze().ok, true);
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const start = new Date(d.toISOString().slice(0, 10) + 'T14:00:00-03:00').toISOString();
  const r = env.post({ action: 'book', requestId: env.lead.requestId, token: env.lead.token, start, idempotencyKey: 'idem_analisis_000001' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rows(env)[0]['Reservó'], 'Sí');
});
