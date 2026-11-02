/**
 * Tareas de puesta en marcha. Ejecutar desde el editor de Apps Script vinculado a la
 * planilla "Datos Landing", con la cuenta ccentenario3090@gmail.com:
 *   configurarTodo()  → corre los pasos de abajo en orden.
 *   1. setupSecrets()       → genera LEAD_SECRET (una sola vez)
 *   2. setupSheet()         → guarda SHEET_ID y completa pestañas faltantes
 *   3. setupRoomCalendar()  → busca el calendario del consultorio por nombre y guarda su ID
 *   4. checkCalendars()     → verifica acceso a los calendarios configurados
 * Los IDs quedan en Propiedades del script, nunca en el código (el repositorio es público).
 */
function configurarTodo() {
  setupSecrets();
  setupSheet();
  setupRoomCalendar();
  checkCalendars();
}

/** Busca en la cuenta los calendarios cuyo nombre coincide con ROOM_LABELS y guarda sus IDs. */
function setupRoomCalendar() {
  var cfg = getConfig();
  var wanted = cfg.ROOM_LABEL_LIST.map(normalizeWord_);
  if (!wanted.length) throw new Error('Completá ROOM_LABELS con el nombre del calendario del consultorio.');
  var found = {}, pageToken;
  do {
    var res = Calendar.CalendarList.list({ pageToken: pageToken, maxResults: 250 });
    (res.items || []).forEach(function (c) {
      var i = wanted.indexOf(normalizeWord_(c.summaryOverride || c.summary));
      if (i >= 0 && !found[i]) found[i] = c.id;
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  var missing = cfg.ROOM_LABEL_LIST.filter(function (n, i) { return !found[i]; });
  if (missing.length) throw new Error('No encontré estos calendarios en la cuenta: ' + missing.join(', '));
  var ids = cfg.ROOM_LABEL_LIST.map(function (n, i) { return found[i]; });
  PropertiesService.getScriptProperties().setProperty('ROOM_CALENDAR_IDS', ids.join(','));
  Logger.log('Consultorio configurado: ' + cfg.ROOM_LABELS);
}
function setupSecrets() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LEAD_SECRET')) {
    props.setProperty('LEAD_SECRET', Utilities.getUuid() + Utilities.getUuid());
    Logger.log('LEAD_SECRET generado.');
  } else {
    Logger.log('LEAD_SECRET ya existía; no se cambió (cambiarlo invalida solicitudes en curso).');
  }
}

/** Comprueba lectura free/busy y permiso de escritura, sin crear eventos. */
function checkCalendars() {
  var cfg = getConfig();
  var ids = [cfg.PRO_CALENDAR_ID].concat(cfg.ROOM_CALENDAR_LIST).filter(Boolean);
  if (!ids.length) { Logger.log('No hay calendarios configurados (PRO_CALENDAR_ID / ROOM_CALENDAR_IDS).'); return; }
  var now = new Date();
  var fb = Calendar.Freebusy.query({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 86400000).toISOString(), items: ids.map(function (i) { return { id: i }; }) });
  ids.forEach(function (id) {
    var c = fb.calendars[id];
    var fbOk = c && !(c.errors && c.errors.length);
    var role = '(sin acceso)';
    try { role = Calendar.CalendarList.get(id).accessRole; } catch (e) { role = 'no suscripto o sin permiso'; }
    Logger.log((id === cfg.PRO_CALENDAR_ID ? 'PROFESIONAL ' : 'CONSULTORIO ') + id + ' → free/busy: ' + (fbOk ? 'OK' : 'ERROR') + ' · rol: ' + role +
               ((role === 'owner' || role === 'writer') ? '' : '  ⚠ se necesita permiso para hacer cambios en eventos'));
  });
}

/** Elimina eventos [TEST] creados por la landing en un rango (solo los creados por este sistema). */
function cleanupTestEvents(daysAhead) {
  var cfg = getConfig();
  if (cfg.ENV === 'production') throw new Error('Solo en development');
  var now = new Date(), until = new Date(now.getTime() + (daysAhead || 60) * 86400000);
  calendarIds_(cfg).forEach(function (cal) {
    var res = Calendar.Events.list(cal, { timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: true,
      privateExtendedProperty: 'source=' + EVENT_SOURCE_TAG, maxResults: 250 });
    (res.items || []).forEach(function (e) {
      if (/^\[TEST\]/.test(e.summary || '')) { deleteEventSafe_(cal, e.id); Logger.log('Borrado ' + cal + ' ' + e.id); }
    });
  });
}
