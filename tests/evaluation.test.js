// Reglas del informe (public/evaluation.js): separación foto / cuestionario, evaluabilidad y textos permitidos.
const test = require('node:test');
const assert = require('node:assert/strict');
const EV = require('../public/evaluation.js');

const SQ = [[100, 100], [200, 100], [200, 200], [100, 200]];
const REGIONS = { frente: SQ, nariz: SQ, mejilla_der: SQ, mejilla_izq: SQ };
const CLEAN = { shineT: 0.01, shineC: 0.005, redDiff: 0, texture: 4, toneCv: 0.03, noseSpots: 0.5, noseBlobs: 0 };
const BUSY = { shineT: 0.09, shineC: 0.01, redDiff: 0.05, texture: 9, toneCv: 0.09, noseSpots: 6, noseBlobs: 4 };
const GOOD = { pxPerMm: 4, sideLight: false, occluded: {} };
const SAFE = { heridas: 'no', irritacion: 'no', dolor: 'no', sangrado: 'no', cambio: 'no' };
const FULL = { en_cara: 'nada', brillo_donde: 'zona_t', brillo_cuando: 'tarde', tirantez: 'no', descamacion: 'no', reactividad: 'no',
  rutina: ['limpiador'], objetivo: 'brillo', recientes: ['ninguno'], ...SAFE };
const byCat = (obs) => Object.fromEntries(obs.map(o => [o.category, o]));
const photoOf = (m, q = GOOD, r = REGIONS) => ({ observations: EV.observePhoto(m, q, r) });

test('cada categoría tiene un estado; poros, puntos claros y descamación no son evaluables con este método', () => {
  const o = byCat(EV.observePhoto(CLEAN, GOOD, REGIONS));
  assert.deepEqual(Object.keys(o), EV.CATEGORIES.map(c => c.key));
  for (const k of ['poros', 'puntos_claros', 'descamacion']) { assert.equal(o[k].status, 'no_evaluable'); assert.ok(o[k].reason); }
  for (const k of ['brillo', 'textura', 'puntos_oscuros', 'enrojecimiento', 'tono']) assert.equal(o[k].status, 'no_observado');
  assert.ok(Object.values(o).every(x => x.geometry === null), 'sin hallazgos no hay marcas');
});

test('imagen sin hallazgos: el informe no inventa observaciones y aclara que "no se observa" no es "no existe"', () => {
  const r = EV.buildReport(FULL, photoOf(CLEAN));
  assert.equal(r.observations.filter(o => o.status === 'observado').length, 0);
  assert.match(r.summary[1], /no se observaron diferencias claras/);
  assert.ok(!r.orientations.some(o => o.id === 'ORI-COMEDONES'));
});

test('observado: zona, descripción, limitación y geometría válida; sin conteos ni porcentajes', () => {
  const r = EV.buildReport(FULL, photoOf(BUSY));
  const seen = r.observations.filter(o => o.status === 'observado');
  assert.deepEqual(seen.map(o => o.category), ['brillo', 'textura', 'puntos_oscuros', 'enrojecimiento', 'tono']);
  assert.deepEqual(seen.map(o => o.n), [1, 2, 3, 4, 5], 'numeradas una vez cada una');
  seen.forEach(o => { assert.ok(o.zone && o.description && o.limitation && o.source === 'foto'); assert.equal(o.geometry.type, 'region'); });
  assert.ok(!/\(\d+\)|%/.test(JSON.stringify(r)), 'sin conteos ni porcentajes');
  assert.deepEqual(EV.validateReport(r), []);
});

test('zonas tapadas, luz de costado o poco detalle: "no evaluable" con el motivo, nunca un hallazgo', () => {
  const o = byCat(EV.observePhoto(BUSY, { pxPerMm: 2, sideLight: true, occluded: { nariz: true, mejilla_der: true, mejilla_izq: true } }, REGIONS));
  assert.equal(o.brillo.status, 'no_evaluable'); assert.match(o.brillo.reason, /luz/);
  assert.equal(o.textura.status, 'no_evaluable');
  assert.equal(o.puntos_oscuros.status, 'no_evaluable'); assert.match(o.puntos_oscuros.reason, /nariz/);
  assert.equal(o.tono.status, 'no_evaluable');
  const half = byCat(EV.observePhoto(BUSY, { ...GOOD, occluded: { mejilla_der: true } }, REGIONS));
  assert.equal(half.tono.geometry.polygons.length, 1, 'solo se marca la mejilla que se ve');
  const low = byCat(EV.observePhoto(BUSY, { ...GOOD, pxPerMm: 2.7 }, REGIONS));
  assert.equal(low.textura.status, 'observado'); assert.equal(low.puntos_oscuros.status, 'no_evaluable', 'los puntitos necesitan más detalle que la textura');
});

test('maquillaje, crema o filtro declarados solo restan evaluabilidad', () => {
  const mk = byCat(EV.buildReport({ ...FULL, en_cara: 'maquillaje' }, photoOf(BUSY)).observations);
  assert.ok(['brillo', 'textura', 'puntos_oscuros', 'enrojecimiento', 'tono'].every(k => mk[k].status === 'no_evaluable' && !mk[k].geometry));
  const cr = byCat(EV.buildReport({ ...FULL, en_cara: 'crema' }, photoOf(BUSY)).observations);
  assert.equal(cr.brillo.status, 'no_evaluable'); assert.equal(cr.tono.status, 'observado');
  const fl = byCat(EV.buildReport({ ...FULL, filtro: 'si' }, photoOf(BUSY)).observations);
  assert.equal(fl.tono.status, 'no_evaluable'); assert.equal(fl.brillo.status, 'observado');
  const clean = EV.buildReport({ ...FULL, en_cara: 'maquillaje' }, photoOf(CLEAN));
  assert.equal(clean.observations.filter(o => o.status === 'observado').length, 0, 'el cuestionario nunca agrega hallazgos');
});

test('el cuestionario nunca genera marcas: sin foto no hay observaciones aunque cuente brillo o puntitos', () => {
  const r = EV.buildReport({ ...FULL, brillo_donde: 'toda', objetivo: 'puntos' }, null);
  assert.equal(r.photo, 'sin_foto'); assert.equal(r.observations.length, 0);
  assert.match(r.summary[1], /No sumaste foto/);
  const pn = r.orientations.find(o => o.id === 'ORI-COMEDONES');
  assert.deepEqual(pn.because, ['Elegiste despejar puntitos oscuros o poros.'], 'el motivo cita solo la respuesta');
});

test('tendencia: sale de las respuestas, con incertidumbre; el brillo de la foto no la cambia', () => {
  const t = (a, ph) => EV.buildReport({ ...FULL, ...a }, ph).tendency;
  assert.equal(t({ brillo_donde: 'poco', tirantez: 'no', descamacion: 'no' }, photoOf(BUSY)).key, 'normal', 'brillo en la foto no convierte la piel en grasa');
  assert.equal(t({ brillo_donde: 'toda', tirantez: 'no' }).key, 'grasa');
  assert.equal(t({ brillo_donde: 'zona_t', tirantez: 'siempre' }).key, 'mixta');
  assert.equal(t({ brillo_donde: 'poco', descamacion: 'aveces' }).key, 'seca');
  const cross = t({ brillo_donde: 'toda', tirantez: 'siempre' });
  assert.equal(cross.key, null); assert.match(cross.note, /se cruzan/);
  const part = t({ brillo_donde: 'toda', tirantez: 'nose', descamacion: 'nose' });
  assert.equal(part.key, 'grasa'); assert.equal(part.certainty, 'parcial');
  assert.equal(t({ brillo_donde: 'nose', tirantez: 'nose', descamacion: 'nose' }).key, null);
});

test('sensibilidad: característica declarada, no un tipo de piel', () => {
  const r = EV.buildReport({ ...FULL, reactividad: 'seguido' }, photoOf(CLEAN));
  assert.ok(r.declared.some(d => /^Sensibilidad declarada/.test(d.text)));
  assert.notEqual(r.tendency.key, 'sensible');
  assert.ok(r.orientations.some(o => o.id === 'ORI-TOLERANCIA'));
  assert.match(r.summary[0], /con sensibilidad a algunos productos/);
});

test('cuestionario incompleto: lo no respondido queda vacío, nunca "no"; nada viene marcado', () => {
  const a = EV.cleanAnswers({ brillo_donde: 'zona_t', heridas: 'quizas', rutina: ['nada', 'protector'], recientes: [] });
  assert.equal(a.heridas, null); assert.equal(a.sangrado, null); assert.equal(a.tirantez, null);
  assert.deepEqual(a.rutina, ['nada']); assert.equal(a.recientes, null);
  const screens = EV.quizFor({ photo: true, upload: false });
  const seg = screens.find(s => s.id === 'seguridad');
  assert.deepEqual(EV.missingIn(seg, {}), ['heridas', 'irritacion', 'dolor', 'sangrado', 'cambio'], 'cada pregunta de seguridad se responde por separado');
  assert.deepEqual(EV.missingIn(screens.find(s => s.id === 'brillo'), { brillo_donde: 'poco' }), [], '"cuándo" solo aparece si hay brillo');
  assert.deepEqual(EV.missingIn(screens.find(s => s.id === 'brillo'), { brillo_donde: 'toda' }), ['brillo_cuando']);
  assert.ok(!screens.find(s => s.id === 'contexto').items.some(i => i.k === 'filtro'), 'el filtro se pregunta solo si subió la foto');
  assert.ok(!EV.quizFor({ photo: false }).some(s => s.id === 'contexto'));
  const r = EV.buildReport({}, null);
  assert.equal(r.preReview.length, 0, 'sin respuestas no se atribuyen síntomas');
  assert.equal(r.tendency.key, null);
  assert.deepEqual(EV.validateReport(r), []);
});

test('revisión previa: cada respuesta por separado; lesión que sangra o cambia → consulta médica', () => {
  const only = (k) => EV.buildReport({ ...FULL, [k]: 'si' }, null).preReview;
  assert.deepEqual(only('heridas').map(p => p.id), ['REV-HERIDAS']);
  assert.deepEqual(only('dolor').map(p => p.id), ['REV-DOLOR']);
  assert.ok(!/sangra|cambi/.test(only('dolor')[0].text), 'no se atribuyen otros síntomas');
  const s = only('sangrado');
  assert.equal(s[0].kind, 'medica'); assert.match(s[0].text, /sangra/); assert.ok(!/cambió/.test(s[0].text));
  assert.match(s[0].text, /consultá con un médico o dermatólogo/); assert.match(s[0].text, /no es una solución/);
  const r = EV.buildReport({ ...FULL, cambio: 'si' }, null);
  assert.match(r.summary[2], /consulta médica/);
  assert.equal(EV.buildReport(FULL, null).preReview.length, 0, 'si todo es "No", no se muestra');
});

test('orientaciones: cada una con su motivo concreto, sin asignar técnicas ni prometer resultados', () => {
  const r = EV.buildReport({ ...FULL, tirantez: 'siempre', objetivo: 'luminosidad', recientes: ['retinoides'] }, photoOf(BUSY));
  const ids = r.orientations.map(o => o.id);
  assert.equal(ids[0], 'ORI-TONO', 'primero lo que coincide con su objetivo');
  assert.ok(ids.includes('ORI-CONFORT') && ids.includes('ORI-TOLERANCIA') && ids.includes('ORI-COMEDONES'));
  assert.match(r.orientations[0].text, /no es un tratamiento para eliminar manchas/);
  r.orientations.forEach(o => assert.ok(o.because.length));
  const txt = JSON.stringify(r.orientations);
  assert.ok(!/punta[s]? de diamante|LED|máscara|peeling/i.test(txt), 'las técnicas no se asignan');
  assert.ok(!/elimina(r)? (los )?puntos|cierra(r)? (los )?poros|garantiza/i.test(txt.replace(/no cierra poros/g, '')), 'sin promesas');
  const calm = EV.buildReport({ ...FULL, brillo_donde: 'poco', objetivo: 'cuidado' }, photoOf(CLEAN));
  assert.deepEqual(calm.orientations.map(o => o.id), ['ORI-CUIDADO'], 'no se recomiendan todas las técnicas a todos');
});

test('resumen personalizado de 2 o 3 frases; distinto según los datos', () => {
  const a = EV.buildReport(FULL, photoOf(BUSY)), b = EV.buildReport({ ...FULL, brillo_donde: 'poco', objetivo: 'confort', tirantez: 'siempre' }, photoOf(CLEAN));
  assert.ok(a.summary.length >= 2 && a.summary.length <= 3);
  assert.notDeepEqual(a.summary, b.summary);
  assert.match(a.summary[1], /reflejos de luz en frente y nariz/);
  assert.match(b.summary[2], /confort/);
});

test('sin diagnósticos ni términos prohibidos en ninguna combinación', () => {
  const vals = { brillo_donde: ['toda', 'zona_t', 'poco', 'nose'], tirantez: ['siempre', 'no'], reactividad: ['seguido', 'no'], objetivo: ['puntos', 'brillo', 'textura', 'confort', 'luminosidad', 'cuidado'] };
  for (const bd of vals.brillo_donde) for (const ti of vals.tirantez) for (const re of vals.reactividad) for (const ob of vals.objetivo) {
    const r = EV.buildReport({ ...FULL, brillo_donde: bd, brillo_cuando: 'rapido', tirantez: ti, reactividad: re, objetivo: ob, sangrado: 'si', recientes: ['sol', 'medicacion'] }, photoOf(BUSY));
    assert.deepEqual(EV.validateReport(r), []);
    assert.ok(!/acn[eé]|ros[aá]cea|melasma|dermatitis|milium|comed[oó]n\b|sebo|hidrataci[oó]n (de|del) \d/i.test(JSON.stringify(r)), JSON.stringify(r.summary));
  }
});

test('geometría inválida o categoría desconocida: se descarta antes de mostrar', () => {
  const obs = EV.observePhoto(BUSY, GOOD, REGIONS);
  obs[0].geometry = { type: 'region', polygons: [[[NaN, 1], [2, 2], [3, 3]]] };
  obs.push({ category: 'acne', status: 'observado', description: 'x', geometry: null });
  const r = EV.buildReport(FULL, { observations: obs });
  assert.ok(!r.observations.some(o => o.category === 'brillo' || o.category === 'acne'));
  assert.equal(r.observations.find(o => o.status === 'observado').n, 1, 'la numeración no deja huecos');
});

test('resumen para la profesional: solo texto, sin geometría ni foto', () => {
  const c = EV.compactReport(EV.buildReport(FULL, photoOf(BUSY)));
  assert.ok(!/polygons|data:image|blob:/.test(JSON.stringify(c)));
  assert.equal(c.observations.length, 8);
});
