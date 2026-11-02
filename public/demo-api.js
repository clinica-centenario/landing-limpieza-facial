/**
 * API SIMULADA — solo para revisar la experiencia en local (?demo=1 en localhost).
 * No guarda nada, no toca Google y la página muestra un aviso permanente de MODO DEMO.
 * No se incluye en producción: app.js solo la usa si API_URL está vacío y el host es local.
 * Parámetros de prueba: &conflict=1 (el primer intento de reserva choca) · &empty=1 (sin horarios esta semana)
 */
(function () {
  var q = new URLSearchParams(location.search);
  var conflictOnce = q.get('conflict') === '1';
  var booked = {};
  var leads = {};
  function delay(v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 500); }); }
  function ymdAdd(ymd, n) { var a = ymd.split('-'); var d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n, 15)); return d.toISOString().slice(0, 10); }
  function slotsFor(from, days) {
    var out = [], now = Date.now();
    for (var i = 0; i < days; i++) {
      var ymd = ymdAdd(from, i), d = new Date(ymd + 'T12:00:00-03:00'), dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (q.get('empty') === '1' && i < 5 && ymdAdd(from, 0) <= new Date().toISOString().slice(0, 10) && ymdAdd(from, 6) >= new Date().toISOString().slice(0, 10)) continue;
      for (var t = 9 * 60; t <= 20 * 60; t += 30) {
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
        var end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
        return delay({ ok: true, slots: slotsFor(b.from, b.days), horizonEnd: end, timezone: 'America/Montevideo' }, 600);
      }
      if (b.action === 'track') return delay({ ok: true }, 50);
      if (b.action === 'analyze') {
        // Vista previa: NO se analiza la foto. Se devuelve un ejemplo fijo, marcado como tal.
        return delay({ ok: true, example: true, status: 'ok', skin_type: 'mixta', skin_type_confidence: 'media',
          summary: 'Se observa más brillo en la zona T (frente, nariz y mentón) y las mejillas con un aspecto más seco.',
          observations: [{ area: 'Zona T', text: 'Brillo y poros visibles en nariz y frente.' }, { area: 'Nariz', text: 'Puntos negros aparentes en los laterales.' }, { area: 'Mejillas', text: 'Textura algo irregular y menos luminosidad.' }],
          session_focus: ['extraccion', 'punta_diamante', 'hidratacion'],
          home_tips: ['Limpieza suave por la mañana y por la noche.', 'Hidratante liviano, más en mejillas que en la zona T.', 'Protector solar todos los días.'],
          see_doctor: false }, 2200);
      }
      if (b.action === 'book') {
        if (conflictOnce) {
          conflictOnce = false; booked[b.start] = true;
          var d = b.start.slice(0, 10);
          return delay({ ok: false, code: 'slot_unavailable', alternatives: slotsFor(new Date(b.start).toISOString().slice(0, 10), 3).slice(0, 6) }, 900);
        }
        booked[b.start] = true;
        var s = new Date(b.start), e = new Date(s.getTime() + 3600000);
        var local = new Date(s.getTime() - 3 * 3600000).toISOString();
        return delay({ ok: true, bookingId: 'RDEMO' + Math.random().toString(16).slice(2, 7).toUpperCase(), scheduleEventId: 'schedule_demo',
          date: local.slice(0, 10), time: local.slice(11, 16), startIso: s.toISOString(), endIso: e.toISOString(), durationMin: 60,
          professional: 'Lic. Jaqueline Mansilla', address: 'Av. Centenario 3090A, Montevideo', timezone: 'America/Montevideo' }, 1100);
      }
      return delay({ ok: false, code: 'invalid_request' });
    }
  };
})();
