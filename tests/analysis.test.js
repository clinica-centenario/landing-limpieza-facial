const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const LEAD = { action: 'lead', firstName: 'Ana', lastName: 'Pérez', phone: '099 123 456', email: 'ana@example.com', consent: true, elapsedMs: 9000, origin: 'analisis' };
// Sin foto se suma la pregunta del brillo; con foto, el brillo lo mide el teléfono.
const QUIZ = { brillo: 'zona_t', sequedad: 'aveces', reactividad: 'aveces', mejorar: ['puntos_negros', 'poros'], aplica: ['ninguna'] };
const QUIZ_PHOTO = { sequedad: 'aveces', reactividad: 'aveces', mejorar: ['puntos_negros', 'suavidad'], aplica: ['ninguna'] };
const PHOTO = { findings: ['brillo_zona_t', 'textura_irregular'],
  metrics: { fotos: 3, brilloZonaT: 0.081, brilloMejillas: 0.012, rojezDif: 0.01, texturaMejillas: 8.4, tonoMejillas: 0.05, puntosNariz: 1.2, porosMejillas: 3 } };

function env0() {
  const env = createEnv();
  env.sent = [];
  env.ctx.UrlFetchApp.fetch = (url) => { env.sent.push(url); return { getContentText: () => '{}' }; };
  const l = env.post(LEAD);
  env.lead = l;
  env.analyze = (extra = {}) => env.post({ action: 'analyze', requestId: l.requestId, token: l.token, adult: true, answers: QUIZ, ...extra });
  return env;
}
const rows = (env) => { const r = env.state.sheets['Análisis de piel']; return r.slice(1).map(x => Object.fromEntries(r[0].map((k, i) => [k, x[i]]))); };
const dump = (env) => JSON.stringify(env.state.sheets) + JSON.stringify(env.state.props) + JSON.stringify(env.state.cache) + env.state.logs.join();

test('sin fotos: perfil, necesidades y beneficios con su origen; no guarda respuestas', () => {
  const env = env0();
  const r = env.analyze();
  assert.equal(r.ok, true); assert.equal(r.photo, 'sin_foto'); assert.equal(r.photoLimits, '');
  assert.equal(r.profile.type, 'Mixta'); assert.equal(r.profile.origin, 'cuestionario'); assert.equal(r.profile.warning, '');
  assert.ok(r.needs.some(n => n.rule === 'NEC-SENS-2') && r.needs.some(n => n.rule === 'NEC-HID-1'));
  assert.deepEqual(r.benefits.map(b => b.rule).sort(), ['BEN-BRI', 'BEN-PN', 'BEN-POR']);
  assert.ok(r.benefits.every(b => b.origin === 'cuestionario'));
  assert.ok(r.limits.length === 1 && r.tips.length <= 3 && r.observations.length === 0);
  assert.equal(r.whatsapp, '', 'devuelve el WhatsApp de la planilla (vacío en la prueba)');
  const row = rows(env)[0];
  assert.equal(row['ID solicitud'], env.lead.requestId);
  assert.match(row['Tipo de piel (orientativo)'], /^Mixta \[cuestionario · TIPO-04\]/);
  assert.equal(row['Foto'], 'Sin foto'); assert.equal(row['Versión de reglas'], 'v3-2026-11'); assert.equal(row['Mediciones de la foto'], '');
  assert.ok(!/zona_t"|aveces|"puntos_negros"/.test(dump(env)), 'las respuestas crudas no se guardan');
});

test('con fotos: el brillo medido define el tipo junto con las respuestas', () => {
  const env = env0();
  const r = env.analyze({ answers: QUIZ_PHOTO, photo: PHOTO });
  assert.equal(r.profile.type, 'Mixta'); assert.equal(r.profile.origin, 'foto y cuestionario');
  const oily = env.analyze({ answers: { ...QUIZ, sequedad: 'no' }, photo: { findings: ['brillo_general'], metrics: {} } });
  assert.equal(oily.profile.type, 'Grasa', 'con foto, el brillo medido manda sobre la pregunta');
  const none = env.analyze({ answers: { ...QUIZ_PHOTO, sequedad: 'no' }, photo: { findings: [], metrics: {} } });
  assert.equal(none.profile.type, 'Normal'); assert.match(none.profile.warning, /no se midió brillo/);
  const mixed = env.analyze({ answers: { ...QUIZ_PHOTO, sequedad: 'siempre' }, photo: { findings: ['brillo_general'], metrics: {} } });
  assert.equal(mixed.profile.type, 'Mixta'); assert.equal(mixed.profile.rule, 'TIPO-02'); assert.match(mixed.profile.warning, /no son del todo coincidentes/);
});

test('con fotos: textos fijos por indicador, origen de cada beneficio y números para calibrar', () => {
  const env = env0();
  const r = env.analyze({ answers: QUIZ_PHOTO, photo: PHOTO });
  assert.equal(r.photo, 'analizada'); assert.match(r.photoLimits, /mediciones de tus fotos/);
  assert.deepEqual(r.observations.map(o => o.rule), ['OBS-brillo_zona_t', 'OBS-textura_irregular']);
  assert.ok(r.observations.every(o => o.origin === 'foto' && !o.beta));
  assert.equal(r.benefits.find(b => b.rule === 'BEN-BRI').origin, 'foto');
  assert.equal(r.benefits.find(b => b.rule === 'BEN-TEX').origin, 'foto y cuestionario');
  assert.equal(r.benefits.find(b => b.rule === 'BEN-PN').origin, 'cuestionario', 'puntos negros: lo marcó la persona');
  assert.equal(r.photoMetrics, undefined, 'los números no vuelven al navegador');
  const row = rows(env)[0];
  assert.equal(row['Foto'], 'Medida en el teléfono (no enviada ni guardada)');
  assert.deepEqual(JSON.parse(row['Mediciones de la foto']), PHOTO.metrics);
  assert.match(row['Observaciones de la foto'], /\[foto · OBS-brillo_zona_t\]/);
  assert.equal(env.sent.length, 0, 'no se llama a ningún servicio externo');
});

test('puntos negros y poros: análisis en prueba, marcados como tales', () => {
  const env = env0();
  const r = env.analyze({ answers: QUIZ_PHOTO, photo: { findings: ['puntos_negros_posibles', 'poros_visibles_posibles'], metrics: {} } });
  assert.ok(r.observations.length === 2 && r.observations.every(o => o.beta === true));
  assert.equal(r.benefits.find(b => b.rule === 'BEN-PN').origin, 'foto y cuestionario');
  assert.equal(r.benefits.find(b => b.rule === 'BEN-POR').origin, 'foto');
  assert.ok(r.toEvaluate.some(e => e.rule === 'EVA-BETA'));
});

test('foto: descarta categorías desconocidas, números raros y una imagen enviada por error', () => {
  const env = env0();
  const r = env.analyze({ photo: { findings: ['grado_acne', 'brillo_general', 'brillo_zona_t', 'brillo_general'], metrics: { brilloZonaT: 'x', rojezDif: 5e9, otro: 3 } } });
  assert.deepEqual(r.observations.map(o => o.rule), ['OBS-brillo_general'], 'brillo general reemplaza a zona T');
  assert.equal(rows(env)[0]['Mediciones de la foto'], '{}');
  assert.equal(env.analyze({ image: 'A'.repeat(4000) }).code, 'invalid_request', 'la imagen nunca debe llegar al servidor');
});

test('respuestas: máximo 2 cosas para mejorar y "Ninguna" excluye al resto', () => {
  const env = env0();
  const many = env.analyze({ answers: { ...QUIZ, mejorar: ['poros', 'brillo', 'suavidad'] } });
  assert.ok(!many.benefits.some(b => b.rule === 'BEN-TEX'), 'la tercera opción se descarta');
  const bad = env.analyze({ answers: { brillo: 'mucho', mejorar: ['cicatrices'], aplica: ['ninguna', 'exfoliantes'] } });
  assert.ok(!bad.toEvaluate.some(e => e.rule === 'EVA-EXF'));
});

test('respuestas incompletas o "No sé": no se inventa un perfil', () => {
  const env = env0();
  const r = env.analyze({ answers: { aplica: ['ninguna'] } });
  assert.equal(r.profile.type, 'Indeterminada'); assert.ok(r.profile.warning);
  assert.equal(r.needs.length, 0, 'sin datos no se afirma ausencia ni presencia');
  assert.deepEqual(r.benefits.map(b => b.rule), ['BEN-LIMP']);
});

test('lesiones, retinoides o procedimientos: quedan para evaluar en la consulta, sin derivar ni nombrar condiciones', () => {
  const env = env0();
  const r = env.analyze({ answers: { ...QUIZ, aplica: ['lesiones', 'exfoliantes', 'procedimiento'], reactividad: 'seguido' } });
  assert.deepEqual(r.toEvaluate.map(e => e.rule), ['EVA-LES', 'EVA-SENS', 'EVA-EXF', 'EVA-PROC']);
  assert.ok(!/\bm[eé]dic[oa]s?\b|dermat[oó]log|deriv/i.test(JSON.stringify(r)), 'no deriva ni nombra especialidades');
  assert.ok(r.tips.some(t => t.rule === 'TIP-SENS'));
});

test('enrojecimiento medido en la foto: se adapta a la tolerancia, sin nombrar condiciones', () => {
  const env = env0();
  const r = env.analyze({ answers: { ...QUIZ_PHOTO, reactividad: 'no' }, photo: { findings: ['enrojecimiento_visible'], metrics: {} } });
  assert.equal(r.toEvaluate.find(e => e.rule === 'EVA-SENS').origin, 'foto');
});

test('requisitos: mayoría de edad y datos de contacto guardados', () => {
  const env = env0();
  assert.equal(env.analyze({ adult: false }).code, 'consent_required');
  assert.equal(env.post({ action: 'analyze', adult: true, answers: QUIZ }).code, 'invalid_token');
  assert.equal(env.analyze({ token: 'otro' }).code, 'invalid_token');
});

test('la misma solicitud reserva sin volver a cargar datos y el análisis queda "Reservó = Sí"', () => {
  const env = env0();
  assert.equal(env.analyze().ok, true);
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const start = new Date(d.toISOString().slice(0, 10) + 'T14:00:00-03:00').toISOString();
  const r = env.post({ action: 'book', requestId: env.lead.requestId, token: env.lead.token, start, idempotencyKey: 'idem_analisis_000001' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rows(env)[0]['Reservó'], 'Sí');
});

test('elementos puntuales (en prueba): granos, milium, lunares y manchas con su conteo y su lugar en el resultado', () => {
  const env = env0();
  const r = env.analyze({ answers: QUIZ_PHOTO, photo: { findings: ['granos_posibles', 'milium_posible', 'lunares_visibles', 'manchas_posibles', 'puntos_negros_posibles'],
    metrics: { granos: 2, milium: 1, lunares: 3, manchas: 1, puntosNegros: 5 } } });
  const t = Object.fromEntries(r.observations.map(o => [o.rule, o.text]));
  assert.equal(t['OBS-granos_posibles'], 'Posibles granos o zonas inflamadas (2).');
  assert.equal(t['OBS-lunares_visibles'], 'Lunares visibles (3).');
  assert.equal(t['OBS-puntos_negros_posibles'], 'Posibles puntos negros en la nariz (5).');
  assert.ok(r.observations.every(o => o.beta && o.origin === 'foto'));
  assert.ok(r.benefits.some(b => b.rule === 'BEN-MIL'));
  assert.ok(r.limits.some(l => l.rule === 'LIM-MAN'), 'la limpieza no quita manchas');
  assert.ok(r.toEvaluate.some(e => e.rule === 'EVA-GRA') && r.toEvaluate.some(e => e.rule === 'EVA-LUN'));
  assert.ok(!/\bm[eé]dic[oa]s?\b|melanoma|acn[eé]|c[aá]ncer/i.test(JSON.stringify(r)), 'sin nombrar condiciones ni derivar');
  assert.deepEqual(JSON.parse(rows(env)[0]['Mediciones de la foto']), { granos: 2, milium: 1, lunares: 3, manchas: 1, puntosNegros: 5 });
});
