/**
 * Confirmación de reserva con:
 *  - revalidación del consultorio (y de la profesional, si su calendario está configurado) en el servidor,
 *  - lock del script (serializa confirmaciones que entran por esta landing),
 *  - idempotencia (IDs de evento deterministas por intento),
 *  - verificación posterior a la escritura (detecta escrituras externas en la ventana),
 *  - rollback de lo creado si falla cualquier parte.
 */

var EVENT_SOURCE_TAG = 'landing-limpieza-facial';

function bookSlot_(cfg, body, now) {
  var requestId = String(body.requestId || '');
  if (!checkLeadToken_(requestId, body.token)) return fail_('invalid_token');
  var idemKey = String(body.idempotencyKey || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(idemKey)) return fail_('invalid_request');
  var start = new Date(String(body.start || ''));
  if (isNaN(start.getTime())) return fail_('invalid_request');

  // ¿El inicio pedido es un horario válido según las reglas de agenda?
  var lp = localParts_(start, cfg.TIMEZONE);
  var cands = candidateSlots_(cfg, { y: lp.y, m: lp.m, d: lp.d }, 1, now);
  var slot = cands.filter(function (c) { return c.start.getTime() === start.getTime(); })[0];
  if (!slot) return fail_('slot_unavailable', { alternatives: alternatives_(cfg, start, now) });

  var bookingId = bookingIdFor_(requestId, idemKey);
  var evP = calendarEventId_(bookingId, 'p');
  var evR = calendarEventId_(bookingId, 'r');

  var pro = cfg.PRO_CALENDAR_ID; // opcional: sin calendario de la profesional solo se agenda el consultorio
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return fail_('busy_retry');
  try {
    var contact = readContact_(cfg, requestId);
    if (!contact) return fail_('request_not_found');

    // Una solicitud = una reserva. Reintento del mismo intento → misma respuesta.
    if (contact['Estado reserva'] === STATUS.CONFIRMED) {
      if (contact['ID reserva'] === bookingId) return ok_(confirmationFromContact_(cfg, contact, true));
      return fail_('already_booked', { booking: confirmationFromContact_(cfg, contact, false) });
    }

    // Restos de un intento anterior idéntico (p.ej. timeout después de crear eventos)
    var existingP = pro ? getEventSafe_(pro, evP) : null;
    var existingRoom = null;
    cfg.ROOM_CALENDAR_LIST.some(function (r) { var e = getEventSafe_(r, evR); if (e) { existingRoom = { cal: r, ev: e }; return true; } return false; });
    if (existingRoom && (existingP || !pro)) {
      return ok_(finalize_(cfg, requestId, bookingId, slot, existingRoom.cal, pro ? evP : '', evR, true));
    }
    if (existingP) deleteEventSafe_(pro, evP);
    if (existingRoom) deleteEventSafe_(existingRoom.cal, evR);

    // 1) Revalidación
    var before = cfg.BUFFER_BEFORE_MIN * 60000, after = cfg.BUFFER_AFTER_MIN * 60000;
    var ws = new Date(slot.start.getTime() - before), we = new Date(slot.end.getTime() + after);
    var busy = fetchBusy_(calendarIds_(cfg), ws, we, cfg.TIMEZONE);
    var avail = crossAvailability_(cfg, [slot], busy);
    if (!avail.length) {
      logEvent_(cfg, requestId, 'horario_ocupado_al_confirmar', { start: slot.start.toISOString() });
      return fail_('slot_unavailable', { alternatives: alternatives_(cfg, start, now) });
    }
    var room = avail[0].rooms[0];

    // 2) Escritura: profesional primero (si corresponde), después consultorio
    var created = [];
    if (pro) {
      try {
        insertEvent_(pro, buildProEvent_(cfg, contact, requestId, bookingId, slot, room, evP));
        created.push([pro, evP]);
      } catch (e) {
        logEvent_(cfg, requestId, 'error_evento_profesional', { msg: shortErr_(e) });
        return fail_('calendar_error');
      }
    }
    try {
      insertEvent_(room, buildRoomEvent_(cfg, requestId, bookingId, slot, room, evR));
    } catch (e) {
      logEvent_(cfg, requestId, 'error_evento_consultorio', { msg: shortErr_(e) });
      return created.length ? rollback_(cfg, requestId, bookingId, created, 'calendar_error') : fail_('calendar_error');
    }
    created.push([room, evR]);

    // 3) Verificación posterior: ¿alguien más escribió en la ventana mientras tanto?
    var clash = (pro && externalOverlap_(pro, ws, we, [evP])) || externalOverlap_(room, ws, we, [evR]);
    if (clash) {
      logEvent_(cfg, requestId, 'conflicto_detectado_post_escritura', { start: slot.start.toISOString() });
      var rb = rollback_(cfg, requestId, bookingId, created, 'slot_unavailable');
      if (rb.ok === false && rb.code === 'slot_unavailable') rb.alternatives = alternatives_(cfg, start, now);
      return rb;
    }

    return ok_(finalize_(cfg, requestId, bookingId, slot, room, pro ? evP : '', evR, false));
  } finally {
    lock.releaseLock();
  }
}

/** Marca la solicitud como confirmada en la MISMA fila. Si Sheets falla, la reserva sigue siendo real. */
function finalize_(cfg, requestId, bookingId, slot, room, evP, evR, replay) {
  var date = slot.date, time = slot.time;
  var fields = {
    'Estado reserva': STATUS.CONFIRMED,
    'Fecha reservada': date,
    'Hora reservada': time,
    'Profesional': cfg.PROFESSIONAL_NAME,
    'Consultorio': roomLabel_(cfg, room),
    'ID reserva': bookingId,
    'ID evento profesional': evP,
    'ID evento consultorio': evR
  };
  var sheetOk = true;
  try { updateContact_(cfg, requestId, fields); }
  catch (e) {
    try { Utilities.sleep(800); updateContact_(cfg, requestId, fields); }
    catch (e2) { sheetOk = false; logReconcile_(cfg, requestId, bookingId, 'Reserva creada en calendarios pero no se pudo actualizar la planilla', fields); }
  }
  if (!replay) {
    logEvent_(cfg, requestId, 'reserva_confirmada', { bookingId: bookingId, date: date, time: time });
  }
  return {
    bookingId: bookingId,
    scheduleEventId: 'schedule_' + bookingId,
    date: date,
    time: time,
    startIso: slot.start.toISOString(),
    endIso: slot.end.toISOString(),
    durationMin: cfg.DURATION_MIN,
    professional: cfg.PROFESSIONAL_NAME,
    address: cfg.ADDRESS,
    timezone: cfg.TIMEZONE,
    replay: !!replay,
    sheetSynced: sheetOk
  };
}

function confirmationFromContact_(cfg, c, replay) {
  var d = parseYmd_(String(c['Fecha reservada']).replace(/^'/, ''));
  var t = String(c['Hora reservada']).replace(/^'/, '').split(':');
  var start = d ? zonedToDate_(d.y, d.m, d.d, +t[0], +t[1], cfg.TIMEZONE) : null;
  return {
    bookingId: c['ID reserva'],
    scheduleEventId: 'schedule_' + c['ID reserva'],
    date: String(c['Fecha reservada']).replace(/^'/, ''),
    time: String(c['Hora reservada']).replace(/^'/, ''),
    startIso: start ? start.toISOString() : '',
    endIso: start ? new Date(start.getTime() + cfg.DURATION_MIN * 60000).toISOString() : '',
    durationMin: cfg.DURATION_MIN,
    professional: cfg.PROFESSIONAL_NAME,
    address: cfg.ADDRESS,
    timezone: cfg.TIMEZONE,
    replay: replay,
    sheetSynced: true
  };
}

/** Borra lo creado. Si no se puede borrar, queda en Conciliación y NUNCA se informa éxito. */
function rollback_(cfg, requestId, bookingId, created, codeIfClean) {
  var leftovers = [];
  created.forEach(function (pair) {
    if (!deleteEventSafe_(pair[0], pair[1])) leftovers.push({ calendar: pair[0], eventId: pair[1] });
  });
  if (leftovers.length) {
    logReconcile_(cfg, requestId, bookingId, 'Rollback incompleto: eventos a revisar/borrar a mano', leftovers);
    try { updateContact_(cfg, requestId, { 'Estado reserva': STATUS.RECONCILE, 'ID reserva': bookingId }); } catch (e) {}
    return fail_('needs_reconciliation');
  }
  return fail_(codeIfClean);
}

function buildProEvent_(cfg, contact, requestId, bookingId, slot, room, id) {
  var name = [contact['Nombre'], contact['Apellido']].map(function (v) { return String(v || '').replace(/^'/, ''); })
    .join(' ').replace(/^\[TEST\] /, '').trim();
  var test = cfg.ENV === 'production' ? '' : '[TEST] ';
  var desc = [
    'Servicio: ' + cfg.SERVICE_NAME + ' (' + cfg.DURATION_MIN + ' min)',
    'Consultorio: ' + roomLabel_(cfg, room),
    'Reserva: ' + bookingId + ' · Solicitud: ' + requestId,
    'Origen: landing web. Estado de pago: ver planilla.'
  ];
  if (cfg.PRO_EVENT_INCLUDES_CONTACT) {
    desc.splice(1, 0, 'Paciente: ' + name, 'Celular: ' + String(contact['Celular']).replace(/^'/, ''));
  }
  return {
    id: id,
    summary: test + 'Limpieza facial — ' + (cfg.PRO_EVENT_INCLUDES_CONTACT ? name : 'Reserva web'),
    description: desc.join('\n'),
    location: cfg.ADDRESS,
    start: { dateTime: slot.start.toISOString(), timeZone: cfg.TIMEZONE },
    end: { dateTime: slot.end.toISOString(), timeZone: cfg.TIMEZONE },
    transparency: 'opaque',
    visibility: 'private',
    reminders: { useDefault: true },
    extendedProperties: { private: { bookingId: bookingId, requestId: requestId, source: EVENT_SOURCE_TAG, role: 'profesional' } }
  };
}

/** Evento del consultorio: SIN datos del paciente. Empieza con el nombre de la profesional (convención de facturación). */
function buildRoomEvent_(cfg, requestId, bookingId, slot, room, id) {
  var test = cfg.ENV === 'production' ? '' : '[TEST] ';
  var pro = cfg.PROFESSIONAL_NAME.replace(/^Lic\.\s*/, '');
  return {
    id: id,
    summary: test + pro + ' - Limpieza facial (web)',
    description: 'Profesional: ' + cfg.PROFESSIONAL_NAME + '\nServicio: ' + cfg.SERVICE_NAME +
                 '\nReserva: ' + bookingId + '\nOrigen: landing web',
    start: { dateTime: slot.start.toISOString(), timeZone: cfg.TIMEZONE },
    end: { dateTime: slot.end.toISOString(), timeZone: cfg.TIMEZONE },
    transparency: 'opaque',
    extendedProperties: { private: { bookingId: bookingId, requestId: requestId, source: EVENT_SOURCE_TAG, role: 'consultorio' } }
  };
}

function insertEvent_(calId, ev) {
  try {
    return Calendar.Events.insert(ev, calId, { sendUpdates: 'none' });
  } catch (e) {
    // 409 = ya existe un evento con ese ID → mismo intento repetido. Verificamos que sea nuestro.
    if (/409|already exists|duplicate/i.test(String(e))) {
      var got = getEventSafe_(calId, ev.id);
      if (got) return got;
    }
    throw e;
  }
}

function getEventSafe_(calId, id) {
  try {
    var e = Calendar.Events.get(calId, id);
    return (e && e.status !== 'cancelled') ? e : null;
  } catch (err) { return null; }
}

function deleteEventSafe_(calId, id) {
  for (var i = 0; i < 3; i++) {
    try { Calendar.Events.remove(calId, id, { sendUpdates: 'none' }); return true; }
    catch (e) {
      if (/404|410|not found|deleted/i.test(String(e))) return true;
      Utilities.sleep(400 * (i + 1));
    }
  }
  return false;
}

/** ¿Hay en la ventana algún evento ocupado que no sea nuestro? */
function externalOverlap_(calId, ws, we, ownIds) {
  var res = Calendar.Events.list(calId, {
    timeMin: ws.toISOString(), timeMax: we.toISOString(), singleEvents: true, showDeleted: false, maxResults: 50
  });
  return (res.items || []).some(function (e) {
    if (ownIds.indexOf(e.id) >= 0) return false;
    if (e.status === 'cancelled' || e.transparency === 'transparent') return false;
    var mine = (e.attendees || []).filter(function (a) { return a.self; })[0];
    if (mine && mine.responseStatus === 'declined') return false;
    var s = new Date(e.start.dateTime || e.start.date), en = new Date(e.end.dateTime || e.end.date);
    return overlaps_(ws, we, s, en);
  });
}

/** Nuevas recomendaciones cuando el horario elegido se ocupó (sin repetir ese horario). */
function alternatives_(cfg, start, now) {
  try {
    return recommendSlots_(cfg, now, start.toISOString()).slots.map(publicSlot_);
  } catch (e) { return []; }
}

function publicSlot_(s) { return { start: s.start.toISOString(), date: s.date, time: s.time, soon: !!s.soon }; }

function shortErr_(e) { return String(e && e.message || e).slice(0, 160); }
function ok_(data) { data.ok = true; return data; }
function fail_(code, extra) { var o = { ok: false, code: code }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return o; }
