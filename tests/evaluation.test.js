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

// Zonas separadas, como en una cara: frente arriba, nariz al centro, mejillas a los lados.
const SQR = (x, y, w = 100) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
const ZONES = { frente: SQR(100, 0), nariz: SQR(150, 120), mejilla_der: SQR(0, 200), mejilla_izq: SQR(300, 200) };
const LOCATED = { ...BUSY, shine: { frente: { frac: 0.06, x: 150, y: 40, spread: 6 }, nariz: { frac: 0.002, x: 200, y: 170, spread: 3 } },
  cheeks: { mejilla_der: { texture: 9, redDiff: 0.06, toneCv: 0.05 }, mejilla_izq: { texture: 9, redDiff: 0.01, toneCv: 0.1 } },
  darkSpots: [{ x: 190, y: 170 }, { x: 205, y: 178 }, { x: 198, y: 186 }], lightSpots: [{ x: 40, y: 240 }, { x: 52, y: 252 }, { x: 46, y: 236 }] };

test('cada categoría tiene un estado; "no evaluable" distingue foto, contexto y detector', () => {
  const o = byCat(EV.observePhoto({ ...CLEAN, lightSpots: [] }, GOOD, REGIONS));
  assert.deepEqual(Object.keys(o), EV.CATEGORIES.map(c => c.key));
  for (const k of ['poros', 'descamacion']) { assert.equal(o[k].status, 'no_evaluable'); assert.equal(o[k].naKind, 'detector'); assert.match(o[k].reason, /análisis automático todavía no mide/); }
  for (const k of ['brillo', 'textura', 'puntos_oscuros', 'puntos_claros', 'enrojecimiento', 'tono']) assert.equal(o[k].status, 'no_observado', k);
  assert.ok(Object.values(o).every(x => x.geometry === null), 'sin hallazgos no hay marcas');
  const all = JSON.stringify(o);
  assert.ok(!/más chicos que el detalle|foto de celular no muestra|solo se identifican|se identifican en persona/.test(all), 'sin afirmaciones universales sobre las fotos');
});

test('imagen sin hallazgos: no inventa observaciones ni afirma que la piel esté bien', () => {
  const r = EV.buildReport(FULL, photoOf({ ...CLEAN, lightSpots: [] }));
  assert.equal(r.observations.filter(o => o.status === 'observado').length, 0);
  assert.equal(r.summary[0], 'No encontramos detalles destacados en las zonas que pudimos evaluar.');
  assert.equal(r.capture, null, 'el límite del detector no pide repetir la foto');
  assert.ok(!r.orientations.some(o => o.id === 'ORI-COMEDONES'));
});

test('marcas sobre la evidencia: reflejos, puntitos y la mejilla que supera el umbral', () => {
  const r = EV.buildReport(FULL, photoOf(LOCATED, GOOD, ZONES));
  const o = byCat(r.observations);
  assert.deepEqual(r.observations.filter(x => x.status === 'observado').map(x => x.n), [1, 2, 3, 4, 5, 6], 'numeradas una vez cada una');
  const b = o.brillo.geometry.marks;
  assert.deepEqual(b.map(m => [m.kind, m.zone, m.x, m.y]), [['punto', 'frente', 150, 40]], 'el brillo se marca donde están los reflejos, no en la nariz sin reflejos');
  assert.equal(o.brillo.zone, 'frente');
  const d = o.puntos_oscuros.geometry.marks[0];
  assert.equal(d.kind, 'punto'); assert.ok(Math.abs(d.x - 197.7) < 1 && Math.abs(d.y - 178) < 1, 'círculo centrado en los puntitos detectados');
  assert.ok(d.r >= 12 && d.r < 50);
  assert.deepEqual(o.puntos_claros.geometry.marks.map(m => [m.kind, m.zone]), [['punto', 'mejilla_der']]);
  assert.deepEqual(o.enrojecimiento.geometry.marks.map(m => [m.kind, m.zone, m.x, m.y]), [['zona', 'mejilla_der', 50, 250]], 'extendido: número en el centro de la zona medida');
  assert.equal(o.enrojecimiento.zone, 'mejilla derecha');
  assert.deepEqual(o.tono.geometry.marks.map(m => m.zone), ['mejilla_izq']);
  assert.equal(o.textura.zone, 'ambas mejillas');
  for (const x of r.observations.filter(x => x.status === 'observado')) assert.ok(x.description && x.meaning && x.consult, x.category);
  assert.ok(!/\(\d+\)|%/.test(JSON.stringify(r)), 'sin conteos ni porcentajes');
  assert.deepEqual(EV.validateReport(r), []);
});

test('evidencia muy repartida: se señala la zona, sin aparentar delimitar una lesión', () => {
  const spread = { ...LOCATED, darkSpots: [{ x: 150, y: 120 }, { x: 250, y: 220 }, { x: 150, y: 220 }, { x: 250, y: 120 }] };
  const ms = byCat(EV.observePhoto(spread, GOOD, ZONES)).puntos_oscuros.geometry.marks;
  assert.equal(ms.length, 1); assert.equal(ms[0].kind, 'zona'); assert.equal(ms[0].r, 0);
  // Dos grupos separados más un punto suelto: un círculo por grupo, ninguno para el suelto.
  const two = { ...LOCATED, darkSpots: [{ x: 160, y: 130 }, { x: 166, y: 134 }, { x: 240, y: 210 }, { x: 236, y: 214 }, { x: 200, y: 175 }] };
  const g = byCat(EV.observePhoto(two, GOOD, ZONES)).puntos_oscuros.geometry.marks;
  assert.equal(g.length, 2); assert.ok(g.every(m => m.kind === 'punto'));
});

test('sin ubicación medida, la marca va al centro de la zona medida; nunca a un lugar inventado', () => {
  const o = byCat(EV.observePhoto(BUSY, GOOD, ZONES));
  assert.ok(o.brillo.geometry.marks.every(m => m.kind === 'zona' && ['frente', 'nariz'].includes(m.zone)));
  assert.equal(o.puntos_claros.status, 'no_evaluable', 'sin medición de puntitos claros no se afirma nada');
});

test('foto que no alcanza: "no evaluable" con el motivo real y un consejo acorde', () => {
  const o = byCat(EV.observePhoto(BUSY, { pxPerMm: 2, sideLight: true, occluded: { nariz: true, mejilla_der: true, mejilla_izq: true } }, REGIONS));
  assert.equal(o.brillo.status, 'no_evaluable'); assert.equal(o.brillo.fix, 'luz_lateral');
  assert.equal(o.textura.fix, 'tapado');
  assert.equal(o.puntos_oscuros.status, 'no_evaluable'); assert.match(o.puntos_oscuros.reason, /nariz/);
  const half = byCat(EV.observePhoto(BUSY, { ...GOOD, occluded: { mejilla_der: true } }, REGIONS));
  assert.deepEqual(half.tono.geometry.marks.map(m => m.zone), ['mejilla_izq'], 'solo se marca la mejilla que se ve');
  const low = byCat(EV.observePhoto(BUSY, { ...GOOD, pxPerMm: 2.7 }, REGIONS));
  assert.equal(low.textura.status, 'observado'); assert.equal(low.puntos_oscuros.status, 'no_evaluable'); assert.equal(low.puntos_oscuros.fix, 'detalle');
  // Poco detalle y nada observado en lo demás → pedir acercar la cámara; luz despareja → no pedir acercarse.
  const tiny = EV.buildReport(FULL, photoOf({ ...CLEAN, lightSpots: [] }, { pxPerMm: 2, occluded: { frente: true } }));
  assert.equal(tiny.capture.blocking, true); assert.match(tiny.summary[0], /acercá un poco más la cámara/);
  const lateral = EV.buildReport(FULL, photoOf(CLEAN, { pxPerMm: 4, sideLight: true, occluded: {} }));
  assert.equal(lateral.capture.fix, 'luz_lateral'); assert.ok(!/acerc/.test(lateral.summary[0]), lateral.summary[0]);
  const some = EV.buildReport(FULL, photoOf(BUSY, { ...GOOD, pxPerMm: 2.7 }));
  assert.equal(some.capture.blocking, false, 'con observaciones, el consejo es un dato aparte'); assert.match(some.capture.text, /acercando/);
});

test('maquillaje, crema o filtro declarados solo restan evaluabilidad', () => {
  const mk = byCat(EV.buildReport({ ...FULL, en_cara: 'maquillaje' }, photoOf(BUSY)).observations);
  assert.ok(['brillo', 'textura', 'puntos_oscuros', 'enrojecimiento', 'tono'].every(k => mk[k].status === 'no_evaluable' && mk[k].naKind === 'contexto' && !mk[k].geometry));
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
  assert.match(r.summary[0], /Sin foto/);
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
  assert.equal(r.skinType.sensitive, true);
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
  assert.ok(r.summary.length <= 2 && !/médic/.test(r.summary.join(' ')), 'la alerta va aparte, a la vista: no se repite en el resumen');
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

test('resumen de una o dos frases, sin repetir tarjetas ni advertencias; qué trabajar: hasta tres puntos ligados', () => {
  const a = EV.buildReport(FULL, photoOf(LOCATED, GOOD, ZONES)), b = EV.buildReport({ ...FULL, brillo_donde: 'nose', tirantez: 'nose', descamacion: 'nose', objetivo: 'confort' }, photoOf(CLEAN));
  assert.ok(a.summary.length >= 1 && a.summary.length <= 2);
  assert.match(a.summary[0], /coincide con lo que buscás: menos brillo/);
  assert.deepEqual(a.skinType, { key: 'mixta', label: 'Mixta', sensitive: false, partial: false }, 'tipo de piel estimado en su propia línea');
  assert.ok(!/mixta/.test(a.summary.join(' ')), 'no se repite en el resumen');
  assert.equal(b.skinType, null, 'sin datos suficientes, no se estima');
  assert.equal(b.summary.length, 1);
  assert.ok(!/cosmetóloga|define en persona|diagnóstico/.test(a.summary.concat(b.summary).join(' ')));
  const words = a.summary.join(' ').split(/\s+/).length; assert.ok(words <= 30, 'resumen corto: ' + words);
  assert.ok(a.work.length <= 3 && a.work.length > 0);
  assert.equal(a.work[0].id, 'ORI-BRILLO'); assert.deepEqual(a.work[0].marks, [1], 'ligado a la marca del brillo');
  assert.ok(a.work.every(w => w.text.split(/\s+/).length <= 10));
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
  obs[0].geometry = { type: 'marks', marks: [{ kind: 'punto', zone: 'frente', x: NaN, y: 1, r: 3 }] };
  obs.push({ category: 'acne', status: 'observado', description: 'x', geometry: null });
  const r = EV.buildReport(FULL, { observations: obs });
  assert.ok(!r.observations.some(o => o.category === 'brillo' || o.category === 'acne'));
  assert.equal(r.observations.find(o => o.status === 'observado').n, 1, 'la numeración no deja huecos');
});

test('resumen para la profesional: solo texto, sin geometría ni foto', () => {
  const c = EV.compactReport(EV.buildReport(FULL, photoOf(BUSY)));
  assert.ok(!/marks|polygons|data:image|blob:/.test(JSON.stringify(c)));
  assert.equal(c.observations.length, 8);
});
