// Backend: guardado del resumen de la evaluación cosmética (solo con consentimiento aparte).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');
const EV = require('../public/evaluation.js');

const LEAD = { action: 'lead', firstName: 'Ana', lastName: 'Pérez', phone: '099 123 456', email: 'ana@example.com', consent: true, elapsedMs: 9000, origin: 'analisis' };
const ANSWERS = { en_cara: 'nada', brillo_donde: 'zona_t', brillo_cuando: 'rapido', tirantez: 'aveces', descamacion: 'no', reactividad: 'aveces',
  rutina: ['limpiador', 'protector'], objetivo: 'puntos', recientes: ['ninguno'], heridas: 'no', irritacion: 'no', dolor: 'no', sangrado: 'no', cambio: 'no' };
const SQ = [[0, 0], [10, 0], [10, 10], [0, 10]];
const REGIONS = { frente: SQ, nariz: SQ, mejilla_der: SQ, mejilla_izq: SQ };
const MEAS = { shineT: 0.08, shineC: 0.01, redDiff: 0.01, texture: 5, toneCv: 0.03, noseSpots: 5, noseBlobs: 1 };
const QUALITY = { pxPerMm: 4, sideLight: false, occluded: {} };

function env0() {
  const env = createEnv();
  env.ctx.UrlFetchApp.fetch = () => ({ getContentText: () => '{}' });
  env.cells = [];
  env.ctx.sheetSafe_ = ((orig) => (v) => { const r = orig(v); env.cells.push(r); return r; })(env.ctx.sheetSafe_);
  const l = env.post(LEAD);
  env.lead = l;
  const report = EV.buildReport(ANSWERS, { observations: EV.observePhoto(MEAS, QUALITY, REGIONS) });
  env.report = EV.compactReport(report);
  env.save = (extra = {}) => env.post({ action: 'saveReport', requestId: l.requestId, token: l.token, adult: true, share: true, report: env.report, metrics: MEAS, ...extra });
  return env;
}
const rows = (env) => { const r = env.state.sheets['Análisis de piel']; return r.slice(1).map(x => Object.fromEntries(r[0].map((k, i) => [k, x[i]]))); };

test('guarda el resumen en texto, sin la foto, vinculado a la solicitud', () => {
  const env = env0();
  const r = env.save();
  assert.deepEqual(r, { ok: true, status: 'saved' });
  const row = rows(env)[0];
  assert.equal(row['ID solicitud'], env.lead.requestId);
  assert.equal(row['Tipo de piel (orientativo)'], 'Tendencia mixta (moderada) [cuestionario]');
  assert.match(row['Observaciones de la foto'], /brillo: Se observa \(Frente y nariz: En la foto se aprecia más brillo en estas zonas\.\)/);
  assert.match(row['Observaciones de la foto'], /poros: No evaluable/);
  assert.match(row['Necesidades referidas'], /Sensibilidad declarada/);
  assert.match(row['Beneficios posibles'], /comedones aptos para extracción/);
  assert.equal(row['Para evaluar en consulta'], '');
  assert.equal(row['Foto'], 'Analizada en el teléfono (no enviada ni guardada)');
  assert.equal(row['Versión de reglas'], EV.VERSION);
  assert.deepEqual(JSON.parse(row['Mediciones de la foto']), MEAS);
});

test('sin consentimiento para enviar, sin mayoría de edad o sin token: no guarda nada', () => {
  const env = env0();
  assert.equal(env.save({ share: false }).code, 'consent_required');
  assert.equal(env.save({ share: undefined }).code, 'consent_required');
  assert.equal(env.save({ adult: false }).code, 'consent_required');
  assert.equal(env.save({ token: 'otro' }).code, 'invalid_token');
  assert.equal(env.post({ action: 'saveReport', adult: true, share: true, report: env.report }).code, 'invalid_token');
  assert.equal(rows(env).length, 0);
});

test('rechaza imágenes y estructuras desconocidas; descarta categorías y números raros', () => {
  const env = env0();
  assert.equal(env.save({ image: 'A'.repeat(4000) }).code, 'invalid_request', 'la imagen nunca debe llegar al servidor');
  assert.equal(env.save({ photo: { data: 'x' } }).code, 'invalid_request');
  assert.equal(env.save({ report: { version: 'v3-2026-11', photo: 'sin_foto' } }).code, 'invalid_request', 'versión vieja');
  assert.equal(env.save({ report: 'texto' }).code, 'invalid_request');
  const odd = { ...env.report, observations: [{ category: 'acne', status: 'observado', text: 'x' }, { category: 'brillo', status: 'raro' }, { category: 'tono', status: 'observado', text: 'y'.repeat(900) }],
    declared: ['=HYPERLINK("http://x")'] };
  assert.equal(env.save({ report: odd, metrics: { shineT: 'x', redDiff: 5e9, otro: 3, texture: 7.12345 } }).ok, true);
  const row = rows(env)[0];
  assert.match(row['Observaciones de la foto'], /^tono: Se observa \(y{300}\)$/, 'solo categorías conocidas y texto acotado');
  assert.equal(row['Necesidades referidas'], '=HYPERLINK("http://x")', 'llega como texto: el apóstrofo de sheetSafe_ lo consume la planilla');
  assert.deepEqual(JSON.parse(row['Mediciones de la foto']), { texture: 7.123 });
  assert.ok(env.cells.includes('\'=HYPERLINK("http://x")'), 'cada celda pasa por sheetSafe_ (protección de fórmulas)');
});

test('sin foto: no guarda observaciones ni mediciones aunque lleguen', () => {
  const env = env0();
  const noPhoto = EV.compactReport(EV.buildReport(ANSWERS, null));
  assert.equal(env.save({ report: { ...noPhoto, observations: env.report.observations } }).ok, true);
  const row = rows(env)[0];
  assert.equal(row['Foto'], 'Sin foto'); assert.equal(row['Observaciones de la foto'], ''); assert.equal(row['Mediciones de la foto'], '');
});

test('nada del contenido va a los logs ni a los eventos', () => {
  const env = env0();
  env.save();
  const logs = env.state.logs.join(' ') + JSON.stringify(env.state.sheets['Eventos'] || []);
  assert.ok(!/brillo en estas|Sensibilidad|comedones|mixta/.test(logs), logs);
});

test('la misma solicitud reserva sin volver a cargar datos y el resumen queda "Reservó = Sí"', () => {
  const env = env0();
  assert.equal(env.save().ok, true);
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const start = new Date(d.toISOString().slice(0, 10) + 'T14:00:00-03:00').toISOString();
  const r = env.post({ action: 'book', requestId: env.lead.requestId, token: env.lead.token, start, idempotencyKey: 'idem_analisis_000001' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rows(env)[0]['Reservó'], 'Sí');
});

test('la acción vieja "analyze" ya no existe', () => {
  const env = env0();
  assert.equal(env.post({ action: 'analyze', requestId: env.lead.requestId, token: env.lead.token, adult: true, answers: {} }).code, 'invalid_request');
});
