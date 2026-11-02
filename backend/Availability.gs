/**
 * Cálculo de disponibilidad: franjas de la pestaña Horarios × consultorio libre
 * (× profesional, si se configura su calendario).
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
/** "9", "9:00", "09:00:00", "9.30", "14 hs" → minutos desde 00:00, o null. */
function parseSheetTime_(v) {
  var m = /^\s*(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(?:h|hs)?\s*$/i.exec(String(v == null ? '' : v));
  if (!m) return null;
  var h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}
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
 * Cada franja de cfg.WEEKLY admite inicios desde "Desde" hasta que la sesión termine en "Hasta".
 * @return [{start:Date, end:Date, date:'YYYY-MM-DD', time:'HH:MM'}]
 */
function candidateSlots_(cfg, fromYmd, days, now) {
  var out = [];
  var dur = cfg.DURATION_MIN, step = cfg.SLOT_STEP_MIN;
  var earliest = now.getTime() + cfg.MIN_NOTICE_HOURS * 3600000;
  var horizon = now.getTime() + cfg.HORIZON_DAYS * 86400000;
  var weekly = cfg.WEEKLY || {};
  for (var i = 0; i < days; i++) {
    var day = addDaysYmd_(fromYmd, i);
    var key = ymd_(day);
    var noon = zonedToDate_(day.y, day.m, day.d, 12, 0, cfg.TIMEZONE);
    var dow = localParts_(noon, cfg.TIMEZONE).isoDow;
    var windows = weekly[dow] || [];
    if (!windows.length) continue;
    if (cfg.CLOSED_DATE_LIST.indexOf(key) >= 0) continue;
    var seen = {}, times = [];
    windows.forEach(function (w) {
      for (var t = w.from; t + dur <= w.to; t += step) if (!seen[t]) { seen[t] = true; times.push(t); }
    });
    times.sort(function (a, b) { return a - b; });
    times.forEach(function (t) {
      var start = zonedToDate_(day.y, day.m, day.d, Math.floor(t / 60), t % 60, cfg.TIMEZONE);
      var end = new Date(start.getTime() + dur * 60000);
      if (start.getTime() < earliest || start.getTime() < now.getTime()) return;
      if (start.getTime() > horizon) return;
      out.push({ start: start, end: end, date: key, time: pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60) });
    });
  }
  return out;
}

/**
 * Cruce: profesional (solo si hay calendario configurado) y después los consultorios elegibles.
 * busyMap: { calendarId: [{start:Date,end:Date}] , errors: {calendarId: true} }
 * Un calendario con error se considera NO disponible (falla cerrada).
 * @return [{start, end, date, time, rooms:[calendarId…]}]
 */
function crossAvailability_(cfg, candidates, busyMap) {
  var pro = cfg.PRO_CALENDAR_ID;
  var errors = busyMap.errors || {};
  if (pro && errors[pro]) return [];
  var before = cfg.BUFFER_BEFORE_MIN * 60000, after = cfg.BUFFER_AFTER_MIN * 60000;
  var out = [];
  candidates.forEach(function (c) {
    var s = new Date(c.start.getTime() - before), e = new Date(c.end.getTime() + after);
    if (pro && !isFree_(busyMap[pro] || [], s, e)) return;    // 1) profesional
    var rooms = cfg.ROOM_CALENDAR_LIST.filter(function (r) {    // 2) consultorios
      return !errors[r] && isFree_(busyMap[r] || [], s, e);
    });
    if (rooms.length) out.push({ start: c.start, end: c.end, date: c.date, time: c.time, rooms: rooms });
  });
  return out;
}

/**
 * Arma una "página" de opciones: un horario por franja (primera hora de la tarde, media tarde, noche),
 * el más próximo en cada una. La página 1 trae el segundo más próximo de cada franja, y así.
 * Si una franja no tiene horario, se completa con otros horarios libres (p. ej. de mañana).
 * @return {slots:[slot+{band}], hasMore:boolean}
 */
function pickByBands_(cfg, slots, now, page, excludeIso) {
  var soonLimit = now.getTime() + cfg.RECOMMEND_WITHIN_HOURS * 3600000;
  var buckets = cfg.BAND_LIST.map(function () { return []; }), others = [];
  slots.forEach(function (s) {
    if (excludeIso && s.start.toISOString() === excludeIso) return;
    var t = parseHm_(s.time);
    var i = -1;
    cfg.BAND_LIST.some(function (b, j) { if (t >= b.from && t < b.to) { i = j; return true; } return false; });
    (i >= 0 ? buckets[i] : others).push(s);
  });
  var picked = [];
  buckets.forEach(function (list, i) {
    var s = list[page];
    if (s) picked.push(withBand_(s, cfg.BAND_LIST[i].label, soonLimit));
  });
  var missing = cfg.RECOMMEND_COUNT - picked.length;
  var fillFrom = page * cfg.RECOMMEND_COUNT;
  others.slice(fillFrom, fillFrom + Math.max(missing, 0)).forEach(function (s) { picked.push(withBand_(s, '', soonLimit)); });
  picked.sort(function (a, b) { return a.start - b.start; }); // se muestran en orden de fecha y hora
  var hasMore = buckets.some(function (list) { return list.length > page + 1; }) ||
                others.length > (page + 1) * cfg.RECOMMEND_COUNT;
  return { slots: picked, hasMore: hasMore };
}

function withBand_(s, label, soonLimit) {
  return { start: s.start, end: s.end, date: s.date, time: s.time, rooms: s.rooms, band: label, soon: s.start.getTime() <= soonLimit };
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
  var busy = fetchBusy_(calendarIds_(cfg), tMin, tMax, cfg.TIMEZONE);
  var anyError = Object.keys(busy.errors).length > 0;
  return { slots: crossAvailability_(cfg, cands, busy), calendarErrors: anyError };
}

/** Calendarios a consultar: profesional (si está configurado) + consultorios. */
function calendarIds_(cfg) { return [cfg.PRO_CALENDAR_ID].concat(cfg.ROOM_CALENDAR_LIST).filter(Boolean); }

/**
 * Recomendación por franjas: busca desde hoy en tramos de MAX_DAYS_PER_QUERY días hasta que cada
 * franja tenga un horario más allá de la página pedida (para saber si hay "siguientes") o hasta el horizonte.
 */
function recommendSlots_(cfg, now, page, excludeIso) {
  page = Math.max(0, Math.min(Number(page) || 0, 20));
  var lp = localParts_(now, cfg.TIMEZONE);
  var from = { y: lp.y, m: lp.m, d: lp.d };
  var chunk = Math.max(1, cfg.MAX_DAYS_PER_QUERY);
  var found = [], anyError = false;
  for (var offset = 0; offset <= cfg.HORIZON_DAYS; offset += chunk) {
    var r = computeAvailability_(cfg, addDaysYmd_(from, offset), chunk, now);
    anyError = anyError || r.calendarErrors;
    found = found.concat(r.slots);
    var enough = cfg.BAND_LIST.every(function (b) {
      return found.filter(function (s) { var t = parseHm_(s.time); return t >= b.from && t < b.to; }).length > page + 1;
    });
    if (enough) break;
  }
  var res = pickByBands_(cfg, found, now, page, excludeIso);
  res.calendarErrors = anyError;
  return res;
}
