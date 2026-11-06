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
 * cada marca sale de una medición ubicada en la foto, y "no evaluable" distingue foto, contexto y detector.
 */
(function (root) {
  'use strict';

  var VERSION = 'v4-2026-11b'; // el servidor acepta el prefijo "v4-"
  var PRO = 'Lic. Jaqueline Mansilla';
  var DISCLAIMER = 'Evaluación orientativa con IA. La cosmetóloga confirma los hallazgos y los cuidados adecuados en consulta.';

  var ST = { SEEN: 'observado', NOT_SEEN: 'no_observado', NA: 'no_evaluable' };
  // Por qué algo no se evaluó. Se distingue para no culpar a la foto de un límite del detector:
  //   foto      la captura no alcanza (detalle, luz, zona tapada, reflejos): repetirla puede ayudar
  //   contexto  lo que contó la persona (maquillaje, crema, filtro)
  //   detector  el análisis automático todavía no mide esa categoría: repetir la foto no cambia nada
  var NA_KIND = { FOTO: 'foto', CONTEXTO: 'contexto', DETECTOR: 'detector' };

  // Categorías cosméticas, en el orden en que se muestran. color + número: nunca solo el color.
  var CATEGORIES = [
    { key: 'brillo', label: 'Brillo visible', color: '#a86a12' },
    { key: 'poros', label: 'Poros visibles', color: '#5b6b7a' },
    { key: 'textura', label: 'Textura irregular', color: '#3f6f93' },
    { key: 'puntos_oscuros', label: 'Puntitos oscuros', color: '#6b4fa0' },
    { key: 'puntos_claros', label: 'Puntitos claros', color: '#2f7d4f' },
    { key: 'enrojecimiento', label: 'Enrojecimiento visible', color: '#b4441a' },
    { key: 'tono', label: 'Tono desigual', color: '#0f6e66' },
    { key: 'descamacion', label: 'Descamación aparente', color: '#5b6b7a' }
  ];
  var CAT = {};
  CATEGORIES.forEach(function (c) { CAT[c.key] = c; });
  var ZONE_LABEL = { frente: 'frente', nariz: 'nariz', mejilla_der: 'mejilla derecha', mejilla_izq: 'mejilla izquierda' };

  // Umbrales PROVISORIOS de las mediciones (sin validar: calibrar con ?diagnostico=1 y fotos reales).
  // No se muestran como números ni se presentan como validados.
  var SKIN_RULES = { shineT: 0.05, shineGeneralC: 0.04, shineRatio: 2, shineZoneMin: 0.01, rednessDiff: 0.035, texture: 7, toneCv: 0.07,
    noseSpots: 3.5, noseBlobs: 3, lightSpots: 3 };
  // Detalle mínimo de la foto por categoría (píxeles por milímetro de piel). Es un límite de muestreo:
  // con menos, lo buscado ocupa 1 o 2 píxeles y no se distingue del ruido. Se evalúa en cada foto.
  var NEEDS = { textura: { pxPerMm: 2.5 }, puntos_oscuros: { pxPerMm: 3 }, puntos_claros: { pxPerMm: 3 } };

  // Categorías que el detector actual todavía no mide (no es un problema de la foto).
  var DETECTOR_GAP = {
    poros: 'El análisis automático todavía no mide poros. Los revisa la cosmetóloga con lupa.',
    descamacion: 'El análisis automático todavía no mide descamación. La revisa la cosmetóloga en persona.'
  };

  // Lo que dice cada tarjeta: qué se observa, qué significa (una frase) y qué se puede valorar en consulta.
  var CONTENT = {
    brillo: { desc: ['En la foto se aprecia más brillo en esta zona.', 'En la foto se aprecia más brillo en estas zonas.'],
      meaning: 'Puede estar influido por la iluminación o los productos aplicados.', consult: 'revisar esa zona junto con tu rutina de cuidado.' },
    textura: { desc: ['La superficie se ve menos uniforme en esta zona.', 'La superficie se ve menos uniforme en estas zonas.'],
      meaning: 'El vello, las sombras o la compresión de la foto pueden sumar a ese aspecto.', consult: 'ver la textura de cerca y qué exfoliación tolera tu piel.' },
    puntos_oscuros: { desc: ['Se ven puntitos más oscuros que la piel de alrededor.'],
      meaning: 'Pueden ser poros, sombras o vello: qué son lo confirma la cosmetóloga.', consult: 'revisar esos puntitos con lupa.' },
    puntos_claros: { desc: ['Se ven pequeños puntos más claros que la piel de alrededor.'],
      meaning: 'En una foto pueden confundirse con reflejos: qué son lo define la revisión en persona.', consult: 'revisarlos con lupa y buena luz.' },
    enrojecimiento: { desc: ['Esta zona se ve más rojiza que la frente.', 'Estas zonas se ven más rojizas que la frente.'],
      meaning: 'El lavado reciente, el calor o la luz pueden enrojecer la piel por un rato.', consult: 'ver cómo responde tu piel antes de elegir productos.' },
    tono: { desc: ['Se ven zonas más claras y más oscuras.'],
      meaning: 'Sombras, pecas o vello pueden sumar a ese aspecto.', consult: 'conversar qué luminosidad se puede esperar de una limpieza.' }
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
  function centroid(poly) {
    var x = 0, y = 0; poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return { x: x / poly.length, y: y / poly.length };
  }
  function polyRadius(poly) { // radio de un círculo de igual área
    var A = 0;
    for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; A += p[0] * q[1] - q[0] * p[1]; }
    return Math.sqrt(Math.abs(A) / 2 / Math.PI);
  }
  function inPoly(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function zoneText(zs) {
    var cheeks = zs.indexOf('mejilla_der') >= 0 && zs.indexOf('mejilla_izq') >= 0;
    var parts = zs.filter(function (z) { return !cheeks || z.indexOf('mejilla') < 0; }).map(function (z) { return ZONE_LABEL[z]; });
    if (cheeks) parts.push(parts.length ? 'mejillas' : 'ambas mejillas');
    return joinEs(parts);
  }

  /**
   * @param m        mediciones del teléfono. Valores generales (los que se guardan para calibrar): shineT, shineC, redDiff,
   *                 texture, toneCv, noseSpots, noseBlobs. Ubicación de la evidencia, en píxeles de la foto original:
   *                 shine {zona: {frac, x, y, spread}} (dónde están los reflejos), cheeks {mejilla: {texture, redDiff, toneCv}},
   *                 darkSpots [{x, y}] (puntitos oscuros en la nariz), lightSpots [{x, y}] (puntitos claros en las mejillas).
   * @param q        calidad: pxPerMm, sideLight (luz despareja), occluded {frente, nariz, mejilla_der, mejilla_izq}
   * @param regions  polígonos en píxeles de la imagen original: frente, nariz, mejilla_der, mejilla_izq
   * Devuelve una observación por categoría. Solo las "observado" llevan marcas, y cada marca sale de una medición:
   *   punto  círculo alrededor de la evidencia localizada (reflejos, puntitos)
   *   zona   número en el centro de la zona medida, sin delimitar nada (hallazgos extendidos como rojez o tono)
   */
  function observePhoto(m, q, regions) {
    m = m || {}; q = q || {}; regions = regions || {};
    var occ = q.occluded || {}, R = SKIN_RULES, out = [], ppm = q.pxPerMm > 0 ? q.pxPerMm : 3;
    var cheeks = ['mejilla_der', 'mejilla_izq'].filter(function (z) { return !occ[z] && regions[z]; });
    var hasPoly = function (z) { return Array.isArray(regions[z]) && regions[z].length >= 3; };
    function zoneMark(z) { if (!hasPoly(z)) return null; var c = centroid(regions[z]); return { kind: 'zona', zone: z, x: c.x, y: c.y, r: 0 }; }
    /** Círculo alrededor de la evidencia; si está muy repartida en la zona, se marca la zona (no se aparenta precisión). */
    function markAt(c, spread, z) {
      var minR = Math.max(8, 3 * ppm), maxR = hasPoly(z) ? polyRadius(regions[z]) * 0.9 : Infinity, want = 2 * (spread || 0) + minR * 0.5;
      if (want > maxR) return { kind: 'zona', zone: z, x: c.x, y: c.y, r: 0 };
      return { kind: 'punto', zone: z, x: c.x, y: c.y, r: Math.max(minR, want) };
    }
    function cluster(pts, z) {
      var c = { x: 0, y: 0 }; pts.forEach(function (p) { c.x += p.x; c.y += p.y; }); c.x /= pts.length; c.y /= pts.length;
      var s = 0; pts.forEach(function (p) { s += Math.pow(p.x - c.x, 2) + Math.pow(p.y - c.y, 2); });
      return markAt(c, Math.sqrt(s / pts.length), z);
    }
    /**
     * Puntitos agrupados por cercanía (a menos de ~5 mm entre sí): un círculo por grupo de 2 o más, hasta 3 por zona.
     * Si no hay grupos (puntitos sueltos y repartidos), se señala la zona: no se dibuja un círculo por cada detección.
     */
    function groupMarks(pts, z) {
      var link = 5 * ppm, left = pts.slice(), groups = [];
      while (left.length) {
        var g = [left.shift()];
        for (var i = 0; i < g.length; i++) for (var j = left.length - 1; j >= 0; j--) {
          if (Math.hypot(left[j].x - g[i].x, left[j].y - g[i].y) <= link) g.push(left.splice(j, 1)[0]);
        }
        groups.push(g);
      }
      var marks = groups.filter(function (g) { return g.length >= 2; }).sort(function (a, b) { return b.length - a.length; }).slice(0, 3)
        .map(function (g) { return cluster(g, z); });
      return marks.length ? marks : [zoneMark(z)];
    }
    function push(cat, status, extra) {
      var o = { category: cat, label: CAT[cat].label, status: status, source: 'foto', zone: '', zones: [], description: '', meaning: '', consult: '',
        limitation: '', reason: '', naKind: null, fix: null, geometry: null };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      if (status === ST.SEEN) {
        var C = CONTENT[cat];
        o.zone = zoneText(o.zones); o.description = C.desc[o.zones.length > 1 && C.desc[1] ? 1 : 0];
        o.meaning = o.limitation = C.meaning; o.consult = C.consult;
        var marks = (o.marks || []).filter(Boolean);
        o.geometry = marks.length ? { type: 'marks', marks: marks } : null;
      } else o.geometry = null;
      delete o.marks;
      out.push(o);
    }
    function na(cat, fix, reason) { push(cat, ST.NA, { naKind: NA_KIND.FOTO, fix: fix, reason: reason }); }
    var side = q.sideLight ? 'La luz llegó más de un lado de la cara.' : '';
    var lowDetail = 'La foto no tiene suficiente detalle de cerca.';

    // Brillo: reflejos de luz en frente y nariz comparados con las mejillas. La marca va donde están los reflejos.
    if (side) na('brillo', 'luz_lateral', side);
    else if (occ.frente && occ.nariz) na('brillo', 'tapado', 'Frente y nariz no se ven bien en esta foto.');
    else if (!isFinite(m.shineT) || !isFinite(m.shineC)) na('brillo', 'medicion', 'No se pudo medir en esta foto.');
    else {
      var tz = ['frente', 'nariz'].filter(function (z) { return !occ[z]; }), zs = null;
      if (m.shineT >= R.shineT && m.shineC >= R.shineGeneralC && cheeks.length) zs = tz.concat(cheeks);
      else if (m.shineT >= R.shineT && m.shineT >= R.shineRatio * m.shineC + 0.01) zs = tz;
      if (!zs) push('brillo', ST.NOT_SEEN);
      else {
        var sh = m.shine || {}, ev = zs.filter(function (z) { return sh[z] && sh[z].frac >= R.shineZoneMin && isFinite(sh[z].x); });
        if (ev.length) push('brillo', ST.SEEN, { zones: ev, marks: ev.map(function (z) { return markAt(sh[z], sh[z].spread, z); }) });
        else push('brillo', ST.SEEN, { zones: zs, marks: zs.map(zoneMark) });
      }
    }

    push('poros', ST.NA, { naKind: NA_KIND.DETECTOR, reason: DETECTOR_GAP.poros });

    // Mejillas: se mide cada una; se marcan solo las que superan el umbral.
    function cheekCat(cat, key, thr, avg, needs) {
      if (!cheeks.length) return na(cat, 'tapado', 'Las mejillas no se ven bien en esta foto.');
      if (needs && !(q.pxPerMm >= needs)) return na(cat, 'detalle', lowDetail);
      if (!isFinite(avg)) return na(cat, 'medicion', 'No se pudo medir en esta foto.');
      if (avg < thr) return push(cat, ST.NOT_SEEN);
      var per = m.cheeks || {}, zs = cheeks.filter(function (z) { return per[z] && per[z][key] >= thr; });
      if (!zs.length) zs = cheeks;
      push(cat, ST.SEEN, { zones: zs, marks: zs.map(zoneMark) });
    }
    cheekCat('textura', 'texture', R.texture, m.texture, NEEDS.textura.pxPerMm);

    // Puntitos oscuros en la nariz: más oscuros que la piel de alrededor, chicos y aislados. Sin conteo.
    if (occ.nariz || !hasPoly('nariz')) na('puntos_oscuros', 'tapado', 'La nariz no se ve bien en esta foto.');
    else if (!(q.pxPerMm >= NEEDS.puntos_oscuros.pxPerMm)) na('puntos_oscuros', 'detalle', lowDetail);
    else if (!isFinite(m.noseSpots)) na('puntos_oscuros', 'medicion', 'No se pudo medir en esta foto.');
    else if (m.noseSpots >= R.noseSpots || m.noseBlobs >= R.noseBlobs) {
      var ds = (m.darkSpots || []).filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
      push('puntos_oscuros', ST.SEEN, { zones: ['nariz'], marks: ds.length ? groupMarks(ds, 'nariz') : [zoneMark('nariz')] });
    } else push('puntos_oscuros', ST.NOT_SEEN);

    // Puntitos claros en las mejillas: más claros que su entorno, chicos, sin color (los reflejos fuertes se descartan antes).
    if (!cheeks.length) na('puntos_claros', 'tapado', 'Las mejillas no se ven bien en esta foto.');
    else if (side) na('puntos_claros', 'luz_lateral', side);
    else if (!(q.pxPerMm >= NEEDS.puntos_claros.pxPerMm)) na('puntos_claros', 'detalle', lowDetail);
    else if (!Array.isArray(m.lightSpots)) na('puntos_claros', 'medicion', 'No se pudo medir en esta foto.');
    else if (m.shineC >= R.shineGeneralC) na('puntos_claros', 'reflejos', 'Hay reflejos de luz en las mejillas: se confunden con puntitos claros.');
    else {
      var groups = {};
      m.lightSpots.forEach(function (p) {
        if (!isFinite(p.x) || !isFinite(p.y)) return;
        var z = cheeks.filter(function (c) { return inPoly(p, regions[c]); })[0];
        if (!z) { // cerca del borde de la zona: la mejilla más cercana
          z = cheeks.slice().sort(function (a, b) { var A = centroid(regions[a]), B = centroid(regions[b]); return Math.hypot(p.x - A.x, p.y - A.y) - Math.hypot(p.x - B.x, p.y - B.y); })[0];
        }
        (groups[z] = groups[z] || []).push(p);
      });
      var total = Object.keys(groups).reduce(function (s, z) { return s + groups[z].length; }, 0);
      if (total >= R.lightSpots) {
        var gz = cheeks.filter(function (z) { return groups[z]; });
        push('puntos_claros', ST.SEEN, { zones: gz, marks: [].concat.apply([], gz.map(function (z) { return groupMarks(groups[z], z); })) });
      } else push('puntos_claros', ST.NOT_SEEN);
    }

    // Enrojecimiento: rojo relativo de cada mejilla contra la frente (sin reflejos).
    if (side) na('enrojecimiento', 'luz_lateral', side);
    else if (cheeks.length && occ.frente) na('enrojecimiento', 'tapado', 'Hace falta ver bien la frente para comparar.');
    else cheekCat('enrojecimiento', 'redDiff', R.rednessDiff, m.redDiff);

    // Tono: variación del color en cada mejilla, descontando la luz que cambia de a poco.
    if (side) na('tono', 'luz_lateral', side);
    else cheekCat('tono', 'toneCv', R.toneCv, m.toneCv);

    push('descamacion', ST.NA, { naKind: NA_KIND.DETECTOR, reason: DETECTOR_GAP.descamacion });
    var order = CATEGORIES.map(function (c) { return c.key; });
    return out.sort(function (x, y) { return order.indexOf(x.category) - order.indexOf(y.category); });
  }

  /** Lo que la persona contó sobre la foto solo puede RESTAR evaluabilidad, nunca agregar hallazgos. */
  function applyPhotoContext(obs, a) {
    var because = {};
    if (a.en_cara === 'maquillaje') ['brillo', 'textura', 'puntos_oscuros', 'puntos_claros', 'enrojecimiento', 'tono'].forEach(function (c) { because[c] = ['maquillaje', 'Tenías maquillaje: puede cubrir o cambiar lo que se ve.']; });
    else if (a.en_cara === 'crema') ['brillo', 'puntos_claros'].forEach(function (c) { because[c] = ['crema', 'Tenías crema o protector: el producto puede dar brillo.']; });
    if (a.filtro === 'si') ['textura', 'puntos_oscuros', 'puntos_claros', 'enrojecimiento', 'tono'].forEach(function (c) { because[c] = because[c] || ['filtro', 'La foto tiene filtro: puede alisar o cambiar el color de la piel.']; });
    return obs.map(function (o) {
      var c = Object.assign({}, o);
      if (because[c.category] && c.status !== ST.NA) {
        c.status = ST.NA; c.naKind = NA_KIND.CONTEXTO; c.fix = because[c.category][0]; c.reason = because[c.category][1];
        c.geometry = null; c.description = c.meaning = c.consult = c.limitation = c.zone = ''; c.zones = [];
      }
      if (a.filtro === 'nose' && c.status === ST.SEEN) c.meaning = c.limitation = c.meaning + ' Si la foto tiene filtro, puede verse distinto.';
      return c;
    });
  }

  /**
   * ¿El problema es la captura? Solo cuando no hubo observaciones y la foto (o lo que contó la persona) dejó afuera
   * más categorías de las que se pudieron evaluar. Los límites del detector nunca piden repetir la foto.
   */
  var FIX_ORDER = ['maquillaje', 'tapado', 'luz_lateral', 'reflejos', 'detalle', 'filtro', 'crema', 'medicion'];
  var ADVICE = {
    detalle: 'No pudimos distinguir suficientes detalles. Repetí la foto con luz uniforme y acercá un poco más la cámara.',
    luz_lateral: 'La luz llegó despareja a tu cara. Repetí la foto de frente a una ventana, con luz uniforme.',
    tapado: 'Parte de tu cara quedó tapada o con sombra. Repetí la foto con la cara despejada.',
    reflejos: 'Hay reflejos de luz fuertes en la piel. Repetí la foto con una luz más suave.',
    maquillaje: 'Con maquillaje no podemos ver bien la piel. Si querés, repetí la foto con la cara lavada.',
    crema: 'La crema puede dar brillo en la foto. Si querés, repetí la foto con la cara lavada.',
    filtro: 'El filtro cambia cómo se ve la piel. Si podés, usá una foto sin filtro.',
    medicion: 'No pudimos analizar bien esta foto. Probá repetirla con luz uniforme.'
  };
  var TIP = {
    detalle: 'Para revisar más detalles, repetí la foto acercando un poco la cámara.',
    luz_lateral: 'Para evaluar también brillo, rojez y tono, repetí la foto con luz de frente.',
    tapado: 'Para evaluar toda la cara, repetí la foto con la cara despejada.',
    reflejos: 'Para revisar los puntitos claros, repetí la foto con una luz más suave.',
    maquillaje: ADVICE.maquillaje, crema: ADVICE.crema, filtro: ADVICE.filtro, medicion: ADVICE.medicion
  };
  function captureOf(obs, photo) {
    if (!photo) return null;
    var fixable = obs.filter(function (o) { return o.status === ST.NA && (o.naKind === NA_KIND.FOTO || o.naKind === NA_KIND.CONTEXTO); });
    if (!fixable.length) return null;
    // El motivo que deja afuera más categorías; a igualdad, el orden de FIX_ORDER.
    var count = function (f) { return fixable.filter(function (o) { return o.fix === f; }).length; };
    var fix = FIX_ORDER.slice().sort(function (x, y) { return count(y) - count(x) || FIX_ORDER.indexOf(x) - FIX_ORDER.indexOf(y); })[0];
    var seen = obs.some(function (o) { return o.status === ST.SEEN; }), notSeen = obs.filter(function (o) { return o.status === ST.NOT_SEEN; }).length;
    var blocking = !seen && fixable.length > notSeen;
    return { fix: fix, blocking: blocking, text: blocking ? ADVICE[fix] : TIP[fix] };
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

  function orientationsOf(a, obs) {
    var seenObs = function (c) { return obs.filter(function (o) { return o.category === c && o.status === ST.SEEN; })[0]; };
    var seen = function (c) { return !!seenObs(c); };
    var goal = a.objetivo, out = [];
    // short: lo que se muestra en "Qué podemos trabajar" · text: versión completa (para la profesional)
    function add(id, text, short, because, matchesGoal, cats) {
      var marks = (cats || []).map(seenObs).filter(Boolean).map(function (o) { return o.n; }).filter(Boolean);
      out.push({ id: id, text: text, short: short, because: because, goal: !!matchesGoal, marks: marks });
    }
    var b;
    b = [];
    if (seen('puntos_oscuros')) b.push('En tu foto se ven puntitos oscuros en la nariz.');
    if (goal === 'puntos') b.push('Elegiste despejar puntitos oscuros o poros.');
    if (b.length) add('ORI-COMEDONES', 'Valorar en persona si hay comedones aptos para extracción. No todos los puntitos oscuros lo son ni se extraen todos en una sesión.',
      'Revisar los puntitos oscuros y ver qué conviene hacer.', b, goal === 'puntos', ['puntos_oscuros']);
    if (seen('puntos_claros')) add('ORI-CLAROS', 'Revisar con lupa los puntitos claros que se ven en la foto antes de decidir si se trabajan.',
      'Revisar con lupa los puntitos claros.', ['En tu foto se ven puntitos claros en ' + seenObs('puntos_claros').zone + '.'], false, ['puntos_claros']);
    b = [];
    if (seen('brillo')) b.push('En tu foto se aprecia brillo en ' + seenObs('brillo').zone + '.');
    if (a.brillo_donde === 'toda' || a.brillo_donde === 'zona_t') b.push('Contaste brillo ' + (a.brillo_donde === 'toda' ? 'en toda la cara.' : 'en frente, nariz y mentón.'));
    if (goal === 'brillo') b.push('Elegiste tener menos brillo.');
    if (b.length) add('ORI-BRILLO', 'Trabajar la limpieza de las zonas con brillo. El brillo vuelve con los días: no es un cambio permanente.',
      'Limpieza profunda de las zonas con brillo.', b, goal === 'brillo', ['brillo']);
    b = [];
    if (a.tirantez === 'siempre' || a.tirantez === 'aveces') b.push('Contaste tirantez después de lavarte.');
    if (a.descamacion === 'seguido' || a.descamacion === 'aveces') b.push('Contaste descamación.');
    if (goal === 'confort') b.push('Elegiste confort e hidratación.');
    if (b.length) add('ORI-CONFORT', 'Valorar cuidados orientados al confort y a la hidratación superficial.', 'Confort e hidratación de la piel.', b, goal === 'confort');
    b = [];
    if (a.reactividad === 'seguido' || a.reactividad === 'aveces') b.push('Contaste ardor, picazón o enrojecimiento con algunos productos.');
    if (has(a.recientes, 'retinoides')) b.push('Usaste retinoides o ácidos en la última semana.');
    if (has(a.recientes, 'procedimiento')) b.push('Te hiciste un procedimiento en el último mes.');
    if (has(a.recientes, 'sol')) b.push('Tomaste mucho sol hace poco.');
    if (has(a.recientes, 'medicacion')) b.push('Estás con medicación para la piel.');
    if (seen('enrojecimiento')) b.push('En tu foto se ve más rojez en ' + seenObs('enrojecimiento').zone + '.');
    if (b.length) add('ORI-TOLERANCIA', 'Revisar la tolerancia de tu piel antes de elegir productos y técnicas. Algunas pueden esperar a otra sesión.',
      'Elegir productos y técnicas según lo que tolere tu piel.', b, false, ['enrojecimiento']);
    b = [];
    if (seen('textura')) b.push('En tu foto la superficie se ve menos uniforme en ' + seenObs('textura').zone + '.');
    if (goal === 'textura') b.push('Elegiste una piel más suave.');
    if (b.length) add('ORI-TEXTURA', 'Valorar qué exfoliación tolera tu piel para trabajar la suavidad.', 'Suavidad, con la exfoliación que tolere tu piel.', b, goal === 'textura', ['textura']);
    b = [];
    if (seen('tono')) b.push('En tu foto se ven zonas de tono desigual en ' + seenObs('tono').zone + '.');
    if (goal === 'luminosidad') b.push('Elegiste un aspecto más luminoso.');
    if (b.length) add('ORI-TONO', 'Una limpieza puede dar un aspecto más luminoso por unos días, pero no es un tratamiento para eliminar manchas ni emparejar el tono.',
      'Aspecto más luminoso (una limpieza no trata manchas).', b, goal === 'luminosidad', ['tono']);
    if (goal === 'cuidado' || !out.length) {
      add('ORI-CUIDADO', 'Una sesión de 60 minutos con la ' + PRO + ', adaptada a lo que ella observe en persona.', 'Una sesión adaptada a lo que observe la cosmetóloga.',
        goal === 'cuidado' ? ['Elegiste darte un momento de cuidado.'] : ['No surgió un foco particular de tus fotos ni de tus respuestas.'], goal === 'cuidado');
    }
    // Primero lo que coincide con su objetivo; después lo que se ve en la foto.
    var rank = function (o) { return (o.goal ? 2 : 0) + (o.marks.length ? 1 : 0); };
    out.forEach(function (o, i) { o._i = i; });
    out.sort(function (x, y) { return rank(y) - rank(x) || x._i - y._i; });
    out.forEach(function (o) { delete o._i; });
    return out;
  }

  function joinEs(list) { return list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1]; }
  var GOAL_CATS = { puntos: ['puntos_oscuros'], brillo: ['brillo'], textura: ['textura'], luminosidad: ['tono'] };

  /** Una o dos frases. No repite las tarjetas ni las advertencias. Sin datos para la tendencia, no la menciona. */
  function summaryOf(r, a) {
    var s = [], seen = r.observations.filter(function (o) { return o.status === ST.SEEN; });
    if (r.photo !== 'analizada') s.push('Sin foto, esta orientación sale solo de tus respuestas.');
    else if (r.capture && r.capture.blocking) s.push(r.capture.text);
    else if (seen.length) {
      var match = (GOAL_CATS[a.objetivo] || []).some(function (c) { return seen.some(function (o) { return o.category === c; }); });
      s.push(match ? 'Lo marcado en tu foto coincide con lo que buscás: ' + label('objetivo', a.objetivo).toLowerCase() + '.'
        : 'Marcamos en tu foto lo que conviene mirar de cerca en la consulta.');
    } else s.push('No encontramos detalles destacados en las zonas que pudimos evaluar.');
    var t = r.tendency, sens = a.reactividad === 'seguido' || a.reactividad === 'aveces';
    if (t.key) s.push('Por lo que contaste, tu piel tendería a ser ' + TENDENCY_LABEL[t.key] + (sens ? ', con sensibilidad a algunos productos' : '') + '.');
    else if (sens) s.push('Contaste sensibilidad a algunos productos.');
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
    r.capture = captureOf(obs, !!photo);
    r.orientations = orientationsOf(a, obs);
    r.work = r.orientations.slice(0, 3).map(function (o) { return { id: o.id, text: o.short, marks: o.marks }; });
    r.summary = summaryOf(r, a);
    var errs = validateReport(r);
    if (errs.length) throw new Error('Informe inválido: ' + errs.join('; '));
    return r;
  }

  function validMark(k) {
    return k && (k.kind === 'punto' || k.kind === 'zona') && ZONE_LABEL[k.zone] && [k.x, k.y, k.r].every(function (v) { return typeof v === 'number' && isFinite(v) && v >= 0; });
  }
  function validObservation(o) {
    if (!o || !CAT[o.category] || [ST.SEEN, ST.NOT_SEEN, ST.NA].indexOf(o.status) < 0) return false;
    if (o.status === ST.SEEN) return !!o.description && !!o.zone && (!o.geometry || (o.geometry.type === 'marks' && o.geometry.marks.length > 0 && o.geometry.marks.every(validMark)));
    if (o.status === ST.NA) return !!o.reason && !o.geometry;
    return !o.geometry;
  }
  // Palabras que el informe nunca debe contener (diagnósticos, mediciones que el método no sostiene).
  var FORBIDDEN = /\b(acn[eé]|ros[aá]cea|melasma|milium|milia|dermatitis|psoriasis|eccema|c[aá]ncer|melanoma|sebo|nivel de hidrataci[oó]n|barrera|edad de la piel|puntaje|probabilidad|sana)\b|%/i;
  function validateReport(r) {
    var e = [];
    if (!r || r.version !== VERSION) e.push('versión');
    (r.observations || []).forEach(function (o) { if (!validObservation(o)) e.push('observación ' + (o && o.category)); });
    if (!Array.isArray(r.summary) || r.summary.length < 1 || r.summary.length > 2) e.push('resumen');
    if (!Array.isArray(r.work) || r.work.length > 3) e.push('qué trabajar');
    var text = JSON.stringify([r.summary, r.observations.map(function (o) { return [o.description, o.meaning, o.consult, o.reason]; }), r.declared, r.orientations, r.preReview, r.capture]);
    if (FORBIDDEN.test(text)) e.push('texto no permitido');
    if (/\(\d+\)/.test(text)) e.push('conteo');
    return e;
  }

  /** Versión compacta y en texto para enviar a la profesional (solo con consentimiento). Sin la foto ni las marcas. */
  function compactReport(r) {
    var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
    return {
      version: r.version, photo: r.photo,
      tendency: r.tendency.key ? TENDENCY_LABEL[r.tendency.key] + (r.tendency.certainty ? ' (' + r.tendency.certainty + ')' : '') : 'sin orientar',
      observations: r.observations.map(function (o) {
        return { category: o.category, status: o.status, text: o.status === ST.SEEN ? cap(o.zone) + ': ' + o.description : o.status === ST.NA ? o.reason : '' };
      }),
      declared: r.declared.map(function (d) { return d.text; }),
      orientations: r.orientations.map(function (o) { return o.text; }),
      preReview: r.preReview.map(function (p) { return p.text; })
    };
  }

  var api = { VERSION: VERSION, PRO: PRO, DISCLAIMER: DISCLAIMER, ST: ST, NA_KIND: NA_KIND, CATEGORIES: CATEGORIES, CAT: CAT, ZONE_LABEL: ZONE_LABEL,
    SKIN_RULES: SKIN_RULES, NEEDS: NEEDS, QUIZ: QUIZ, quizFor: quizFor, visibleItems: visibleItems, missingIn: missingIn, cleanAnswers: cleanAnswers,
    observePhoto: observePhoto, applyPhotoContext: applyPhotoContext, buildReport: buildReport, validateReport: validateReport,
    compactReport: compactReport, TENDENCY_LABEL: TENDENCY_LABEL, label: label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCEval = api;
})(typeof window !== 'undefined' ? window : this);
