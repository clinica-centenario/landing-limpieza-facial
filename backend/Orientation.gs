/**
 * Orientación cosmética: indicadores medidos en la foto + 4 preguntas + reglas explicables.
 *
 * Reglas versionadas y revisables por la profesional. Cada conclusión lleva:
 *   - origin: 'foto' | 'cuestionario' | 'foto y cuestionario' | 'evaluación presencial'
 *   - rule:   identificador de la regla que la produjo
 * No se nombran enfermedades, no se recomiendan productos ni técnicas, no se deriva:
 * lo complejo queda "para evaluar en la consulta".
 */

var ORIENTATION_RULES_VERSION = 'v2-2026-11';

var ORIGIN_QUIZ = 'cuestionario';
var ORIGIN_PHOTO = 'foto';
var ORIGIN_BOTH = 'foto y cuestionario';
var ORIGIN_VISIT = 'evaluación presencial';

/** Textos fijos por indicador medido en la foto (revisables por la profesional). */
var PHOTO_OBSERVATIONS_ = {
  brillo_zona_t: 'Brillo concentrado en frente y nariz.',
  brillo_general: 'Brillo repartido en varias zonas del rostro.',
  textura_irregular: 'Textura irregular en las mejillas.',
  tono_desparejo: 'Tono desparejo en las mejillas.',
  enrojecimiento_visible: 'Mejillas más rojizas que la frente.',
  puntos_negros_posibles: 'Posibles puntos negros en la nariz.',
  poros_visibles_posibles: 'Poros visibles en las mejillas, cerca de la nariz.'
};
// Indicadores con detección todavía en prueba: la landing los marca como tales.
var PHOTO_BETA_ = ['puntos_negros_posibles', 'poros_visibles_posibles'];
var PHOTO_LIMITS_TEXT = 'Son mediciones de tus fotos: la luz, la cámara y la hora del día pueden cambiarlas. La profesional lo confirma en persona.';

/** Preguntas y respuestas válidas. Lo que no está acá se descarta. 'brillo' solo se pregunta si no hay foto. */
var QUIZ_SPEC_ = {
  sequedad: ['siempre', 'aveces', 'no', 'nose'],
  reactividad: ['seguido', 'aveces', 'no', 'nose'],
  mejorar: { multi: ['puntos_negros', 'poros', 'suavidad', 'luminosidad', 'confort', 'brillo'], max: 2 },
  aplica: { multi: ['exfoliantes', 'procedimiento', 'lesiones', 'ninguna'] },
  brillo: ['toda', 'zona_t', 'no', 'nose']
};

/** Normaliza las respuestas: solo claves y valores conocidos; lo faltante queda vacío. */
function cleanAnswers_(raw) {
  var a = {};
  raw = (raw && typeof raw === 'object') ? raw : {};
  Object.keys(QUIZ_SPEC_).forEach(function (k) {
    var spec = QUIZ_SPEC_[k], v = raw[k];
    if (spec.multi) {
      var list = (Array.isArray(v) ? v : []).filter(function (x, i, arr) { return spec.multi.indexOf(x) >= 0 && arr.indexOf(x) === i; });
      a[k] = spec.max ? list.slice(0, spec.max) : list;
    } else {
      a[k] = spec.indexOf(v) >= 0 ? v : null;
    }
  });
  if (a.aplica.indexOf('ninguna') >= 0) a.aplica = ['ninguna'];
  return a;
}

function item_(text, origin, rule) { return { text: text, origin: origin, rule: rule }; }

/**
 * Tipo de piel orientativo.
 * Brillo: de la foto si la hay (brillo general = 2, zona T = 1, sin brillo medido = 0), si no, de la pregunta.
 * Sequedad (tirantez o descamación después de lavarse): siempre de la pregunta.
 * Si las dos señales son fuertes a la vez, se muestra el tipo más probable con aviso.
 */
function skinProfile_(a, findings, hasPhoto) {
  var oil, oilOrigin;
  if (hasPhoto) {
    oil = findings.indexOf('brillo_general') >= 0 ? 2 : findings.indexOf('brillo_zona_t') >= 0 ? 1 : 0;
    oilOrigin = ORIGIN_PHOTO;
  } else {
    oil = { toda: 2, zona_t: 1, no: 0 }[a.brillo];
    oilOrigin = ORIGIN_QUIZ;
  }
  var dry = { siempre: 2, aveces: 1, no: 0 }[a.sequedad];
  var origin = dry === undefined ? oilOrigin : (oilOrigin === ORIGIN_PHOTO ? ORIGIN_BOTH : ORIGIN_QUIZ);
  var p = { type: 'Indeterminada', warning: '', rule: 'TIPO-00', origin: origin };
  if (oil === undefined && dry === undefined) {
    p.origin = ORIGIN_VISIT;
    p.warning = 'Con estos datos no alcanza para orientar un tipo de piel. Lo define la profesional en la consulta.';
    return p;
  }
  if (oil === undefined) {
    p.origin = ORIGIN_QUIZ;
    if (dry === 2) { p.type = 'Seca'; p.rule = 'TIPO-01'; p.warning = 'No sabemos cómo se comporta el brillo de tu piel: es una orientación parcial.'; }
    else p.warning = 'Faltan datos sobre el brillo de tu piel. Lo define la profesional en la consulta.';
    return p;
  }
  if (oil === 2 && dry === 2) {
    p.type = 'Mixta'; p.rule = 'TIPO-02';
    p.warning = 'Las señales no son del todo coincidentes (brillo en toda la cara y también tirantez o descamación). Mostramos el tipo más probable; lo confirma la profesional.';
    return p;
  }
  if (oil === 2) { p.type = 'Grasa'; p.rule = 'TIPO-03'; }
  else if (oil === 1) { p.type = 'Mixta'; p.rule = 'TIPO-04'; }
  else if (dry >= 1) { p.type = 'Seca'; p.rule = 'TIPO-05'; }
  else if (dry === 0) { p.type = 'Normal'; p.rule = 'TIPO-06'; }
  else { p.type = 'Normal'; p.rule = 'TIPO-07'; p.warning = 'Falta saber si tu piel tira o se descama: es una orientación parcial.'; }
  if (hasPhoto && oil === 0 && p.type === 'Normal' && !p.warning) {
    p.warning = 'En tus fotos no se midió brillo. Si te lavaste la cara hace poco, el brillo puede no notarse todavía.';
  }
  return p;
}

/**
 * @param a        respuestas limpias (cleanAnswers_)
 * @param findings indicadores medidos en la foto (PHOTO_FINDINGS), vacío si no hubo foto
 * @param photo    'analizada' | 'sin_foto'
 */
function buildOrientation_(a, findings, photo) {
  findings = findings || [];
  var hasPhoto = photo === 'analizada';
  var has = function (cat) { return findings.indexOf(cat) >= 0; };
  var wants = function (k) { return (a.mejorar || []).indexOf(k) >= 0; };
  var applies = function (k) { return (a.aplica || []).indexOf(k) >= 0; };
  var profile = skinProfile_(a, findings, hasPhoto);
  var out = {
    rulesVersion: ORIENTATION_RULES_VERSION,
    profile: { type: profile.type, warning: profile.warning, origin: profile.origin, rule: profile.rule },
    observations: [], needs: [], benefits: [], limits: [], toEvaluate: [], tips: [], photo: photo,
    photoLimits: hasPhoto ? PHOTO_LIMITS_TEXT : ''
  };

  // Lo que identificamos en la piel (indicadores medidos en el teléfono)
  findings.forEach(function (f) {
    if (!PHOTO_OBSERVATIONS_[f]) return;
    var it = item_(PHOTO_OBSERVATIONS_[f], ORIGIN_PHOTO, 'OBS-' + f);
    if (PHOTO_BETA_.indexOf(f) >= 0) it.beta = true;
    out.observations.push(it);
  });

  // Necesidades referidas (dimensiones separadas del tipo de piel)
  if (a.reactividad === 'seguido') out.needs.push(item_('Sensibilidad: contaste que tu piel suele arder, picar o enrojecerse con productos.', ORIGIN_QUIZ, 'NEC-SENS-1'));
  else if (a.reactividad === 'aveces') out.needs.push(item_('Posible sensibilidad: a veces tu piel reacciona con algunos productos.', ORIGIN_QUIZ, 'NEC-SENS-2'));
  if (a.sequedad === 'siempre' || a.sequedad === 'aveces') {
    out.needs.push(item_('Posible falta de hidratación: contaste tirantez o descamación después de lavarte. No es una medición; lo confirma la profesional.', ORIGIN_QUIZ, 'NEC-HID-1'));
  }

  // Qué podría aportar una limpieza facial (según lo encontrado y lo que quiere mejorar)
  var b = function (text, origin, rule) { if (!out.benefits.some(function (x) { return x.rule === rule; })) out.benefits.push(item_(text, origin, rule)); };
  var src = function (fromPhoto, fromQuiz) { return fromPhoto && fromQuiz ? ORIGIN_BOTH : fromPhoto ? ORIGIN_PHOTO : ORIGIN_QUIZ; };
  var pn = has('puntos_negros_posibles'), pnQ = wants('puntos_negros');
  if (pn || pnQ) b('Despejar los puntos negros que la profesional considere aptos para extracción.', src(pn, pnQ), 'BEN-PN');
  var sh = has('brillo_zona_t') || has('brillo_general'), shQ = wants('brillo') || a.brillo === 'toda' || a.brillo === 'zona_t';
  if (sh || shQ) b('Sensación de piel más limpia y con menos brillo después de la sesión. El brillo vuelve con los días.', src(sh, shQ), 'BEN-BRI');
  var po = has('poros_visibles_posibles'), poQ = wants('poros');
  if (po || poQ) b('Poros con aspecto más limpio. No se cierran de forma permanente.', src(po, poQ), 'BEN-POR');
  var tx = has('textura_irregular'), txQ = wants('suavidad');
  if (tx || txQ) b('Piel más suave al tacto.', src(tx, txQ), 'BEN-TEX');
  if (a.sequedad === 'siempre' || wants('confort')) b('Más confort e hidratación superficial al terminar la sesión.', ORIGIN_QUIZ, 'BEN-CONF');
  var tn = has('tono_desparejo'), tnQ = wants('luminosidad');
  if (tn || tnQ) b('Aspecto más luminoso durante los días siguientes.', src(tn, tnQ), 'BEN-LUM');
  if (!out.benefits.length) b('Limpieza profunda de residuos e impurezas acumuladas.', ORIGIN_QUIZ, 'BEN-LIMP');
  out.limits.push(item_('Una sesión no cierra poros de forma permanente, no borra marcas ni resuelve imperfecciones de fondo. El resultado depende de tu piel y de lo que defina la profesional.', ORIGIN_VISIT, 'LIM-1'));

  // Para evaluar en la consulta (no se deriva: queda a criterio de la profesional)
  var e = function (text, origin, rule) { out.toEvaluate.push(item_(text, origin, rule)); };
  if (applies('lesiones')) e('Contaste irritación fuerte, heridas, lesiones que duelen o algo que cambia o sangra. La profesional lo evalúa en persona antes de definir cualquier procedimiento.', ORIGIN_QUIZ, 'EVA-LES');
  if (has('enrojecimiento_visible') || a.reactividad === 'seguido') e('La profesional adapta la sesión a la tolerancia de tu piel.', has('enrojecimiento_visible') ? ORIGIN_PHOTO : ORIGIN_QUIZ, 'EVA-SENS');
  if (applies('exfoliantes')) e('Usás exfoliantes o retinoides: la profesional lo tiene en cuenta para decidir qué se puede hacer en esta sesión.', ORIGIN_QUIZ, 'EVA-EXF');
  if (applies('procedimiento')) e('Te hiciste un procedimiento o tratamiento en el último mes: contáselo a la profesional en la consulta.', ORIGIN_QUIZ, 'EVA-PROC');
  if (out.observations.some(function (o) { return o.beta; })) e('Los puntos negros y poros los confirma la profesional: esa parte del análisis está en prueba.', ORIGIN_VISIT, 'EVA-BETA');
  if (profile.warning) e('Tu tipo de piel lo confirma la profesional en la consulta.', ORIGIN_VISIT, 'EVA-TIPO');

  // Cuidados básicos (cortos, sin productos ni marcas)
  out.tips.push(item_('Lavá tu cara con suavidad, a la mañana y a la noche.', ORIGIN_QUIZ, 'TIP-1'));
  out.tips.push(item_('Usá protector solar todos los días.', ORIGIN_QUIZ, 'TIP-2'));
  if (a.reactividad === 'seguido' || a.reactividad === 'aveces') out.tips.push(item_('Probá un producto nuevo por vez.', ORIGIN_QUIZ, 'TIP-SENS'));
  else if (profile.type === 'Seca' || a.sequedad === 'siempre') out.tips.push(item_('Hidratá tu piel todos los días, sobre todo después de lavarla.', ORIGIN_QUIZ, 'TIP-SECA'));
  else if (profile.type === 'Grasa' || profile.type === 'Mixta') out.tips.push(item_('Elegí una hidratación liviana.', ORIGIN_QUIZ, 'TIP-GRASA'));

  return out;
}
