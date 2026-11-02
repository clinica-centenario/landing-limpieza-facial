const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const IMG = 'A'.repeat(40000); // base64 válido (~30 KB)
const BASE = { action: 'analyze', image: IMG, mediaType: 'image/jpeg', consent: true, adult: true, clientId: 'dev_abc123' };
const LEAD = { action: 'lead', firstName: 'Ana', lastName: 'Pérez', phone: '099 123 456', email: 'ana@example.com', consent: true, elapsedMs: 9000, origin: 'analisis' };

function envWith(modelInput, opts = {}) {
  const env = createEnv({ props: { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test', ...(opts.props || {}) } });
  env.sent = [];
  const l = env.post(LEAD);
  env.analyze = (extra = {}) => env.post({ ...BASE, requestId: l.requestId, token: l.token, ...extra });
  env.lead = l;
  env.ctx.UrlFetchApp.fetch = (url, o) => {
    env.sent.push({ url, o, body: JSON.parse(o.payload) });
    if (opts.httpError) return { getResponseCode: () => 529, getContentText: () => '{}' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'tool_use', name: 'reportar_analisis', input: modelInput }] }) };
  };
  return env;
}

const GOOD = {
  status: 'ok', skin_type: 'mixta', skin_type_confidence: 'media',
  summary: 'Se observa brillo en la zona T y mejillas con aspecto más seco.',
  observations: [{ area: 'Zona T', text: 'Brillo y poros visibles en nariz y frente.' }, { area: 'Nariz', text: 'Puntos negros aparentes.' }],
  session_focus: ['extraccion', 'punta_diamante', 'hidratacion'],
  home_tips: ['Usá protector solar todos los días.'], see_doctor: false
};

test('IA: devuelve orientación limpia y no guarda la imagen', () => {
  const env = envWith(GOOD);
  const r = env.analyze();
  assert.equal(r.ok, true); assert.equal(r.skin_type, 'mixta'); assert.equal(r.observations.length, 2);
  assert.deepEqual(r.session_focus, ['extraccion', 'punta_diamante', 'hidratacion']);
  const req = env.sent[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.o.headers['x-api-key'], 'sk-test');
  assert.equal(req.body.tool_choice.name, 'reportar_analisis');
  assert.equal(req.body.messages[0].content[0].source.media_type, 'image/jpeg');
  const sheetsDump = JSON.stringify(env.state.sheets) + JSON.stringify(env.state.props) + JSON.stringify(env.state.cache) + env.state.logs.join();
  assert.ok(!sheetsDump.includes(IMG.slice(0, 200)), 'la foto no queda en planilla, propiedades, caché ni logs');
  const ev = env.state.sheets['Eventos'].filter(r => r[2] === 'analisis_piel');
  assert.equal(ev.length, 1); assert.ok(!ev[0][3].includes('mixta'), 'el registro de eventos no guarda el resultado');
  const rows = env.state.sheets['Análisis de piel'];
  assert.equal(rows.length, 2, 'una fila en Análisis de piel');
  const h = rows[0], row = Object.fromEntries(h.map((k, i) => [k, rows[1][i]]));
  assert.equal(row['ID solicitud'], env.lead.requestId); assert.equal(row['Apellido'], 'Pérez'); assert.equal(row['Celular'], '+59899123456');
  assert.match(row['Tipo de piel'], /^mixta/); assert.equal(row['Reservó'], 'No');
  const contact = env.state.sheets['Contactos'].find(r => r[0] === env.lead.requestId);
  assert.ok(contact.includes('Análisis de piel'), 'origen del contacto');
});

test('IA: filtra lenguaje diagnóstico, promesas y técnicas fuera del protocolo', () => {
  const env = envWith({ ...GOOD,
    summary: 'Tenés acné y rosácea.',
    observations: [{ area: 'Mejillas', text: 'Signos de rosácea.' }, { area: 'Frente', text: 'Textura irregular.' }, { area: 'Pómulos', text: 'Te vamos a eliminar las manchas.' }],
    session_focus: ['peeling_quimico', 'extraccion', 'extraccion', 'led'],
    home_tips: ['Tomá isotretinoína para curar el acné.', 'Limpieza suave mañana y noche.']
  });
  const r = env.analyze();
  assert.equal(r.summary, '');
  assert.deepEqual(r.observations.map(o => o.area), ['Frente']);
  assert.deepEqual(r.session_focus, ['extraccion', 'led']);
  assert.deepEqual(r.home_tips, ['Limpieza suave mañana y noche.']);
});

test('IA: derivación médica sin nombrar la condición', () => {
  const env = envWith({ ...GOOD, see_doctor: true, see_doctor_reason: 'Posible melanoma en la mejilla.' });
  const r = env.analyze();
  assert.equal(r.see_doctor, true);
  assert.ok(!/melanoma/i.test(r.see_doctor_reason) && /médico/.test(r.see_doctor_reason));
});

test('IA: menores y fotos no aptas', () => {
  assert.deepEqual(Object.keys(envWith({ status: 'not_allowed', summary: 'x' }).analyze()).sort(), ['ok', 'status']);
  const r = envWith({ status: 'retry', retry_reason: 'La foto está oscura; probá con luz natural.' }).analyze();
  assert.equal(r.status, 'retry'); assert.match(r.retry_reason, /luz natural/);
});

test('IA: exige consentimiento y mayoría de edad; valida imagen', () => {
  const env = envWith(GOOD);
  assert.equal(env.analyze({ adult: false }).code, 'consent_required');
  assert.equal(env.analyze({ consent: false }).code, 'consent_required');
  assert.equal(env.analyze({ mediaType: 'image/gif' }).code, 'invalid_image');
  assert.equal(env.analyze({ image: 'not base64!!' }).code, 'invalid_image');
  assert.equal(env.analyze({ image: 'A'.repeat(4 * 1024 * 1024) }).code, 'invalid_image');
  assert.equal(env.sent.length, 0, 'no se llamó a la IA');
});

test('IA: apagada o sin clave → no simula resultados', () => {
  const env = createEnv();
  assert.equal(env.post(BASE).code, 'ai_not_configured');
  const off = createEnv({ props: { AI_ENABLED: 'false', ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(off.post(BASE).code, 'ai_not_configured');
});

test('IA: exige los datos de contacto guardados antes de analizar', () => {
  const env = envWith(GOOD);
  assert.equal(env.post(BASE).code, 'invalid_token');
  assert.equal(env.analyze({ token: 'otro' }).code, 'invalid_token');
  assert.equal(env.sent.length, 0);
});

test('IA: topes de uso por dispositivo y globales', () => {
  const env = envWith(GOOD, { props: { AI_MAX_PER_CLIENT_DAY: '2' } });
  assert.equal(env.analyze().ok, true); assert.equal(env.analyze().ok, true);
  assert.equal(env.analyze().code, 'rate_limited');
  const g = envWith(GOOD, { props: { AI_MAX_PER_HOUR: '1' } });
  assert.equal(g.analyze({ clientId: 'a' }).ok, true);
  assert.equal(g.analyze({ clientId: 'b' }).code, 'rate_limited');
});

test('IA: error del proveedor → mensaje de error, sin inventar', () => {
  const r = envWith(GOOD, { httpError: true }).analyze();
  assert.equal(r.ok, false); assert.equal(r.code, 'ai_error');
});

test('IA: la misma solicitud reserva sin volver a cargar datos y el análisis queda "Reservó = Sí"', () => {
  const env = envWith(GOOD);
  assert.equal(env.analyze().ok, true);
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const start = new Date(d.toISOString().slice(0, 10) + 'T14:00:00-03:00').toISOString();
  const r = env.post({ action: 'book', requestId: env.lead.requestId, token: env.lead.token, start, idempotencyKey: 'idem_analisis_000001' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = env.state.sheets['Análisis de piel'];
  assert.equal(rows[1][rows[0].indexOf('Reservó')], 'Sí');
});
