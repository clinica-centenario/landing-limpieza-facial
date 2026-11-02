const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const IMG = 'A'.repeat(40000); // base64 válido (~30 KB)
const BASE = { action: 'analyze', image: IMG, mediaType: 'image/jpeg', consent: true, adult: true, clientId: 'dev_abc123' };

function envWith(modelInput, opts = {}) {
  const env = createEnv({ props: { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test', ...(opts.props || {}) } });
  env.sent = [];
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
  const r = env.post(BASE);
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
  assert.equal(ev.length, 1); assert.ok(!ev[0][3].includes('mixta'), 'el registro no guarda el resultado');
});

test('IA: filtra lenguaje diagnóstico, promesas y técnicas fuera del protocolo', () => {
  const env = envWith({ ...GOOD,
    summary: 'Tenés acné y rosácea.',
    observations: [{ area: 'Mejillas', text: 'Signos de rosácea.' }, { area: 'Frente', text: 'Textura irregular.' }, { area: 'Pómulos', text: 'Te vamos a eliminar las manchas.' }],
    session_focus: ['peeling_quimico', 'extraccion', 'extraccion', 'led'],
    home_tips: ['Tomá isotretinoína para curar el acné.', 'Limpieza suave mañana y noche.']
  });
  const r = env.post(BASE);
  assert.equal(r.summary, '');
  assert.deepEqual(r.observations.map(o => o.area), ['Frente']);
  assert.deepEqual(r.session_focus, ['extraccion', 'led']);
  assert.deepEqual(r.home_tips, ['Limpieza suave mañana y noche.']);
});

test('IA: derivación médica sin nombrar la condición', () => {
  const env = envWith({ ...GOOD, see_doctor: true, see_doctor_reason: 'Posible melanoma en la mejilla.' });
  const r = env.post(BASE);
  assert.equal(r.see_doctor, true);
  assert.ok(!/melanoma/i.test(r.see_doctor_reason) && /médico/.test(r.see_doctor_reason));
});

test('IA: menores y fotos no aptas', () => {
  assert.deepEqual(Object.keys(envWith({ status: 'not_allowed', summary: 'x' }).post(BASE)).sort(), ['ok', 'status']);
  const r = envWith({ status: 'retry', retry_reason: 'La foto está oscura; probá con luz natural.' }).post(BASE);
  assert.equal(r.status, 'retry'); assert.match(r.retry_reason, /luz natural/);
});

test('IA: exige consentimiento y mayoría de edad; valida imagen', () => {
  const env = envWith(GOOD);
  assert.equal(env.post({ ...BASE, adult: false }).code, 'consent_required');
  assert.equal(env.post({ ...BASE, consent: false }).code, 'consent_required');
  assert.equal(env.post({ ...BASE, mediaType: 'image/gif' }).code, 'invalid_image');
  assert.equal(env.post({ ...BASE, image: 'not base64!!' }).code, 'invalid_image');
  assert.equal(env.post({ ...BASE, image: 'A'.repeat(4 * 1024 * 1024) }).code, 'invalid_image');
  assert.equal(env.sent.length, 0, 'no se llamó a la IA');
});

test('IA: apagada o sin clave → no simula resultados', () => {
  const env = createEnv();
  assert.equal(env.post(BASE).code, 'ai_not_configured');
});

test('IA: topes de uso por dispositivo y globales', () => {
  const env = envWith(GOOD, { props: { AI_MAX_PER_CLIENT_DAY: '2' } });
  assert.equal(env.post(BASE).ok, true); assert.equal(env.post(BASE).ok, true);
  assert.equal(env.post(BASE).code, 'rate_limited');
  const g = envWith(GOOD, { props: { AI_MAX_PER_HOUR: '1' } });
  assert.equal(g.post({ ...BASE, clientId: 'a' }).ok, true);
  assert.equal(g.post({ ...BASE, clientId: 'b' }).code, 'rate_limited');
});

test('IA: error del proveedor → mensaje de error, sin inventar', () => {
  const r = envWith(GOOD, { httpError: true }).post(BASE);
  assert.equal(r.ok, false); assert.equal(r.code, 'ai_error');
});
