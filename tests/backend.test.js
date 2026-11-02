const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const TZ = 'America/Montevideo';
const GOOD = { name: 'Ana Pérez', phone: '099 123 456', email: 'ana@example.com', consent: true, elapsedMs: 9000, pageUrl: 'https://clinicacentenario.com.uy/limpieza-facial?utm_source=ig', utm: { utm_source: 'ig' } };

// Próximo lunes (hora local Montevideo) como fecha de prueba
function nextMonday() {
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value);
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + ((8 - dow) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
const MON = nextMonday();
const at = (hhmm, ymd = MON) => new Date(`${ymd}T${hhmm}:00-03:00`); // Uruguay: UTC-3 todo el año
const ev = (id, s, e, extra = {}) => ({ id, start: { dateTime: at(s).toISOString() }, end: { dateTime: at(e).toISOString() }, status: 'confirmed', ...extra });
const key = (n) => 'idem_' + String(n).padEnd(16, 'x');

function lead(env, over = {}) { return env.post({ action: 'lead', ...GOOD, ...over }); }
function avail(env, l, from = MON, days = 1) { return env.post({ action: 'availability', requestId: l.requestId, token: l.token, from, days }); }
function book(env, l, hhmm, k, ymd = MON) { return env.post({ action: 'book', requestId: l.requestId, token: l.token, start: at(hhmm, ymd).toISOString(), idempotencyKey: k }); }
const contactRow = (env, id) => { const rows = env.state.sheets['Contactos']; const h = rows[0]; const r = rows.find(x => x[0] === id); return Object.fromEntries(h.map((k, i) => [k, r[i]])); };

test('formulario: valida, normaliza celular UY y guarda antes de dar agenda', () => {
  const env = createEnv();
  const bad = lead(env, { phone: '2408 1234', email: 'nope', consent: false });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'validation');
  assert.deepEqual(Object.keys(bad.errors).sort(), ['consent', 'email', 'phone']);
  assert.equal(env.state.sheets['Contactos'].length, 1, 'no se guardó nada inválido');

  const l = lead(env);
  assert.equal(l.ok, true); assert.match(l.requestId, /^CC-\d{6}-[0-9A-F]{6}$/);
  const row = contactRow(env, l.requestId);
  assert.equal(row['Celular'], '+59899123456');
  assert.equal(row['Estado reserva'], 'Datos recibidos');
  assert.equal(row['Estado de pago'], 'Sin pago registrado');
  assert.equal(row['Precio lista (UYU)'], '2280'); assert.equal(row['Precio pago anticipado ofrecido (UYU)'], '1824');
  assert.equal(row['utm_source'], 'ig');
  assert.ok(env.state.sheets['Eventos'].some(r => r[2] === 'datos_recibidos'));
});

test('formulario: variantes de celular uruguayo', () => {
  const env = createEnv();
  for (const p of ['099123456', '99123456', '+598 99 123 456', '00598 99123456', '598-99-123-456'])
    assert.equal(env.ctx.normalizeUyMobile_(p), '+59899123456', p);
  for (const p of ['24081234', '+54 9 11 1234 5678', '0991234', '12345678'])
    assert.equal(env.ctx.normalizeUyMobile_(p), null, p);
});

test('formulario: bloquea inyección de fórmulas en la planilla', () => {
  const env = createEnv();
  assert.equal(env.ctx.sheetSafe_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(env.ctx.sheetSafe_('+598'), "'+598");
  assert.equal(env.ctx.sheetSafe_('@SUM(1)'), "'@SUM(1)");
  assert.equal(env.ctx.sheetSafe_('Ana'), 'Ana');
  const l = lead(env, { pageUrl: '=HYPERLINK("http://x")' });
  assert.equal(contactRow(env, l.requestId)['URL origen'], '', 'URL no válida descartada');
});

test('formulario: antispam (honeypot, llenado instantáneo) y doble envío idempotente', () => {
  const env = createEnv();
  assert.equal(lead(env, { website: 'spam.com' }).ok, false);
  assert.equal(lead(env, { elapsedMs: 300 }).code, 'too_fast');
  const a = lead(env, { submitKey: key('s1') });
  const b = lead(env, { submitKey: key('s1') });
  assert.equal(a.requestId, b.requestId); assert.equal(b.replay, true);
  assert.equal(env.state.sheets['Contactos'].length, 2, 'una sola fila para el doble envío');
});

test('formulario: nueva solicitud de la misma persona conserva trazabilidad', () => {
  const env = createEnv();
  const a = lead(env); const b = lead(env);
  assert.notEqual(a.requestId, b.requestId);
  assert.equal(contactRow(env, b.requestId)['Solicitudes previas (mismo contacto)'], a.requestId);
  assert.equal(contactRow(env, a.requestId)['Nombre y apellido'], '[TEST] Ana Pérez', 'fila anterior intacta y marcada como prueba');
});

test('formulario: si falla la planilla no hay éxito falso', () => {
  const env = createEnv();
  env.state.failSheetWrite = true;
  const r = env.post({ action: 'lead', ...GOOD, email: 'x@y.com' });
  assert.equal(r.ok, false); assert.equal(r.code, 'server_error');
});

test('agenda: exige token de una solicitud guardada', () => {
  const env = createEnv();
  const r = env.post({ action: 'availability', requestId: 'CC-261015-ABCDEF', token: 'x', from: MON });
  assert.equal(r.code, 'invalid_token');
});

test('agenda: horario 9–21, último inicio 20:00, paso 30 min, hora de Montevideo', () => {
  const env = createEnv();
  const l = lead(env);
  const r = avail(env, l);
  assert.equal(r.ok, true); assert.equal(r.timezone, TZ);
  const times = r.slots.map(s => s.time);
  assert.equal(times[0], '09:00'); assert.equal(times[times.length - 1], '20:00'); assert.equal(times.length, 23);
  assert.equal(r.slots[0].start, at('09:00').toISOString(), '09:00 local = 12:00 UTC');
  const sat = new Date(at('12:00')); sat.setUTCDate(sat.getUTCDate() + 5);
  const w = avail(env, l, sat.toISOString().slice(0, 10), 2);
  assert.equal(w.slots.length, 0, 'sábado y domingo cerrados');
});

test('agenda: cruce real profesional × consultorio, 60 min completos, ignora "Disponible"', () => {
  const env = createEnv({ props: { ROOM_CALENDAR_IDS: 'roomA@cal', ROOM_LABELS: 'Consultorio A' } });
  env.state.cals['pro@cal'] = [ev('p1', '10:00', '11:30'), ev('p2', '15:00', '16:00', { transparency: 'transparent' })];
  env.state.cals['roomA@cal'] = [ev('r1', '12:00', '13:00'), ev('r2', '18:30', '19:00')];
  const l = lead(env); const times = avail(env, l).slots.map(s => s.time);
  for (const t of ['09:30', '10:00', '10:30', '11:00']) assert.ok(!times.includes(t), `${t} choca con profesional`);
  assert.ok(times.includes('09:00'));
  for (const t of ['11:30', '12:00', '12:30']) assert.ok(!times.includes(t), `${t} choca con consultorio`);
  assert.ok(times.includes('13:00'));
  assert.ok(times.includes('15:00'), 'evento marcado Disponible no bloquea');
  assert.ok(!times.includes('18:00') && !times.includes('18:30') && times.includes('19:00'));
});

test('agenda: con varios consultorios alcanza con uno libre; calendario sin acceso = no disponible', () => {
  const env = createEnv();
  env.state.cals['roomA@cal'] = [ev('a', '09:00', '21:00')];
  const l = lead(env);
  assert.equal(avail(env, l).slots.length, 23, 'B libre todo el día');
  env.state.cache = {};
  env.state.noAccess.add('roomB@cal');
  assert.equal(avail(env, l).slots.length, 0, 'falla cerrada si no se puede leer');
  env.state.cache = {};
  env.state.noAccess = new Set(['pro@cal']);
  assert.equal(avail(env, l).slots.length, 0);
});

test('agenda: margen entre sesiones configurable', () => {
  const env = createEnv({ props: { BUFFER_AFTER_MIN: '15', BUFFER_BEFORE_MIN: '15', ROOM_CALENDAR_IDS: 'roomA@cal' } });
  env.state.cals['pro@cal'] = [ev('p', '12:00', '13:00')];
  const times = avail(env, lead(env)).slots.map(s => s.time);
  assert.ok(!times.includes('11:00') && !times.includes('13:00') && times.includes('10:30') && times.includes('13:30'));
});

test('reserva: crea ambos eventos con el mismo ID de reserva y actualiza la MISMA fila', () => {
  const env = createEnv();
  const l = lead(env);
  const r = book(env, l, '10:00', key(1));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.date, MON); assert.equal(r.time, '10:00'); assert.equal(r.durationMin, 60);
  assert.equal(r.professional, 'Lic. Jaqueline Mansilla'); assert.equal(r.address, 'Av. Centenario 3090A, Montevideo');
  const pe = env.state.cals['pro@cal'][0], re = env.state.cals['roomA@cal'][0];
  assert.equal(pe.extendedProperties.private.bookingId, r.bookingId);
  assert.equal(re.extendedProperties.private.bookingId, r.bookingId);
  assert.ok(!/Ana/.test(re.summary + re.description), 'el consultorio no lleva datos del paciente');
  assert.match(re.summary, /^\[TEST\] Jaqueline Mansilla - Limpieza facial/);
  const rows = env.state.sheets['Contactos'];
  assert.equal(rows.length, 2, 'sin fila nueva');
  const row = contactRow(env, l.requestId);
  assert.equal(row['Estado reserva'], 'Reserva confirmada'); assert.equal(row['Consultorio'], 'Consultorio A');
  assert.equal(row['Estado de pago'], 'Sin pago registrado', 'reserva ≠ pago');
  assert.equal(row['ID evento profesional'], pe.id); assert.equal(row['ID evento consultorio'], re.id);
});

test('reserva: doble clic / reintento con la misma clave no duplica', () => {
  const env = createEnv();
  const l = lead(env);
  const a = book(env, l, '10:00', key(2)); const b = book(env, l, '10:00', key(2));
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(b.replay, true); assert.equal(a.bookingId, b.bookingId);
  assert.equal(env.state.cals['pro@cal'].length, 1); assert.equal(env.state.cals['roomA@cal'].length, 1);
  assert.equal(env.state.sheets['Eventos'].filter(r => r[2] === 'reserva_confirmada').length, 1);
});

test('reserva: timeout tras crear eventos y reintento → se completa sin duplicar', () => {
  const env = createEnv();
  const l = lead(env);
  env.state.failSheetWrite = true; // simula caída después de escribir calendarios
  const first = book(env, l, '11:00', key(3));
  assert.equal(first.ok, true); assert.equal(first.sheetSynced, false);
  const recon = env.state.sheets['Conciliación'].length > 1 || Object.keys(env.state.props).some(k => k.startsWith('RECON_'));
  assert.ok(recon, 'queda registrado para conciliar (planilla o respaldo en propiedades)');
  env.state.failSheetWrite = false;
  const again = book(env, l, '11:00', key(3));
  assert.equal(again.ok, true);
  assert.equal(env.state.cals['pro@cal'].filter(e => e.status !== 'cancelled').length, 1);
});

test('reserva: misma solicitud no puede reservar dos horarios', () => {
  const env = createEnv();
  const l = lead(env);
  assert.equal(book(env, l, '10:00', key(4)).ok, true);
  const second = book(env, l, '14:00', key(5));
  assert.equal(second.ok, false); assert.equal(second.code, 'already_booked'); assert.equal(second.booking.time, '10:00');
});

test('concurrencia: dos personas, mismo horario, un solo consultorio → una gana, la otra recibe alternativas', () => {
  const env = createEnv({ props: { ROOM_CALENDAR_IDS: 'roomA@cal' } });
  const a = lead(env), b = lead(env, { email: 'b@example.com', phone: '098765432', name: 'Bruno Díaz' });
  const ra = book(env, a, '16:00', key(6)); const rb = book(env, b, '16:00', key(7));
  assert.equal(ra.ok, true); assert.equal(rb.ok, false); assert.equal(rb.code, 'slot_unavailable');
  assert.ok(rb.alternatives.length > 0 && !rb.alternatives.some(s => s.time === '16:00' && s.date === MON));
  assert.equal(contactRow(env, b.requestId)['Estado reserva'], 'Datos recibidos', 'B conserva sus datos');
});

test('concurrencia: aunque haya otro consultorio libre, la profesional ocupada bloquea', () => {
  const env = createEnv();
  const a = lead(env), b = lead(env, { email: 'b@example.com', phone: '098765432', name: 'Bruno Díaz' });
  assert.equal(book(env, a, '17:00', key(8)).ok, true);
  assert.equal(book(env, b, '17:00', key(9)).code, 'slot_unavailable', 'la profesional ya está ocupada');
});

test('concurrencia: otra confirmación en curso (lock tomado) → pide reintentar, no crea nada', () => {
  const env = createEnv();
  const l = lead(env);
  env.state.locked = true;
  const r = book(env, l, '10:00', key(10));
  assert.equal(r.code, 'busy_retry'); assert.equal((env.state.cals['pro@cal'] || []).length, 0);
});

test('concurrencia: alguien escribe en el calendario durante la confirmación → rollback', () => {
  const env = createEnv({ props: { ROOM_CALENDAR_IDS: 'roomA@cal' } });
  const l = lead(env);
  env.state.afterInsert = (cal, e) => {
    if (cal === 'roomA@cal' && e.id.startsWith('ccr')) env.state.cals['roomA@cal'].push(ev('manual', '09:30', '10:30'));
  };
  const r = book(env, l, '09:00', key(11));
  assert.equal(r.ok, false); assert.equal(r.code, 'slot_unavailable');
  const live = c => env.state.cals[c].filter(e => e.status !== 'cancelled' && e.id !== 'manual');
  assert.equal(live('pro@cal').length, 0); assert.equal(live('roomA@cal').length, 0);
  assert.equal(contactRow(env, l.requestId)['Estado reserva'], 'Datos recibidos');
});

test('fallo parcial: falla el consultorio → se borra el evento de la profesional', () => {
  const env = createEnv({ props: { ROOM_CALENDAR_IDS: 'roomA@cal' } });
  const l = lead(env);
  env.state.failInsert.add('roomA@cal');
  const r = book(env, l, '10:00', key(12));
  assert.equal(r.ok, false); assert.equal(r.code, 'calendar_error');
  assert.equal(env.state.cals['pro@cal'].filter(e => e.status !== 'cancelled').length, 0);
});

test('fallo parcial: no se puede revertir → pendiente de conciliación, nunca éxito', () => {
  const env = createEnv({ props: { ROOM_CALENDAR_IDS: 'roomA@cal' } });
  const l = lead(env);
  env.state.failInsert.add('roomA@cal'); env.state.failDelete.add('pro@cal');
  const r = book(env, l, '10:00', key(13));
  assert.equal(r.ok, false); assert.equal(r.code, 'needs_reconciliation');
  assert.equal(contactRow(env, l.requestId)['Estado reserva'], 'Pendiente de conciliación');
  assert.ok(env.state.sheets['Conciliación'].length > 1);
});

test('reserva: horario fuera de reglas (21:00, sábado, minuto raro, pasado) se rechaza', () => {
  const env = createEnv();
  const l = lead(env);
  assert.equal(book(env, l, '20:30', key(14)).code, 'slot_unavailable');
  assert.equal(book(env, l, '10:10', key(15)).code, 'slot_unavailable');
  const sat = new Date(at('10:00')); sat.setUTCDate(sat.getUTCDate() + 5);
  assert.equal(book(env, l, '10:00', key(16), sat.toISOString().slice(0, 10)).code, 'slot_unavailable');
  assert.equal(book(env, l, '10:00', key(17), '2020-01-06').code, 'slot_unavailable');
});

test('reserva: token ajeno no permite reservar con la solicitud de otro', () => {
  const env = createEnv();
  const a = lead(env), b = lead(env, { email: 'b@example.com', phone: '098765432' });
  const r = env.post({ action: 'book', requestId: a.requestId, token: b.token, start: at('10:00').toISOString(), idempotencyKey: key(18) });
  assert.equal(r.code, 'invalid_token');
});

test('sin calendarios configurados: se guarda el lead pero no se simula agenda ni reserva', () => {
  const env = createEnv({ props: { PRO_CALENDAR_ID: '', ROOM_CALENDAR_IDS: '' } });
  const l = lead(env); assert.equal(l.ok, true);
  assert.equal(avail(env, l).code, 'calendar_not_configured');
  assert.equal(book(env, l, '10:00', key(19)).code, 'calendar_not_configured');
});

test('CAPI: solo con consentimiento, mismo event_id y sin PII por defecto', () => {
  const env = createEnv({ props: { CAPI_ENABLED: 'true', META_PIXEL_ID: '123', META_CAPI_TOKEN: 'tok' } });
  let sent = [];
  env.ctx.UrlFetchApp.fetch = (url, o) => { sent.push(JSON.parse(o.payload)); return {}; };
  const noConsent = lead(env, { trackingConsent: false }); assert.equal(sent.length, 0);
  const l = lead(env, { trackingConsent: true, email: 'z@z.com', phone: '091111111' });
  assert.equal(sent.length, 1); assert.equal(sent[0].data[0].event_name, 'Lead'); assert.equal(sent[0].data[0].event_id, 'lead_' + l.requestId);
  assert.ok(!JSON.stringify(sent[0]).includes('z@z.com') && !('em' in sent[0].data[0].user_data));
  const b = env.post({ action: 'book', requestId: l.requestId, token: l.token, start: at('10:00').toISOString(), idempotencyKey: key(20), trackingConsent: true });
  assert.equal(sent.length, 2); assert.equal(sent[1].data[0].event_name, 'Schedule'); assert.equal(sent[1].data[0].event_id, b.scheduleEventId);
  env.post({ action: 'book', requestId: l.requestId, token: l.token, start: at('10:00').toISOString(), idempotencyKey: key(20), trackingConsent: true });
  assert.equal(sent.length, 2, 'reintento no reenvía Schedule');
});
