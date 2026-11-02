/**
 * Orientación cosmética: cuestionario + reglas explicables (+ indicadores medidos en la foto, si los hay).
 *
 * Reglas versionadas y revisables por la profesional. Cada conclusión lleva:
 *   - origin: 'cuestionario' | 'foto' | 'evaluación presencial'
 *   - rule:   identificador de la regla que la produjo
 * No se nombran enfermedades, no se recomiendan productos ni técnicas, no se deriva:
 * lo complejo queda "para evaluar en la consulta".
 */

var ORIENTATION_RULES_VERSION = 'v1-2026-11';

var ORIGIN_QUIZ = 'cuestionario';
var ORIGIN_PHOTO = 'foto';

/** Textos fijos por indicador medido en la foto (revisables por la profesional). */
var PHOTO_OBSERVATIONS_ = {
  brillo_zona_t: 'Se ven más reflejos de brillo en frente y nariz que en las mejillas.',
  brillo_general: 'Se ven reflejos de brillo en varias zonas del rostro.',
  textura_irregular: 'La textura de las mejillas se ve irregular.',
  tono_desparejo: 'El tono de las mejillas se ve desparejo.',
  enrojecimiento_visible: 'Las mejillas se ven más rojizas que la frente.'
};
var PHOTO_LIMITS_TEXT = 'Son mediciones de la foto: la luz y la cámara pueden cambiarlas. La profesional lo confirma en persona.';
var ORIGIN_VISIT = 'evaluación presencial';

/** Preguntas y respuestas válidas. Lo que no está acá se descarta. */
var QUIZ_SPEC_ = {
  brillo: ['toda', 'zona_t', 'no', 'nose'],
  tirantez: ['siempre', 'aveces', 'no', 'nose'],
  descamacion: ['si', 'aveces', 'no', 'nose'],
  reactividad: ['seguido', 'aveces', 'no', 'nose'],
  imperfecciones: { multi: ['puntos_negros', 'granitos', 'poros', 'textura', 'nada', 'nose'] },
  objetivo: ['suavidad', 'luminosidad', 'confort', 'limpieza', 'otro'],
  exfoliantes: ['si', 'no', 'nose'],
  exfoliantes_cual: ['exfoliante', 'retinoide', 'ambos', 'nose'],
  procedimiento: ['si', 'no', 'nose'],
  procedimiento_tipo: ['estetico', 'medico', 'otro'],
  lesiones: ['si', 'no']
};

/** Normaliza las respuestas: solo claves y valores conocidos; lo faltante queda como 'nose'. */
function cleanAnswers_(raw) {
  var a = {};
  raw = (raw && typeof raw === 'object') ? raw : {};
  Object.keys(QUIZ_SPEC_).forEach(function (k) {
    var spec = QUIZ_SPEC_[k], v = raw[k];
    if (spec.multi) {
      a[k] = (Array.isArray(v) ? v : []).filter(function (x, i, arr) { return spec.multi.indexOf(x) >= 0 && arr.indexOf(x) === i; });
    } else {
      a[k] = spec.indexOf(v) >= 0 ? v : null;
    }
  });
  if (a.exfoliantes !== 'si') a.exfoliantes_cual = null;
  if (a.procedimiento !== 'si') a.procedimiento_tipo = null;
  return a;
}

function item_(text, origin, rule) { return { text: text, origin: origin, rule: rule }; }

/**
 * Tipo de piel orientativo, solo con el cuestionario.
 * Brillo suma "grasa"; tirantez y descamación suman "seca". Si las dos señales son fuertes a la vez,
 * se muestra el tipo más probable con aviso (decisión de la clínica: no "por confirmar").
 */
function skinProfile_(a) {
  var oil = { toda: 2, zona_t: 1, no: 0 }[a.brillo];
  var dryParts = [{ siempre: 1, aveces: 0.5, no: 0 }[a.tirantez], { si: 1, aveces: 0.5, no: 0 }[a.descamacion]];
  var dryKnown = dryParts.filter(function (x) { return x !== undefined; });
  var dry = dryKnown.reduce(function (s, x) { return s + x; }, 0);
  var p = { type: 'Indeterminada', warning: '', rule: 'TIPO-00' };
  if (oil === undefined && !dryKnown.length) {
    p.warning = 'Con tus respuestas no alcanza para orientar un tipo de piel. Lo define la profesional en la consulta.';
    return p;
  }
  if (oil === undefined) {
    if (dry >= 1) { p.type = 'Seca'; p.rule = 'TIPO-01'; p.warning = 'No sabemos cómo se comporta el brillo de tu piel: es una orientación parcial.'; }
    else { p.warning = 'Faltan datos sobre el brillo de tu piel. Lo define la profesional en la consulta.'; }
    return p;
  }
  if (oil === 2 && dry >= 1.5) {
    p.type = 'Mixta'; p.rule = 'TIPO-02';
    p.warning = 'Tus respuestas no son del todo coincidentes (brillo en toda la cara y también tirantez o descamación). Mostramos el tipo más probable; lo confirma la profesional.';
    return p;
  }
  if (oil === 2) { p.type = 'Grasa'; p.rule = 'TIPO-03'; }
  else if (oil === 1) { p.type = 'Mixta'; p.rule = 'TIPO-04'; }
  else if (dry >= 1) { p.type = 'Seca'; p.rule = 'TIPO-05'; }
  else if (dryKnown.length === 2) { p.type = 'Equilibrada'; p.rule = 'TIPO-06'; }
  else { p.type = 'Equilibrada'; p.rule = 'TIPO-07'; p.warning = 'Faltan algunas respuestas: es una orientación parcial.'; }
  return p;
}

/**
 * @param a        respuestas limpias (cleanAnswers_)
 * @param findings indicadores medidos en la foto (PHOTO_FINDINGS), vacío si no hubo foto
 * @param photo    'analizada' | 'sin_foto'
 */
function buildOrientation_(a, findings, photo) {
  findings = findings || [];
  var has = function (cat) { return findings.indexOf(cat) >= 0; };
  var imp = a.imperfecciones || [];
  var profile = skinProfile_(a);
  var out = {
    rulesVersion: ORIENTATION_RULES_VERSION,
    profile: { type: profile.type, warning: profile.warning, origin: ORIGIN_QUIZ, rule: profile.rule },
    needs: [], observations: [], benefits: [], limits: [], toEvaluate: [], tips: [], photo: photo,
    photoLimits: photo === 'analizada' ? PHOTO_LIMITS_TEXT : ''
  };

  // B. Necesidades referidas (dimensiones separadas del tipo de piel)
  if (a.reactividad === 'seguido') out.needs.push(item_('Sensibilidad: contaste que tu piel suele arder, picar o enrojecerse con productos.', ORIGIN_QUIZ, 'NEC-SENS-1'));
  else if (a.reactividad === 'aveces') out.needs.push(item_('Posible sensibilidad: a veces tu piel reacciona con algunos productos.', ORIGIN_QUIZ, 'NEC-SENS-2'));
  if (a.tirantez === 'siempre' || a.tirantez === 'aveces') {
    out.needs.push(item_('Posible falta de hidratación: contaste tirantez después de lavarte. No es una medición; lo confirma la profesional.', ORIGIN_QUIZ, 'NEC-HID-1'));
  }
  if (a.descamacion === 'si' || a.descamacion === 'aveces') out.needs.push(item_('Sensación de sequedad o zonas ásperas, según contaste.', ORIGIN_QUIZ, 'NEC-SEC-1'));

  // C. Observaciones de la foto (indicadores medidos en el teléfono)
  findings.forEach(function (f) { if (PHOTO_OBSERVATIONS_[f]) out.observations.push(item_(PHOTO_OBSERVATIONS_[f], ORIGIN_PHOTO, 'OBS-' + f)); });

  // D. Qué podría aportar una limpieza facial (según lo encontrado)
  var b = function (text, origin, rule) { if (!out.benefits.some(function (x) { return x.rule === rule; })) out.benefits.push(item_(text, origin, rule)); };
  var src = function (fromPhoto) { return fromPhoto ? ORIGIN_PHOTO : ORIGIN_QUIZ; };
  if (imp.indexOf('puntos_negros') >= 0)
    b('Despejar los puntos negros que la profesional considere aptos para extracción.', ORIGIN_QUIZ, 'BEN-PN');
  if (has('brillo_zona_t') || has('brillo_general') || a.brillo === 'toda' || a.brillo === 'zona_t')
    b('Sensación de piel más limpia y con menos brillo después de la sesión. El brillo vuelve con los días.', src(has('brillo_zona_t') || has('brillo_general')), 'BEN-BRI');
  if (imp.indexOf('poros') >= 0)
    b('Poros con aspecto más limpio. No se cierran de forma permanente.', ORIGIN_QUIZ, 'BEN-POR');
  if (has('textura_irregular') || imp.indexOf('textura') >= 0 || a.objetivo === 'suavidad')
    b('Piel más suave al tacto.', src(has('textura_irregular')), 'BEN-TEX');
  if (a.tirantez === 'siempre' || a.descamacion === 'si' || a.objetivo === 'confort')
    b('Más confort e hidratación superficial al terminar la sesión.', ORIGIN_QUIZ, 'BEN-CONF');
  if (has('tono_desparejo') || a.objetivo === 'luminosidad')
    b('Aspecto más luminoso durante los días siguientes.', src(has('tono_desparejo')), 'BEN-LUM');
  if (a.objetivo === 'limpieza' || !out.benefits.length)
    b('Limpieza profunda de residuos e impurezas acumuladas.', ORIGIN_QUIZ, 'BEN-LIMP');
  out.limits.push(item_('Una sesión no cierra poros de forma permanente, no borra marcas ni resuelve imperfecciones de fondo. El resultado depende de tu piel y de lo que defina la profesional.', ORIGIN_VISIT, 'LIM-1'));

  // Para evaluar en la consulta (no se deriva: queda a criterio de la profesional)
  var e = function (text, origin, rule) { out.toEvaluate.push(item_(text, origin, rule)); };
  if (a.lesiones === 'si') e('Contaste irritación fuerte, heridas, lesiones que duelen o algo que cambia o sangra. La profesional lo evalúa en persona antes de definir cualquier procedimiento.', ORIGIN_QUIZ, 'EVA-LES');
  if (has('enrojecimiento_visible') || a.reactividad === 'seguido') e('La profesional adapta la sesión a la tolerancia de tu piel.', has('enrojecimiento_visible') ? ORIGIN_PHOTO : ORIGIN_QUIZ, 'EVA-SENS');
  if (a.exfoliantes === 'si') e('Usás exfoliantes o retinoides: la profesional lo tiene en cuenta para decidir qué se puede hacer en esta sesión.', ORIGIN_QUIZ, 'EVA-EXF');
  if (a.procedimiento === 'si') e('Te hiciste un procedimiento o tratamiento en el último mes: contáselo a la profesional en la consulta.', ORIGIN_QUIZ, 'EVA-PROC');
  if (profile.warning) e('Tu tipo de piel lo confirma la profesional en la consulta.', ORIGIN_VISIT, 'EVA-TIPO');

  // Cuidados básicos (cortos, sin productos ni marcas)
  out.tips.push(item_('Lavá tu cara con suavidad, a la mañana y a la noche.', ORIGIN_QUIZ, 'TIP-1'));
  out.tips.push(item_('Usá protector solar todos los días.', ORIGIN_QUIZ, 'TIP-2'));
  if (a.reactividad === 'seguido' || a.reactividad === 'aveces') out.tips.push(item_('Probá un producto nuevo por vez.', ORIGIN_QUIZ, 'TIP-SENS'));
  else if (profile.type === 'Seca' || a.tirantez === 'siempre') out.tips.push(item_('Hidratá tu piel todos los días, sobre todo después de lavarla.', ORIGIN_QUIZ, 'TIP-SECA'));
  else if (profile.type === 'Grasa' || profile.type === 'Mixta') out.tips.push(item_('Elegí una hidratación liviana.', ORIGIN_QUIZ, 'TIP-GRASA'));

  return out;
}
