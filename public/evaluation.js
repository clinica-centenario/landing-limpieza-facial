/**
 * Evaluación cosmética orientativa: reglas puras, sin acceso a la página ni a la red.
 * Se usa en el navegador (window.CCEval) y en las pruebas (require).
 *
 * Separación interna:
 *   quality       calidad de la captura (lo mide app.js)
 *   observations  observaciones visuales de la foto (observePhoto): solo categorías cerradas
 *   declared      lo que la persona respondió (nunca genera marcas sobre la foto)
 *   orientations  qué se puede valorar en la sesión, cada una con su "por qué"
 *   preReview     motivos de revisión previa, solo por respuestas concretas
 *
 * Método de la foto: MediaPipe Face Landmarker (red neuronal) SOLO ubica el rostro y sus puntos.
 * Las observaciones son mediciones de imagen (reflejos, contraste local, color relativo entre zonas)
 * con umbrales PROVISORIOS sin validación clínica. Por eso: sin conteos, sin puntajes, sin porcentajes,
 * sin marcas puntuales en la vista habitual, y "no evaluable" cuando la foto no alcanza.
 */
(function (root) {
  'use strict';

  var VERSION = 'v4-2026-11';
  var PRO = 'Lic. Jaqueline Mansilla';
  var DISCLAIMER = 'Orientación cosmética generada con IA a partir de tus fotos y respuestas. No es un diagnóstico. La cosmetóloga confirma los cuidados adecuados en consulta.';

  var ST = { SEEN: 'observado', NOT_SEEN: 'no_observado', NA: 'no_evaluable' };

  // Categorías cosméticas, en el orden en que se muestran. color + número: nunca solo el color.
  var CATEGORIES = [
    { key: 'brillo', label: 'Brillo visible', color: '#a86a12' },
    { key: 'poros', label: 'Poros visibles', color: '#5b6b7a' },
    { key: 'textura', label: 'Aspecto de textura irregular', color: '#3f6f93' },
    { key: 'puntos_oscuros', label: 'Puntitos oscuros para revisar', color: '#6b4fa0' },
    { key: 'puntos_claros', label: 'Pequeños puntos claros para revisar', color: '#5b6b7a' },
    { key: 'enrojecimiento', label: 'Enrojecimiento visible', color: '#b4441a' },
    { key: 'tono', label: 'Zonas de tono desigual', color: '#0f6e66' },
    { key: 'descamacion', label: 'Descamación aparente', color: '#5b6b7a' }
  ];
  var CAT = {};
  CATEGORIES.forEach(function (c) { CAT[c.key] = c; });

  // Umbrales PROVISORIOS de las mediciones (sin validar: calibrar con ?diagnostico=1 y fotos reales).
  // No se muestran como números ni se presentan como validados.
  var SKIN_RULES = { shineT: 0.05, shineGeneralC: 0.04, shineRatio: 2, rednessDiff: 0.035, texture: 7, toneCv: 0.07,
    noseSpots: 3.5, noseBlobs: 3 };
  // Requisitos de la foto por categoría. Son límites de muestreo, no de calibración:
  // con menos píxeles por milímetro el detalle buscado ocupa 1 o 2 píxeles y no se distingue del ruido.
  var NEEDS = { textura: { pxPerMm: 2.5 }, puntos_oscuros: { pxPerMm: 3 } };

  // Categorías que el método actual no puede sostener con una selfie: siempre "no evaluable".
  var NOT_SUPPORTED = {
    poros: 'Los poros son más chicos que el detalle que capta una foto de celular. Se ven en persona, con lupa.',
    puntos_claros: 'En una foto, los reflejos de luz se confunden con puntitos claros. Se identifican en persona.',
    descamacion: 'Una foto de celular no muestra la descamación con suficiente detalle. Contanos si la notás en el cuestionario.'
  };

  var LIMITS = {
    brillo: 'El brillo de una foto depende de la luz y de la hora. No mide cuánta grasa produce tu piel.',
    textura: 'En una foto, el vello, las sombras o la compresión de la imagen pueden parecer textura.',
    puntos_oscuros: 'Pueden ser poros, sombras o vello. Si son comedones lo confirma la cosmetóloga en persona.',
    enrojecimiento: 'El lavado reciente, el calor o el color de la luz pueden enrojecer la piel un rato. No indica una enfermedad.',
    tono: 'Sombras, pecas o vello pueden verse como tono desigual.'
  };

  // ── Cuestionario ─────────────────────────────────────────────
  // Pantallas con una o más preguntas. Toda pregunta visible es obligatoria; nada viene marcado.
  // "No sé" es una respuesta válida y nunca se interpreta como "No".
  var YES_NO = [['si', 'Sí'], ['no', 'No']];
  var QUIZ = [
    { id: 'contexto', photo: true, title: 'Sobre la foto', items: [
      { k: 'en_cara', q: 'Cuando sacaste la foto, ¿tenías algo en la cara?', o: [['nada', 'Nada, la cara lavada'], ['crema', 'Crema hidratante o protector solar'], ['maquillaje', 'Maquillaje (base, corrector o polvo)'], ['nose', 'No sé']] },
      { k: 'filtro', upload: true, q: '¿La foto tiene filtro o modo belleza?', o: [['no', 'No'], ['si', 'Sí'], ['nose', 'No sé']] }
    ] },
    { id: 'brillo', title: 'Brillo', items: [
      { k: 'brillo_donde', q: '¿Dónde te aparece brillo durante el día?', o: [['toda', 'En toda la cara'], ['zona_t', 'En frente, nariz y mentón'], ['poco', 'Casi no me aparece'], ['nose', 'No sé']] },
      { k: 'brillo_cuando', showIf: function (a) { return a.brillo_donde === 'toda' || a.brillo_donde === 'zona_t'; },
        q: '¿Cuándo lo notás?', o: [['rapido', 'A pocas horas de lavarme la cara'], ['tarde', 'Recién hacia la tarde'], ['nose', 'No sé']] }
    ] },
    { id: 'lavado', title: 'Después de lavarte la cara', items: [
      { k: 'tirantez', q: '¿Sentís tirantez?', o: [['siempre', 'Sí, casi siempre'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
      { k: 'descamacion', q: '¿Notás que la piel se descama (pielcitas)?', o: [['seguido', 'Sí, seguido'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] }
    ] },
    { id: 'reaccion', title: 'Productos', items: [
      { k: 'reactividad', q: '¿Sentís ardor, picazón o te enrojecés con algunos productos?', o: [['seguido', 'Sí, seguido'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] }
    ] },
    { id: 'rutina', title: 'Tu rutina', items: [
      { k: 'rutina', multi: true, exclusive: ['nada'], q: '¿Qué usás habitualmente? Marcá todo lo que corresponda.',
        o: [['limpiador', 'Limpiador facial'], ['hidratante', 'Crema hidratante'], ['protector', 'Protector solar'], ['activos', 'Ácidos, retinol u otros activos'], ['maquillaje', 'Maquillaje casi todos los días'], ['nada', 'Casi nada']] }
    ] },
    { id: 'objetivo', title: 'Tu objetivo', items: [
      { k: 'objetivo', q: '¿Qué es lo que más te gustaría lograr con la limpieza?',
        o: [['puntos', 'Despejar puntitos oscuros o poros'], ['brillo', 'Menos brillo'], ['textura', 'Piel más suave'], ['confort', 'Confort e hidratación'], ['luminosidad', 'Aspecto más luminoso'], ['cuidado', 'Darme un momento de cuidado']] }
    ] },
    { id: 'recientes', title: 'Últimas semanas', items: [
      { k: 'recientes', multi: true, exclusive: ['ninguno'], q: '¿Algo de esto te pasó en las últimas semanas?',
        o: [['retinoides', 'Usé retinol, ácido retinoico o ácidos exfoliantes en la última semana'], ['procedimiento', 'Me hice un procedimiento en la cara en el último mes (peeling, láser, depilación, inyectables)'],
            ['sol', 'Tomé mucho sol o me quemé'], ['medicacion', 'Estoy con medicación para la piel indicada por un médico'], ['ninguno', 'Nada de esto']] }
    ] },
    { id: 'seguridad', title: 'Para tu seguridad', intro: 'Respondé cada pregunta por separado.', items: [
      { k: 'heridas', q: '¿Tenés heridas abiertas o costras en la cara?', o: YES_NO },
      { k: 'irritacion', q: '¿Tenés ahora una irritación intensa o una quemadura en la cara?', o: YES_NO },
      { k: 'dolor', q: '¿Tenés alguna zona o lesión que te duela?', o: YES_NO },
      { k: 'sangrado', q: '¿Alguna lesión sangra sin que la lastimes?', o: YES_NO },
      { k: 'cambio', q: '¿Algún lunar o lesión cambió de tamaño, forma o color, o una herida no cicatriza?', o: YES_NO }
    ] }
  ];
  var ITEMS = {};
  QUIZ.forEach(function (s) { s.items.forEach(function (it) { ITEMS[it.k] = it; }); });

  /** Pantallas que corresponden según haya foto (y si fue subida). */
  function quizFor(opts) {
    opts = opts || {};
    return QUIZ.filter(function (s) { return !s.photo || opts.photo; }).map(function (s) {
      return { id: s.id, title: s.title, intro: s.intro, items: s.items.filter(function (it) { return !it.upload || opts.upload; }) };
    });
  }
  function visibleItems(screen, a) { return screen.items.filter(function (it) { return !it.showIf || it.showIf(a || {}); }); }
  /** Preguntas visibles de la pantalla todavía sin responder (nunca se completa por defecto). */
  function missingIn(screen, a) {
    return visibleItems(screen, a).filter(function (it) { var v = a[it.k]; return it.multi ? !(Array.isArray(v) && v.length) : !v; }).map(function (it) { return it.k; });
  }

  /** Solo claves y valores conocidos. Lo no respondido queda null: nunca "no". */
  function cleanAnswers(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var a = {};
    Object.keys(ITEMS).forEach(function (k) {
      var it = ITEMS[k], ok = it.o.map(function (o) { return o[0]; }), v = raw[k];
      if (it.multi) {
        var list = (Array.isArray(v) ? v : []).filter(function (x, i, arr) { return ok.indexOf(x) >= 0 && arr.indexOf(x) === i; });
        if (it.exclusive && list.some(function (x) { return it.exclusive.indexOf(x) >= 0; })) list = list.filter(function (x) { return it.exclusive.indexOf(x) >= 0; }).slice(0, 1);
        a[k] = list.length ? list : null;
      } else a[k] = ok.indexOf(v) >= 0 ? v : null;
    });
    if (a.brillo_donde !== 'toda' && a.brillo_donde !== 'zona_t') a.brillo_cuando = null;
    return a;
  }
  function label(k, v) { var it = ITEMS[k]; var o = it && it.o.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : ''; }
  function has(list, v) { return Array.isArray(list) && list.indexOf(v) >= 0; }

  // ── Observaciones de la foto ─────────────────────────────────
  /**
   * @param m        mediciones del teléfono: shineT, shineC, redDiff, texture, toneCv, noseSpots, noseBlobs
   * @param q        calidad: pxPerMm, sideLight (true si la luz llega despareja), occluded {frente, nariz, mejilla_der, mejilla_izq}
   * @param regions  polígonos en píxeles de la imagen original: frente, nariz, mejilla_der, mejilla_izq
   * Devuelve una observación por categoría, con su estado. Solo las "observado" llevan geometría.
   */
  function observePhoto(m, q, regions) {
    m = m || {}; q = q || {}; regions = regions || {};
    var occ = q.occluded || {}, R = SKIN_RULES, out = [];
    var cheeks = ['mejilla_der', 'mejilla_izq'].filter(function (z) { return !occ[z] && regions[z]; });
    function geo(zones) {
      var polys = zones.map(function (z) { return regions[z]; }).filter(function (p) { return Array.isArray(p) && p.length >= 3; });
      return polys.length ? { type: 'region', polygons: polys } : null;
    }
    function push(cat, status, extra) {
      var o = { category: cat, label: CAT[cat].label, status: status, source: 'foto', zone: '', description: '', limitation: LIMITS[cat] || '', reason: '', geometry: null };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      if (o.status !== ST.SEEN) o.geometry = null;
      out.push(o);
    }
    var lowLight = q.sideLight ? 'La luz llega más de un lado de la cara.' : '';

    // Brillo: reflejos de luz en frente y nariz comparados con las mejillas.
    if (lowLight) push('brillo', ST.NA, { reason: lowLight });
    else if (occ.frente && occ.nariz) push('brillo', ST.NA, { reason: 'Frente y nariz no se ven bien en esta foto.' });
    else if (!isFinite(m.shineT) || !isFinite(m.shineC)) push('brillo', ST.NA, { reason: 'No se pudo medir en esta foto.' });
    else {
      var tz = ['frente', 'nariz'].filter(function (z) { return !occ[z]; });
      if (m.shineT >= R.shineT && m.shineC >= R.shineGeneralC && cheeks.length) push('brillo', ST.SEEN, { zone: 'frente, nariz y mejillas', description: 'Reflejos de luz repartidos en frente, nariz y mejillas.', geometry: geo(tz.concat(cheeks)) });
      else if (m.shineT >= R.shineT && m.shineT >= R.shineRatio * m.shineC + 0.01) push('brillo', ST.SEEN, { zone: tz.length === 2 ? 'frente y nariz' : tz[0], description: 'Reflejos de luz concentrados en ' + (tz.length === 2 ? 'frente y nariz' : 'la ' + tz[0]) + '.', geometry: geo(tz) });
      else push('brillo', ST.NOT_SEEN, { zone: 'frente, nariz y mejillas' });
    }

    push('poros', ST.NA, { reason: NOT_SUPPORTED.poros });

    // Textura: energía de bordes finos en las mejillas, relativa al brillo de la zona.
    if (!cheeks.length) push('textura', ST.NA, { reason: 'Las mejillas no se ven bien en esta foto.' });
    else if (!(q.pxPerMm >= NEEDS.textura.pxPerMm)) push('textura', ST.NA, { reason: 'La foto no tiene suficiente detalle: acercá un poco más la cámara.' });
    else if (!isFinite(m.texture)) push('textura', ST.NA, { reason: 'No se pudo medir en esta foto.' });
    else if (m.texture >= R.texture) push('textura', ST.SEEN, { zone: 'mejillas', description: 'Las mejillas muestran una superficie menos uniforme.', geometry: geo(cheeks) });
    else push('textura', ST.NOT_SEEN, { zone: 'mejillas' });

    // Puntitos oscuros en la nariz: más oscuros que la piel de alrededor, chicos y aislados. Sin conteo.
    if (occ.nariz || !regions.nariz) push('puntos_oscuros', ST.NA, { reason: 'La nariz no se ve bien en esta foto.' });
    else if (!(q.pxPerMm >= NEEDS.puntos_oscuros.pxPerMm)) push('puntos_oscuros', ST.NA, { reason: 'La foto no tiene suficiente detalle en la nariz: acercá un poco más la cámara.' });
    else if (!isFinite(m.noseSpots)) push('puntos_oscuros', ST.NA, { reason: 'No se pudo medir en esta foto.' });
    else if (m.noseSpots >= R.noseSpots || m.noseBlobs >= R.noseBlobs) push('puntos_oscuros', ST.SEEN, { zone: 'nariz', description: 'Puntitos más oscuros que la piel de alrededor, en la nariz.', geometry: geo(['nariz']) });
    else push('puntos_oscuros', ST.NOT_SEEN, { zone: 'nariz' });

    push('puntos_claros', ST.NA, { reason: NOT_SUPPORTED.puntos_claros });

    // Enrojecimiento: rojo relativo de las mejillas contra la frente (sin reflejos).
    if (lowLight) push('enrojecimiento', ST.NA, { reason: lowLight });
    else if (!cheeks.length || occ.frente) push('enrojecimiento', ST.NA, { reason: 'Hace falta ver bien la frente y las mejillas para comparar.' });
    else if (!isFinite(m.redDiff)) push('enrojecimiento', ST.NA, { reason: 'No se pudo medir en esta foto.' });
    else if (m.redDiff >= R.rednessDiff) push('enrojecimiento', ST.SEEN, { zone: 'mejillas', description: 'Las mejillas se ven más rojizas que la frente.', geometry: geo(cheeks) });
    else push('enrojecimiento', ST.NOT_SEEN, { zone: 'mejillas' });

    // Tono: variación del color en las mejillas, descontando la luz que cambia de a poco.
    if (lowLight) push('tono', ST.NA, { reason: lowLight });
    else if (!cheeks.length) push('tono', ST.NA, { reason: 'Las mejillas no se ven bien en esta foto.' });
    else if (!isFinite(m.toneCv)) push('tono', ST.NA, { reason: 'No se pudo medir en esta foto.' });
    else if (m.toneCv >= R.toneCv) push('tono', ST.SEEN, { zone: 'mejillas', description: 'Zonas más claras y más oscuras en las mejillas.', geometry: geo(cheeks) });
    else push('tono', ST.NOT_SEEN, { zone: 'mejillas' });

    push('descamacion', ST.NA, { reason: NOT_SUPPORTED.descamacion });
    return out;
  }

  /** Lo que la persona contó sobre la foto solo puede RESTAR evaluabilidad, nunca agregar hallazgos. */
  function applyPhotoContext(obs, a) {
    var because = {};
    if (a.en_cara === 'maquillaje') ['brillo', 'textura', 'puntos_oscuros', 'enrojecimiento', 'tono'].forEach(function (c) { because[c] = 'Tenías maquillaje: puede cubrir o cambiar lo que se ve.'; });
    else if (a.en_cara === 'crema') because.brillo = 'Tenías crema o protector: el brillo puede venir del producto.';
    if (a.filtro === 'si') ['textura', 'puntos_oscuros', 'enrojecimiento', 'tono'].forEach(function (c) { because[c] = because[c] || 'La foto tiene filtro: puede alisar o cambiar el color de la piel.'; });
    return obs.map(function (o) {
      var c = Object.assign({}, o);
      if (because[c.category] && c.status !== ST.NA) { c.status = ST.NA; c.reason = because[c.category]; c.geometry = null; c.description = ''; }
      if (a.filtro === 'nose' && c.status === ST.SEEN) c.limitation = c.limitation + ' Si la foto tiene filtro, puede verse distinto.';
      return c;
    });
  }

  // ── Informe ──────────────────────────────────────────────────
  function tendencyOf(a) {
    var oil = { toda: 2, zona_t: 1, poco: 0 }[a.brillo_donde];
    var t = { siempre: 2, aveces: 1, no: 0 }[a.tirantez], d = { seguido: 2, aveces: 1, no: 0 }[a.descamacion];
    var dry = (t === undefined && d === undefined) ? undefined : Math.max(t === undefined ? -1 : t, d === undefined ? -1 : d);
    var r = { key: null, label: '', certainty: '', note: '' };
    var partial = 'Es una orientación parcial: faltan datos sobre ';
    if (oil === undefined && dry === undefined) { r.note = 'Con tus respuestas no alcanza para orientar la tendencia de tu piel. La define la cosmetóloga en consulta.'; return r; }
    if (oil === undefined) {
      if (dry === 2) { r.key = 'seca'; r.certainty = 'parcial'; r.note = partial + 'el brillo.'; }
      else r.note = 'Faltan datos sobre el brillo para orientar la tendencia de tu piel.';
      return r;
    }
    if (dry === undefined) {
      if (oil === 2) { r.key = 'grasa'; r.certainty = 'parcial'; r.note = partial + 'tirantez y descamación.'; }
      else if (oil === 1) { r.key = 'mixta'; r.certainty = 'parcial'; r.note = partial + 'tirantez y descamación.'; }
      else r.note = 'Faltan datos sobre tirantez y descamación para orientar la tendencia de tu piel.';
      return r;
    }
    if (oil === 2 && dry === 2) { r.note = 'Contaste brillo en toda la cara y también tirantez o descamación seguido: las señales se cruzan y conviene definirlo en persona.'; return r; }
    r.certainty = 'moderada';
    if (oil === 2) r.key = 'grasa';
    else if (oil === 1) r.key = 'mixta';
    else if (dry >= 1) r.key = 'seca';
    else r.key = 'normal';
    return r;
  }
  var TENDENCY_LABEL = { grasa: 'grasa', mixta: 'mixta', seca: 'seca', normal: 'equilibrada (ni grasa ni seca)' };

  function declaredOf(a) {
    var d = [], add = function (id, text) { d.push({ id: id, source: 'cuestionario', text: text }); };
    if (a.brillo_donde === 'toda' || a.brillo_donde === 'zona_t') {
      add('DEC-BRILLO', 'Brillo ' + (a.brillo_donde === 'toda' ? 'en toda la cara' : 'en frente, nariz y mentón') +
        (a.brillo_cuando === 'rapido' ? ', a pocas horas de lavarte' : a.brillo_cuando === 'tarde' ? ', hacia la tarde' : '') + '.');
    } else if (a.brillo_donde === 'poco') add('DEC-BRILLO', 'Casi no te aparece brillo.');
    if (a.tirantez === 'siempre' || a.tirantez === 'aveces') add('DEC-TIRANTEZ', (a.tirantez === 'siempre' ? 'Casi siempre' : 'A veces') + ' sentís tirantez después de lavarte.');
    if (a.descamacion === 'seguido' || a.descamacion === 'aveces') add('DEC-DESCAMACION', (a.descamacion === 'seguido' ? 'Seguido' : 'A veces') + ' notás descamación.');
    if (a.reactividad === 'seguido' || a.reactividad === 'aveces') add('DEC-SENSIBILIDAD', 'Sensibilidad declarada: ' + (a.reactividad === 'seguido' ? 'seguido' : 'a veces') + ' sentís ardor, picazón o enrojecimiento con algunos productos.');
    else if (a.reactividad === 'no') add('DEC-SENSIBILIDAD', 'No solés reaccionar a los productos.');
    if (a.rutina) {
      if (has(a.rutina, 'nada')) add('DEC-RUTINA', 'Hoy casi no usás productos en la cara.');
      else add('DEC-RUTINA', 'Tu rutina: ' + a.rutina.map(function (v) { return label('rutina', v).toLowerCase(); }).join(', ') + '.');
    }
    if (a.objetivo) add('DEC-OBJETIVO', 'Lo que más te interesa: ' + label('objetivo', a.objetivo).toLowerCase() + '.');
    var rec = { retinoides: 'Usaste retinoides o ácidos exfoliantes en la última semana.', procedimiento: 'Te hiciste un procedimiento en la cara en el último mes.',
      sol: 'Tomaste mucho sol o te quemaste hace poco.', medicacion: 'Estás con medicación para la piel indicada por un médico.' };
    (a.recientes || []).forEach(function (v) { if (rec[v]) add('DEC-' + v.toUpperCase(), rec[v]); });
    return d;
  }

  function preReviewOf(a) {
    var r = [], add = function (id, kind, text) { r.push({ id: id, kind: kind, source: 'cuestionario', text: text }); };
    var med = [];
    if (a.sangrado === 'si') med.push('una lesión sangra sin que la lastimes');
    if (a.cambio === 'si') med.push('un lunar o una lesión cambió, o una herida no cicatriza');
    if (med.length) add('REV-MEDICA', 'medica', 'Contaste que ' + med.join(' y que ') + '. Antes de tratar esa zona, consultá con un médico o dermatólogo. La limpieza facial no es una solución para eso.');
    if (a.heridas === 'si') add('REV-HERIDAS', 'aviso', 'Contaste heridas abiertas o costras: esa zona no se trabaja hasta que cicatrice. Avisalo al reservar.');
    if (a.irritacion === 'si') add('REV-IRRITACION', 'aviso', 'Contaste una irritación intensa o una quemadura: conviene esperar a que se calme y, si no mejora, consultar con un médico. Avisalo al reservar.');
    if (a.dolor === 'si') add('REV-DOLOR', 'aviso', 'Contaste una zona que duele: la cosmetóloga la revisa antes de empezar y no la trabaja sin evaluarla. Si el dolor sigue, consultá con un médico.');
    if (has(a.recientes, 'medicacion')) add('REV-MEDICACION', 'aviso', 'Estás con medicación para la piel: contale cuál a la profesional al reservar, porque puede cambiar lo que se puede hacer.');
    if (has(a.recientes, 'procedimiento')) add('REV-PROCEDIMIENTO', 'aviso', 'Te hiciste un procedimiento en la cara en el último mes: contale cuál y cuándo a la profesional al reservar.');
    return r;
  }

  function orientationsOf(a, obs, tendency) {
    var seen = function (c) { return obs.some(function (o) { return o.category === c && o.status === ST.SEEN; }); };
    var goal = a.objetivo, out = [];
    function add(id, text, short, because, matchesGoal) {
      out.push({ id: id, text: text, short: short, because: because, goal: !!matchesGoal });
    }
    var b;
    // Puntitos oscuros → comedones aptos para extracción (valoración presencial).
    b = [];
    if (seen('puntos_oscuros')) b.push('En tu foto se ven puntitos oscuros en la nariz.');
    if (goal === 'puntos') b.push('Elegiste despejar puntitos oscuros o poros.');
    if (b.length) add('ORI-COMEDONES', 'Valorar en persona si hay comedones aptos para extracción. No todos los puntitos oscuros lo son ni se extraen todos en una sesión.', 'si hay comedones aptos para extracción', b, goal === 'puntos');
    // Brillo
    b = [];
    if (seen('brillo')) b.push('En tu foto se ven reflejos de luz en ' + obs.filter(function (o) { return o.category === 'brillo'; })[0].zone + '.');
    if (a.brillo_donde === 'toda' || a.brillo_donde === 'zona_t') b.push('Contaste brillo ' + (a.brillo_donde === 'toda' ? 'en toda la cara.' : 'en frente, nariz y mentón.'));
    if (goal === 'brillo') b.push('Elegiste tener menos brillo.');
    if (b.length) add('ORI-BRILLO', 'Trabajar la limpieza de las zonas con brillo. El brillo vuelve con los días: no es un cambio permanente.', 'la limpieza de las zonas con brillo', b, goal === 'brillo');
    // Tirantez / descamación / confort
    b = [];
    if (a.tirantez === 'siempre' || a.tirantez === 'aveces') b.push('Contaste tirantez después de lavarte.');
    if (a.descamacion === 'seguido' || a.descamacion === 'aveces') b.push('Contaste descamación.');
    if (goal === 'confort') b.push('Elegiste confort e hidratación.');
    if (b.length) add('ORI-CONFORT', 'Valorar cuidados orientados al confort y a la hidratación superficial.', 'cuidados para el confort y la hidratación superficial', b, goal === 'confort');
    // Tolerancia
    b = [];
    if (a.reactividad === 'seguido' || a.reactividad === 'aveces') b.push('Contaste ardor, picazón o enrojecimiento con algunos productos.');
    if (has(a.recientes, 'retinoides')) b.push('Usaste retinoides o ácidos en la última semana.');
    if (has(a.recientes, 'procedimiento')) b.push('Te hiciste un procedimiento en el último mes.');
    if (has(a.recientes, 'sol')) b.push('Tomaste mucho sol hace poco.');
    if (has(a.recientes, 'medicacion')) b.push('Estás con medicación para la piel.');
    if (seen('enrojecimiento')) b.push('En tu foto las mejillas se ven más rojizas que la frente.');
    if (b.length) add('ORI-TOLERANCIA', 'Revisar la tolerancia de tu piel antes de elegir productos y técnicas. Algunas pueden esperar a otra sesión.', 'la tolerancia de tu piel antes de elegir técnicas', b, false);
    // Textura
    b = [];
    if (seen('textura')) b.push('En tu foto las mejillas muestran una superficie menos uniforme.');
    if (goal === 'textura') b.push('Elegiste una piel más suave.');
    if (b.length) add('ORI-TEXTURA', 'Valorar qué exfoliación tolera tu piel para trabajar la suavidad.', 'qué exfoliación tolera tu piel', b, goal === 'textura');
    // Tono / luminosidad
    b = [];
    if (seen('tono')) b.push('En tu foto se ven zonas de tono desigual en las mejillas.');
    if (goal === 'luminosidad') b.push('Elegiste un aspecto más luminoso.');
    if (b.length) add('ORI-TONO', 'Una limpieza puede dar un aspecto más luminoso por unos días, pero no es un tratamiento para eliminar manchas ni emparejar el tono.', 'qué aspecto luminoso se puede lograr, sin tratar manchas', b, goal === 'luminosidad');
    if (goal === 'cuidado' || !out.length) {
      add('ORI-CUIDADO', 'Una sesión de 60 minutos con la ' + PRO + ', adaptada a lo que ella observe en persona.', 'cómo adaptar la sesión a tu piel',
        goal === 'cuidado' ? ['Elegiste darte un momento de cuidado.'] : ['No surgió un foco particular de tus fotos ni de tus respuestas.'], goal === 'cuidado');
    }
    // Primero lo que coincide con su objetivo.
    out.sort(function (x, y) { return (y.goal ? 1 : 0) - (x.goal ? 1 : 0); });
    return out;
  }

  function joinEs(list) { return list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1]; }
  var OBS_SHORT = { brillo: 'reflejos de luz en ', textura: 'una superficie menos uniforme en las ', puntos_oscuros: 'puntitos oscuros en la ', enrojecimiento: 'más rojez en las ', tono: 'tono desigual en las ' };

  function summaryOf(r, a) {
    var s = [], t = r.tendency, sens = a.reactividad === 'seguido' || a.reactividad === 'aveces';
    if (t.key) s.push('Por lo que contaste, tu piel tendería a ser ' + TENDENCY_LABEL[t.key] + (sens ? ', con sensibilidad a algunos productos' : '') + '.');
    else s.push(sens ? 'Contaste sensibilidad a algunos productos; la tendencia de tu piel la define la cosmetóloga en persona.' : 'La tendencia de tu piel la define la cosmetóloga en persona: tus respuestas no alcanzan para orientarla.');
    var seen = r.observations.filter(function (o) { return o.status === ST.SEEN; });
    if (r.photo !== 'analizada') s.push('No sumaste foto: el resultado sale de tus respuestas.');
    else if (seen.length) s.push('En tu foto se observan ' + joinEs(seen.slice(0, 3).map(function (o) { return OBS_SHORT[o.category] + o.zone; })) + '.');
    else if (r.observations.some(function (o) { return o.status === ST.NOT_SEEN; })) s.push('En tu foto no se observaron diferencias claras en lo que se pudo evaluar.');
    else s.push('Tu foto no permitió evaluar la piel con claridad.');
    if (r.preReview.some(function (p) { return p.kind === 'medica'; })) s.push('Antes de tratar la zona que nos contaste, conviene una consulta médica.');
    else if (r.orientations.length) {
      var o = r.orientations[0];
      s.push((o.goal && a.objetivo ? 'Para lo que buscás, en' : 'En') + ' la consulta se puede valorar ' + o.short + '.');
    }
    return s;
  }

  /**
   * Arma el informe con datos estructurados únicamente. No agrega lesiones, síntomas ni antecedentes.
   * @param photo { observations } o null si no hubo foto
   */
  function buildReport(rawAnswers, photo) {
    var a = cleanAnswers(rawAnswers);
    var obs = photo && Array.isArray(photo.observations) ? applyPhotoContext(photo.observations, a) : [];
    obs = obs.filter(validObservation);
    var seenN = 0;
    obs.forEach(function (o) { if (o.status === ST.SEEN) o.n = ++seenN; o.id = 'OBS-' + o.category; });
    var r = { version: VERSION, photo: photo ? 'analizada' : 'sin_foto', tendency: tendencyOf(a), observations: obs,
      declared: declaredOf(a), preReview: preReviewOf(a), disclaimer: DISCLAIMER };
    r.orientations = orientationsOf(a, obs, r.tendency);
    r.summary = summaryOf(r, a);
    var errs = validateReport(r);
    if (errs.length) throw new Error('Informe inválido: ' + errs.join('; '));
    return r;
  }

  function validPolygon(p) { return Array.isArray(p) && p.length >= 3 && p.every(function (pt) { return Array.isArray(pt) && isFinite(pt[0]) && isFinite(pt[1]) && pt[0] >= 0 && pt[1] >= 0; }); }
  function validObservation(o) {
    if (!o || !CAT[o.category] || [ST.SEEN, ST.NOT_SEEN, ST.NA].indexOf(o.status) < 0) return false;
    if (o.status === ST.SEEN) return !!o.description && (!o.geometry || (o.geometry.type === 'region' && o.geometry.polygons.length && o.geometry.polygons.every(validPolygon)));
    if (o.status === ST.NA) return !!o.reason && !o.geometry;
    return !o.geometry;
  }
  // Palabras que el informe nunca debe contener (diagnósticos, mediciones que el método no sostiene).
  var FORBIDDEN = /\b(acn[eé]|ros[aá]cea|melasma|dermatitis|psoriasis|eccema|c[aá]ncer|melanoma|sebo|nivel de hidrataci[oó]n|barrera|edad de la piel|puntaje|probabilidad)\b|%/i;
  function validateReport(r) {
    var e = [];
    if (!r || r.version !== VERSION) e.push('versión');
    (r.observations || []).forEach(function (o) { if (!validObservation(o)) e.push('observación ' + (o && o.category)); });
    if (!Array.isArray(r.summary) || r.summary.length < 2 || r.summary.length > 3) e.push('resumen');
    var text = JSON.stringify([r.summary, r.observations.map(function (o) { return [o.description, o.limitation, o.reason]; }), r.declared, r.orientations, r.preReview]);
    if (FORBIDDEN.test(text)) e.push('texto no permitido');
    if (/\(\d+\)/.test(text)) e.push('conteo');
    return e;
  }

  /** Versión compacta y en texto para enviar a la profesional (solo con consentimiento). Sin la foto. */
  function compactReport(r) {
    return {
      version: r.version, photo: r.photo,
      tendency: r.tendency.key ? TENDENCY_LABEL[r.tendency.key] + (r.tendency.certainty ? ' (' + r.tendency.certainty + ')' : '') : 'sin orientar',
      observations: r.observations.map(function (o) { return { category: o.category, status: o.status, text: o.status === ST.SEEN ? o.description : o.status === ST.NA ? o.reason : '' }; }),
      declared: r.declared.map(function (d) { return d.text; }),
      orientations: r.orientations.map(function (o) { return o.text; }),
      preReview: r.preReview.map(function (p) { return p.text; })
    };
  }

  var api = { VERSION: VERSION, PRO: PRO, DISCLAIMER: DISCLAIMER, ST: ST, CATEGORIES: CATEGORIES, CAT: CAT, SKIN_RULES: SKIN_RULES, NEEDS: NEEDS,
    QUIZ: QUIZ, quizFor: quizFor, visibleItems: visibleItems, missingIn: missingIn, cleanAnswers: cleanAnswers,
    observePhoto: observePhoto, applyPhotoContext: applyPhotoContext, buildReport: buildReport, validateReport: validateReport,
    compactReport: compactReport, TENDENCY_LABEL: TENDENCY_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCEval = api;
})(typeof window !== 'undefined' ? window : this);
