/**
 * API SIMULADA — solo para revisar la experiencia en local (?demo=1 en localhost).
 * No guarda nada, no toca Google y la página muestra un aviso permanente de MODO DEMO.
 * No se incluye en producción: app.js solo la usa si API_URL está vacío y el host es local.
 * Parámetros de prueba: &conflict=1 (el primer intento de reserva choca) · &empty=1 (sin horarios) · &wa=59899123456 (WhatsApp)
 */
(function () {
  var q = new URLSearchParams(location.search);
  var conflictOnce = q.get('conflict') === '1';
  var booked = {};
  var leads = {};
  function delay(v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 500); }); }
  function ymdAdd(ymd, n) { var a = ymd.split('-'); var d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n, 15)); return d.toISOString().slice(0, 10); }
  // Igual que el servidor: un horario por franja (13–15, 15–18, 18–21), el más próximo; page pide los siguientes.
  var BANDS = [['Primera hora de la tarde', 13 * 60, 15 * 60], ['Media tarde', 15 * 60, 18 * 60], ['Noche', 18 * 60, 21 * 60]];
  function recommend(page, exclude) {
    if (q.get('empty') === '1') return { slots: [], hasMore: false };
    var now = Date.now(), soon = now + 24 * 3600000, buckets = BANDS.map(function () { return []; });
    slotsFor(new Date(now - 3 * 3600000).toISOString().slice(0, 10), 21).forEach(function (s) {
      if (s.start === exclude) return;
      var t = +s.time.slice(0, 2) * 60 + +s.time.slice(3);
      BANDS.forEach(function (b, i) { if (t >= b[1] && t < b[2]) buckets[i].push(s); });
    });
    var out = [];
    buckets.forEach(function (list, i) { var s = list[page]; if (s) { s.band = BANDS[i][0]; s.soon = new Date(s.start).getTime() <= soon; out.push(s); } });
    out.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    return { slots: out, hasMore: buckets.some(function (l) { return l.length > page + 1; }) && page < 4 };
  }
  function slotsFor(from, days) {
    var out = [], now = Date.now();
    for (var i = 0; i < days; i++) {
      var ymd = ymdAdd(from, i), d = new Date(ymd + 'T12:00:00-03:00'), dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      for (var t = 13 * 60; t <= 20 * 60; t += 30) {
        var seed = (+ymd.replace(/-/g, '') + t) % 7;
        if (seed === 0 || seed === 3) continue; // ocupados ficticios
        var hh = ('0' + Math.floor(t / 60)).slice(-2), mm = ('0' + (t % 60)).slice(-2);
        var start = new Date(ymd + 'T' + hh + ':' + mm + ':00-03:00');
        if (start.getTime() < now || booked[start.toISOString()]) continue;
        out.push({ start: start.toISOString(), date: ymd, time: hh + ':' + mm });
      }
    }
    return out;
  }
  window.CCDemoApi = {
    handle: function (b) {
      if (b.action === 'lead') {
        var id = 'CC-DEMO-' + Math.random().toString(16).slice(2, 8).toUpperCase();
        leads[id] = true;
        return delay({ ok: true, requestId: id, token: 'demo', leadEventId: 'lead_' + id }, 700);
      }
      if (b.action === 'availability') {
        var r = recommend(b.page || 0);
        return delay({ ok: true, page: b.page || 0, slots: r.slots, hasMore: r.hasMore, withinHours: 24, durationMin: 60, whatsapp: q.get('wa') || '', timezone: 'America/Montevideo' }, 600);
      }
      if (b.action === 'track') return delay({ ok: true }, 50);
      if (b.action === 'analyze') {
        // Vista previa: el servidor no se usa. Perfil fijo de ejemplo; la foto usa lo medido en el teléfono.
        var Q = 'cuestionario', F = 'foto', V = 'evaluación presencial', ph = b.photo, has = function (k) { return ph && ph.findings.indexOf(k) >= 0; };
        var TXT = { brillo_zona_t: 'Brillo concentrado en frente y nariz.', brillo_general: 'Brillo repartido en varias zonas del rostro.',
          textura_irregular: 'Textura irregular en las mejillas.', tono_desparejo: 'Tono desparejo en las mejillas.', enrojecimiento_visible: 'Mejillas más rojizas que la frente.',
          puntos_negros_posibles: 'Posibles puntos negros en la nariz', poros_visibles_posibles: 'Poros visibles en las mejillas, cerca de la nariz.',
          granos_posibles: 'Posibles granos o zonas inflamadas', milium_posible: 'Posibles quistes de milium (puntitos blancos) cerca de los ojos o en los pómulos',
          lunares_visibles: 'Lunares visibles', manchas_posibles: 'Posibles manchas o zonas más oscuras' };
        var CNT = { puntos_negros_posibles: 'puntosNegros', granos_posibles: 'granos', milium_posible: 'milium', lunares_visibles: 'lunares', manchas_posibles: 'manchas' };
        var txt = function (k) { return CNT[k] ? TXT[k] + (ph.metrics[CNT[k]] ? ' (' + ph.metrics[CNT[k]] + ')' : '') + '.' : TXT[k]; };
        return delay({ ok: true, status: 'ok', example: true, rulesVersion: 'v3-2026-11', photo: ph ? 'analizada' : 'sin_foto', whatsapp: q.get('wa') || '',
          photoLimits: ph ? 'Son mediciones de tus fotos: la luz, la cámara y la hora del día pueden cambiarlas. La profesional lo confirma en persona.' : '',
          profile: { type: 'Mixta', warning: '', origin: ph ? 'foto y cuestionario' : Q, rule: 'TIPO-04' },
          needs: [{ text: 'Posible sensibilidad: a veces tu piel reacciona con algunos productos.', origin: Q, rule: 'NEC-SENS-2' }],
          observations: ph ? ph.findings.map(function (k) { return { text: txt(k), origin: F, rule: 'OBS-' + k, beta: !!CNT[k] || /_posibles?$|_visibles$/.test(k) }; }) : [],
          benefits: [{ text: 'Despejar los puntos negros que la profesional considere aptos para extracción.', origin: Q, rule: 'BEN-PN' },
                     { text: 'Sensación de piel más limpia y con menos brillo después de la sesión. El brillo vuelve con los días.', origin: has('brillo_zona_t') || has('brillo_general') ? F : Q, rule: 'BEN-BRI' },
                     { text: 'Piel más suave al tacto.', origin: has('textura_irregular') ? F : Q, rule: 'BEN-TEX' }],
          limits: [{ text: 'Una sesión no cierra poros de forma permanente, no borra marcas ni resuelve imperfecciones de fondo. El resultado depende de tu piel y de lo que defina la profesional.', origin: V, rule: 'LIM-1' }],
          toEvaluate: [{ text: 'Usás exfoliantes o retinoides: la profesional lo tiene en cuenta para decidir qué se puede hacer en esta sesión.', origin: Q, rule: 'EVA-EXF' }],
          tips: [{ text: 'Lavá tu cara con suavidad, a la mañana y a la noche.', origin: Q, rule: 'TIP-1' }, { text: 'Usá protector solar todos los días.', origin: Q, rule: 'TIP-2' },
                 { text: 'Probá un producto nuevo por vez.', origin: Q, rule: 'TIP-SENS' }] }, 900);
      }
      if (b.action === 'book') {
        if (conflictOnce) {
          conflictOnce = false; booked[b.start] = true;
          var d = b.start.slice(0, 10);
          return delay({ ok: false, code: 'slot_unavailable', alternatives: recommend(0, b.start).slots }, 900);
        }
        booked[b.start] = true;
        var s = new Date(b.start), e = new Date(s.getTime() + 3600000);
        var local = new Date(s.getTime() - 3 * 3600000).toISOString();
        return delay({ ok: true, bookingId: 'RDEMO' + Math.random().toString(16).slice(2, 7).toUpperCase(), scheduleEventId: 'schedule_demo',
          date: local.slice(0, 10), time: local.slice(11, 16), startIso: s.toISOString(), endIso: e.toISOString(), durationMin: 60,
          professional: 'Lic. Jaqueline Mansilla', address: 'Av. Centenario 3090A, Montevideo', timezone: 'America/Montevideo',
          whatsapp: q.get('wa') || '', emailSent: true }, 1100);
      }
      return delay({ ok: false, code: 'invalid_request' });
    }
  };
})();
