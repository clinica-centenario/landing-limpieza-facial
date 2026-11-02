/**
 * Cálculo de disponibilidad: cruce profesional × consultorios.
 * Lógica pura (sin servicios de Google) salvo fetchBusy_(), para poder testearla.
 */

// ── Zona horaria ─────────────────────────────────────────────

/** Offset en minutos de `tz` en el instante `date` (p.ej. -180 para Montevideo). */
function tzOffsetMinutes_(date, tz) {
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    var z = Utilities.formatDate(date, tz, 'Z'); // "-0300"
    var sign = z.charAt(0) === '-' ? -1 : 1;
    return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
  }
  var parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
  var asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Fecha/hora local en `tz` → Date (UTC real). Soporta cambios de horario. */
function zonedToDate_(y, m, d, hh, mm, tz) {
  var guess = Date.UTC(y, m - 1, d, hh, mm);
  var off = tzOffsetMinutes_(new Date(guess), tz);
  var t = guess - off * 60000;
  var off2 = tzOffsetMinutes_(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Partes locales (en tz) de un Date. */
function localParts_(date, tz) {
  var off = tzOffsetMinutes_(date, tz);
  var l = new Date(date.getTime() + off * 60000);
  var dow = l.getUTCDay(); // 0 domingo
  return {
    y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(),
    hh: l.getUTCHours(), mm: l.getUTCMinutes(), isoDow: dow === 0 ? 7 : dow
  };
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(p) { return p.y + '-' + pad2_(p.m) + '-' + pad2_(p.d); }
function hm_(p) { return pad2_(p.hh) + ':' + pad2_(p.mm); }
function parseHm_(s) { var a = String(s).split(':'); return Number(a[0]) * 60 + Number(a[1] || 0); }
function parseYmd_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function addDaysYmd_(p, n) {
  var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// ── Intervalos ───────────────────────────────────────────────

function overlaps_(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

function isFree_(busyList, start, end) {
  for (var i = 0; i < busyList.length; i++) {
    if (overlaps_(start, end, busyList[i].start, busyList[i].end)) return false;
  }
  return true;
}

// ── Generación de horarios ───────────────────────────────────

/**
 * Lista de inicios candidatos (antes de cruzar calendarios) para un rango de fechas locales.
 * @return [{start:Date, end:Date, date:'YYYY-MM-DD', time:'HH:MM'}]
 */
function candidateSlots_(cfg, fromYmd, days, now) {
  var out = [];
  var open = parseHm_(cfg.OPEN_TIME), close = parseHm_(cfg.CLOSE_TIME), last = parseHm_(cfg.LAST_START_TIME);
  var dur = cfg.DURATION_MIN, step = cfg.SLOT_STEP_MIN;
  var earliest = now.getTime() + cfg.MIN_NOTICE_HOURS * 3600000;
  var horizon = now.getTime() + cfg.HORIZON_DAYS * 86400000;
  for (var i = 0; i < days; i++) {
    var day = addDaysYmd_(fromYmd, i);
    var key = ymd_(day);
    var noon = zonedToDate_(day.y, day.m, day.d, 12, 0, cfg.TIMEZONE);
    var dow = localParts_(noon, cfg.TIMEZONE).isoDow;
    if (cfg.WORKING_DAY_LIST.indexOf(dow) < 0) continue;
    if (cfg.CLOSED_DATE_LIST.indexOf(key) >= 0) continue;
    for (var t = open; t <= last && t + dur <= close; t += step) {
      var start = zonedToDate_(day.y, day.m, day.d, Math.floor(t / 60), t % 60, cfg.TIMEZONE);
      var end = new Date(start.getTime() + dur * 60000);
      if (start.getTime() < earliest || start.getTime() < now.getTime()) continue;
      if (start.getTime() > horizon) continue;
      out.push({ start: start, end: end, date: key, time: pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60) });
    }
  }
  return out;
}

/**
 * Cruce: primero la profesional, después los consultorios elegibles.
 * busyMap: { calendarId: [{start:Date,end:Date}] , errors: {calendarId: true} }
 * Un calendario con error se considera NO disponible (falla cerrada).
 * @return [{start, end, date, time, rooms:[calendarId…]}]
 */
function crossAvailability_(cfg, candidates, busyMap) {
  var pro = cfg.PRO_CALENDAR_ID;
  var errors = busyMap.errors || {};
  if (!pro || errors[pro]) return [];
  var before = cfg.BUFFER_BEFORE_MIN * 60000, after = cfg.BUFFER_AFTER_MIN * 60000;
  var out = [];
  candidates.forEach(function (c) {
    var s = new Date(c.start.getTime() - before), e = new Date(c.end.getTime() + after);
    if (!isFree_(busyMap[pro] || [], s, e)) return;           // 1) profesional
    var rooms = cfg.ROOM_CALENDAR_LIST.filter(function (r) {    // 2) consultorios
      return !errors[r] && isFree_(busyMap[r] || [], s, e);
    });
    if (rooms.length) out.push({ start: c.start, end: c.end, date: c.date, time: c.time, rooms: rooms });
  });
  return out;
}

// ── Lectura de Google Calendar ──────────────────────────────

/**
 * Free/busy de varios calendarios. Respeta recurrencias y no cuenta eventos "Disponible"
 * (transparentes). No devuelve títulos ni detalles de eventos.
 */
function fetchBusy_(calendarIds, timeMin, timeMax, tz) {
  var res = Calendar.Freebusy.query({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    timeZone: tz,
    items: calendarIds.map(function (id) { return { id: id }; })
  });
  var map = { errors: {} };
  calendarIds.forEach(function (id) {
    var c = (res.calendars || {})[id];
    if (!c || (c.errors && c.errors.length)) { map.errors[id] = true; map[id] = []; return; }
    map[id] = (c.busy || []).map(function (b) { return { start: new Date(b.start), end: new Date(b.end) }; });
  });
  return map;
}

/** Disponibilidad completa para la API. */
function computeAvailability_(cfg, fromYmd, days, now) {
  var cands = candidateSlots_(cfg, fromYmd, days, now);
  if (!cands.length) return { slots: [], calendarErrors: false };
  var pad = Math.max(cfg.BUFFER_BEFORE_MIN, cfg.BUFFER_AFTER_MIN) * 60000;
  var tMin = new Date(cands[0].start.getTime() - pad);
  var tMax = new Date(cands[cands.length - 1].end.getTime() + pad);
  var ids = [cfg.PRO_CALENDAR_ID].concat(cfg.ROOM_CALENDAR_LIST);
  var busy = fetchBusy_(ids, tMin, tMax, cfg.TIMEZONE);
  var anyError = Object.keys(busy.errors).length > 0;
  return { slots: crossAvailability_(cfg, cands, busy), calendarErrors: anyError };
}
