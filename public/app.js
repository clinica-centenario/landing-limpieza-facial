/* Clínica Centenario — Limpieza facial profunda · lógica de la landing */
(function () {
  'use strict';
  var CFG = window.CC_CONFIG || {};
  var TZ = CFG.TIMEZONE || 'America/Montevideo';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var PAGE_LOADED_AT = Date.now();

  // ── Almacenamiento tolerante a fallos ─────────────────────
  var store = {
    get: function (area, k) { try { return JSON.parse(window[area].getItem(k)); } catch (e) { return null; } },
    set: function (area, k, v) { try { window[area].setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (area, k) { try { window[area].removeItem(k); } catch (e) {} }
  };

  // ── Modo demo (solo local, explícito, visible) ────────────
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  var params = new URLSearchParams(location.search);
  var DEMO = !CFG.API_URL && ((isLocal && params.get('demo') === '1') || window.CC_PREVIEW_DEMO === true);
  if (DEMO) $('#demoBanner').hidden = false;

  function uid() {
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  // ── API ───────────────────────────────────────────────────
  function api(action, payload, timeoutMs) {
    var body = Object.assign({ action: action }, payload);
    if (DEMO) return (window.__ccDemoReady || Promise.resolve()).then(function () { return window.CCDemoApi ? window.CCDemoApi.handle(body) : { ok: false, code: 'not_configured' }; });
    if (!CFG.API_URL) return Promise.resolve({ ok: false, code: 'not_configured' });
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 30000);
    return fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).catch(function () { return { ok: false, code: 'network' }; })
      .finally(function () { clearTimeout(timer); });
  }

  // ── Medición (Meta Pixel) ─────────────────────────────────
  // Nunca se envían nombre, celular, email ni datos de piel/salud como parámetros.
  var Track = (function () {
    var log = window.__ccTrackLog = [];
    var fired = store.get('sessionStorage', 'cc_fired') || {};
    var consent = CFG.TRACKING_CONSENT_MODE === 'none' ? 'yes' : (store.get('localStorage', 'cc_track_consent') || null);
    var loaded = false;
    var STANDARD = { PageView: 1, Lead: 1, Schedule: 1 };

    function loadPixel() {
      if (loaded || !CFG.META_PIXEL_ID || DEMO) return;
      loaded = true;
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
      s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', CFG.META_PIXEL_ID);
    }
    function allowed() { return consent === 'yes'; }

    /** dedupeKey: si ya se disparó en esta sesión, no se repite (recargas, reintentos, doble clic). */
    function send(name, opts) {
      opts = opts || {};
      var key = opts.dedupeKey || name;
      if (fired[key]) { log.push({ name: name, skipped: 'duplicate' }); return; }
      fired[key] = Date.now(); store.set('sessionStorage', 'cc_fired', fired);
      var entry = { name: name, eventID: opts.eventID || null, sent: false };
      if (allowed() && CFG.META_PIXEL_ID && !DEMO) {
        loadPixel();
        var extra = opts.eventID ? { eventID: opts.eventID } : undefined;
        if (STANDARD[name]) window.fbq('track', name, {}, extra); else window.fbq('trackCustom', name, {}, extra);
        entry.sent = true;
      }
      log.push(entry);
    }
    function setConsent(v) {
      consent = v; store.set('localStorage', 'cc_track_consent', v);
      if (v === 'yes') send('PageView', { dedupeKey: 'PageView:' + location.pathname + ':' + PAGE_LOADED_AT });
    }
    function cookie(n) { var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
    function serverHints() { return { trackingConsent: allowed(), fbp: cookie('_fbp'), fbc: cookie('_fbc'), userAgent: navigator.userAgent }; }

    return {
      init: function () {
        if (consent === 'yes') send('PageView', { dedupeKey: 'PageView:' + location.pathname + ':' + PAGE_LOADED_AT });
        else if (consent === null && CFG.META_PIXEL_ID && !DEMO) $('#consent').hidden = false;
      },
      send: send, setConsent: setConsent, serverHints: serverHints
    };
  })();

  $$('[data-consent]').forEach(function (b) {
    b.addEventListener('click', function () { Track.setConsent(b.getAttribute('data-consent')); $('#consent').hidden = true; });
  });

  // ── UTM / origen ──────────────────────────────────────────
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid'];
  var utm = store.get('sessionStorage', 'cc_utm') || {};
  UTM_KEYS.forEach(function (k) { if (params.get(k)) utm[k] = params.get(k).slice(0, 150); });
  store.set('sessionStorage', 'cc_utm', utm);
  var landingUrl = store.get('sessionStorage', 'cc_landing_url') || (location.origin + location.pathname + location.search);
  store.set('sessionStorage', 'cc_landing_url', landingUrl);

  // ── Fechas en hora de Montevideo ──────────────────────────
  function fmt(d, o) { return new Intl.DateTimeFormat('es-UY', Object.assign({ timeZone: TZ }, o)).format(d); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function localYmd(d) {
    var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function ymdToUtcNoon(ymd) { var a = ymd.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2], 15)); } // 12:00 en UY
  function addDays(ymd, n) { var d = ymdToUtcNoon(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function longDate(ymd) { return cap(fmt(ymdToUtcNoon(ymd), { weekday: 'long', day: 'numeric', month: 'long' })); }
  function endTime(startIso, min) { return fmt(new Date(new Date(startIso).getTime() + min * 60000), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }

  // ── Stepper ───────────────────────────────────────────────
  // n = panel a mostrar (1, 2, 3 o 'wa'); step = paso resaltado en el indicador (por defecto, n).
  function goStep(n, step) {
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== String(n); });
    n = typeof step === 'number' ? step : n;
    $$('.stepper li').forEach(function (li) {
      var s = +li.getAttribute('data-step');
      li.classList.toggle('is-active', s === n); li.classList.toggle('is-done', s < n);
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  function setBusy(btn, busy, label) {
    if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + (label || 'Procesando…'); }
    else { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = btn.dataset.label || btn.textContent; }
  }
  function status(el, msg, kind) { el.textContent = msg || ''; el.className = 'form-status' + (kind ? ' is-' + kind : ''); }

  // ── Datos de contacto (reserva y análisis de piel usan la misma solicitud) ──
  var session = store.get('sessionStorage', 'cc_lead'); // { requestId, token, leadEventId }

  function normalizePhone(raw) {
    var d = String(raw || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+') > 0) return null;
    d = d.replace(/^\+/, '').replace(/^00/, '');
    if (/^598/.test(d)) d = d.slice(3);
    if (/^0/.test(d)) d = d.slice(1);
    return /^9\d{7}$/.test(d) ? '+598' + d : null;
  }
  function validName(s) { s = s.replace(/\s+/g, ' ').trim(); return /^[A-Za-zÀ-ÖØ-öø-ÿÑñ' .\-]+$/.test(s) && s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÑñ]/g, '').length >= 2; }
  function validEmail(s) { return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(s.trim()); }

  /**
   * Formulario de datos mínimos. Guarda en el servidor antes de seguir; un reintento con los
   * mismos datos reutiliza la clave de envío y no crea otra solicitud.
   * o: { form, btn, statusEl, p (prefijo de inputs), e (prefijo de errores), origin, marketing, onSaved }
   */
  function bindLeadForm(o) {
    var submitKey = null, lastFp = null, sending = false;
    var fields = ['firstName', 'lastName', 'phone', 'email'];
    function input(f) { return $('#' + o.p + '-' + f); }
    function showErr(field, show) {
      var el = input(field), err = $('#' + o.e + '-' + field);
      if (el) el.setAttribute('aria-invalid', show ? 'true' : 'false');
      if (err) err.hidden = !show;
    }
    o.form.addEventListener('focusin', function once() {
      Track.send('formulario_abierto', { dedupeKey: 'formulario_abierto:' + PAGE_LOADED_AT });
      o.form.removeEventListener('focusin', once);
    });
    fields.forEach(function (f) {
      input(f).addEventListener('blur', function () {
        var v = this.value; if (!v) return;
        showErr(f, !(f === 'phone' ? normalizePhone(v) : f === 'email' ? validEmail(v) : validName(v)));
      });
      input(f).addEventListener('input', function () { if (this.getAttribute('aria-invalid') === 'true') showErr(f, false); });
    });
    input('consent').addEventListener('change', function () { if (this.checked) showErr('consent', false); });

    o.form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return; // evita doble envío
      var v = {}; fields.forEach(function (f) { v[f] = input(f).value; }); v.consent = input('consent').checked;
      var marketing = !!(o.marketing && o.marketing.checked);
      var bad = { firstName: !validName(v.firstName), lastName: !validName(v.lastName), phone: !normalizePhone(v.phone), email: !validEmail(v.email), consent: !v.consent };
      Object.keys(bad).forEach(function (k) { showErr(k, bad[k]); });
      var firstBad = fields.concat('consent').filter(function (k) { return bad[k]; })[0];
      if (firstBad) { input(firstBad).focus(); status(o.statusEl, 'Revisá los datos marcados.', 'error'); return; }

      // Misma combinación de datos → misma clave: un reintento no crea otra solicitud.
      var fp = [v.firstName.trim(), v.lastName.trim(), normalizePhone(v.phone), v.email.trim().toLowerCase(), marketing].join('|');
      if (fp !== lastFp) { submitKey = 'sub_' + uid(); lastFp = fp; }

      sending = true; setBusy(o.btn, true, 'Guardando tus datos…'); status(o.statusEl, '');
      var tsInput = $('input[name="cf-turnstile-response"]');
      api('lead', Object.assign({
        firstName: v.firstName, lastName: v.lastName, phone: v.phone, email: v.email, origin: o.origin, consent: true, marketing: marketing,
        website: input('website').value, elapsedMs: Date.now() - PAGE_LOADED_AT, submitKey: submitKey,
        pageUrl: landingUrl, utm: utm, consentVersion: CFG.CONSENT_VERSION,
        turnstileToken: tsInput ? tsInput.value : ''
      }, Track.serverHints())).then(function (res) {
        sending = false; setBusy(o.btn, false);
        if (res.ok) {
          session = { requestId: res.requestId, token: res.token, leadEventId: res.leadEventId };
          store.set('sessionStorage', 'cc_lead', session);
          // Lead SOLO cuando el servidor confirmó el guardado.
          Track.send('Lead', { eventID: res.leadEventId, dedupeKey: 'Lead:' + res.requestId });
          status(o.statusEl, 'Datos guardados.', 'ok');
          o.onSaved();
          return;
        }
        if (res.code === 'validation' && res.errors) {
          Object.keys(res.errors).forEach(function (k) { showErr(k, true); });
          status(o.statusEl, 'Revisá los datos marcados.', 'error'); return;
        }
        var msgs = {
          too_fast: 'Revisá tus datos y volvé a tocar «Continuar».',
          rate_limited: 'Recibimos varios intentos seguidos. Esperá unos minutos y probá de nuevo.',
          captcha_failed: 'No pudimos verificar el formulario. Probá de nuevo.',
          not_configured: 'Este servicio todavía no está habilitado. Probá más tarde.',
          network: 'No pudimos guardar tus datos por un problema de conexión. Tus datos siguen acá: tocá «Continuar» para reintentar.'
        };
        status(o.statusEl, msgs[res.code] || 'No pudimos guardar tus datos. Tus datos siguen acá: probá de nuevo en un momento.', 'error');
      });
    });
  }

  var leadStatus = $('#leadStatus');
  bindLeadForm({ form: $('#leadForm'), btn: $('#leadBtn'), statusEl: leadStatus, p: 'f', e: 'e', origin: 'reserva',
    marketing: $('#f-marketing'), onSaved: function () { startScheduling(); } });

  // ── Paso 2: horarios recomendados ─────────────────────────
  // El servidor ofrece un horario por franja (primera hora de la tarde, media tarde, noche).
  // "Ver otros horarios" pide los siguientes; "No me sirven" lleva a otra pantalla con WhatsApp.
  var todayYmd = localYmd(new Date());
  var state = { slots: [], slot: null, page: 0, hasMore: false, durationMin: 60, whatsapp: '', idem: {}, booking: false, loaded: false };
  var slotsEl = $('#slots'), slotState = $('#slotState'), confirmBox = $('#confirmBox'), bookBtn = $('#bookBtn'), bookStatus = $('#bookStatus');

  function startScheduling() {
    goStep(2);
    loadRecommendations(0);
    var b = $('#booking'); if (b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSkeleton() {
    slotsEl.innerHTML = '';
    for (var i = 0; i < 3; i++) { var s = document.createElement('div'); s.className = 'skeleton'; slotsEl.appendChild(s); }
    slotState.textContent = ''; confirmBox.hidden = true; $('#recNav').hidden = true; $('#noneFit').hidden = true;
  }

  function waNumber() { return String(state.whatsapp || CFG.WHATSAPP_NUMBER || '').replace(/\D/g, ''); }
  function waUrl(msg) { var n = waNumber(); return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg) : ''; }

  function loadRecommendations(page) {
    state.slot = null; state.loaded = true;
    renderSkeleton();
    return api('availability', { requestId: session.requestId, token: session.token, page: page })
      .then(function (res) {
        if (!res.ok) return availabilityError(res);
        state.page = res.page || 0; state.hasMore = !!res.hasMore;
        state.durationMin = res.durationMin || 60;
        state.whatsapp = res.whatsapp || '';
        renderRecommendations(res.slots || []);
        if (state.slots.length) Track.send('vio_horarios', { dedupeKey: 'vio_horarios:' + session.requestId });
      });
  }

  function availabilityError(res) {
    slotsEl.innerHTML = '';
    if (res.code === 'invalid_token') { store.del('sessionStorage', 'cc_lead'); session = null; state.loaded = false; goStep(1); status(leadStatus, 'Tu sesión venció. Volvé a tocar «Continuar y ver horarios».', 'error'); return; }
    if (res.code === 'calendar_not_configured' || res.code === 'not_configured') { slotState.textContent = 'Tus datos quedaron guardados, pero la agenda online todavía no está habilitada. Te vamos a contactar para coordinar tu horario.'; return; }
    slotState.innerHTML = '';
    slotState.appendChild(document.createTextNode('No pudimos cargar los horarios. '));
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = 'Reintentar';
    b.onclick = function () { loadRecommendations(state.page); }; slotState.appendChild(b);
  }

  /** "Hoy", "Mañana" o "Jueves 6 de noviembre". */
  function dayLabel(ymd) {
    if (ymd === todayYmd) return 'Hoy';
    if (ymd === addDays(todayYmd, 1)) return 'Mañana';
    return longDate(ymd);
  }

  function renderRecommendations(list) {
    state.slots = list;
    slotsEl.innerHTML = ''; confirmBox.hidden = true; status(bookStatus, '');
    slotState.textContent = list.length ? '' : (state.page > 0 ? 'No encontramos más horarios libres.' : 'Por ahora no hay horarios libres para reservar online.');
    list.forEach(function (s, i) { slotsEl.appendChild(slotButton(s, i === 0)); });
    rovingKeys(slotsEl, '.rec');
    $('#moreSlots').hidden = !state.hasMore;
    $('#prevSlots').hidden = state.page === 0;
    $('#recNav').hidden = $('#moreSlots').hidden && $('#prevSlots').hidden;
    // "No me sirven" aparece después de ver otras opciones, o si no hay más para ofrecer.
    $('#noneFit').hidden = state.page === 0 && state.hasMore;
  }

  function slotButton(s, focusable) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'rec'; b.setAttribute('role', 'radio');
    var sel = state.slot && state.slot.start === s.start;
    b.setAttribute('aria-checked', String(!!sel)); b.tabIndex = (sel || (!state.slot && focusable)) ? 0 : -1;
    b.dataset.start = s.start;
    var txt = document.createElement('span');
    if (s.band) { var l = document.createElement('span'); l.className = 'rl'; l.textContent = s.band; txt.appendChild(l); }
    var d = document.createElement('span'); d.className = 'rd'; d.textContent = dayLabel(s.date);
    var t = document.createElement('span'); t.className = 'rt'; t.textContent = s.time + ' a ' + endTime(s.start, state.durationMin) + ' h';
    txt.appendChild(d); txt.appendChild(t); b.appendChild(txt);
    if (s.soon) { var badge = document.createElement('span'); badge.className = 'rb'; badge.textContent = 'Próximas 24 h'; b.appendChild(badge); }
    b.setAttribute('aria-label', (s.band ? s.band + ': ' : '') + longDate(s.date) + ', ' + s.time + ' a ' + endTime(s.start, state.durationMin) + ', hora de Montevideo');
    b.addEventListener('click', function () { selectSlot(s); });
    return b;
  }

  function selectSlot(s) {
    state.slot = s;
    $$('.rec').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.start === s.start)); });
    if (!state.idem[s.start]) state.idem[s.start] = 'idem_' + uid();
    Track.send('eligio_horario', { dedupeKey: 'eligio_horario:' + session.requestId + ':' + s.start });
    api('track', { event: 'eligio_horario', requestId: session.requestId, token: session.token, start: s.start });
    $('#confirmWhen').textContent = longDate(s.date) + ' · ' + s.time + ' a ' + endTime(s.start, state.durationMin) + ' h';
    confirmBox.hidden = false; status(bookStatus, '');
    if (window.matchMedia('(max-width: 899px)').matches) confirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Con los datos ya guardados (p. ej. desde el análisis de piel) la reserva arranca en el paso 2,
   *  y los horarios se piden recién cuando la persona llega a esa sección. */
  function prepareScheduling() {
    goStep(2); state.loaded = false;
    renderSkeleton();
    var booking = $('#booking');
    if (!('IntersectionObserver' in window)) return loadRecommendations(0);
    var io = new IntersectionObserver(function (e) {
      if (!e[0].isIntersecting) return;
      io.disconnect();
      if (!state.loaded && session) loadRecommendations(0);
    });
    io.observe(booking);
  }

  $('#payWa').addEventListener('click', function () { Track.send('pagar_whatsapp', { dedupeKey: 'pagar_whatsapp:' + PAGE_LOADED_AT }); });
  $('#moreSlots').addEventListener('click', function () { loadRecommendations(state.page + 1); });
  $('#prevSlots').addEventListener('click', function () { loadRecommendations(Math.max(0, state.page - 1)); });

  // Pantalla aparte: ningún horario le sirve → WhatsApp
  $('#noneFit').addEventListener('click', function () {
    var url = waUrl('Hola, quiero reservar una limpieza facial profunda y ninguno de los horarios de la web me sirve.' +
      (session && session.requestId ? ' Mi solicitud es ' + session.requestId + '.' : ''));
    $('#waLink').hidden = !url;
    if (url) $('#waLink').href = url;
    status($('#waStatus'), url ? '' : 'Tus datos quedaron guardados: te vamos a contactar para coordinar el horario.', url ? '' : 'ok');
    Track.send('ningun_horario_sirve', { dedupeKey: 'ningun_horario_sirve:' + session.requestId });
    goStep('wa', 2);
    $('#waPanel').focus({ preventScroll: true });
  });
  $('#waBack').addEventListener('click', function () { goStep(2); });

  function rovingKeys(container, sel) {
    container.onkeydown = function (e) {
      var items = $$(sel, container); var i = items.indexOf(document.activeElement); if (i < 0) return;
      var n = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!n) return;
      e.preventDefault(); var t = items[(i + n + items.length) % items.length];
      items.forEach(function (x) { x.tabIndex = -1; }); t.tabIndex = 0; t.focus();
    };
  }

  // ── Confirmación ──────────────────────────────────────────
  bookBtn.addEventListener('click', function () { if (!state.booking && state.slot) confirmBooking(state.slot, 0); });

  function confirmBooking(slot, attempt) {
    state.booking = true; setBusy(bookBtn, true, 'Confirmando…'); status(bookStatus, '');
    api('book', Object.assign({ requestId: session.requestId, token: session.token, start: slot.start, idempotencyKey: state.idem[slot.start], pageUrl: landingUrl }, Track.serverHints()))
      .then(function (res) {
        if (!res.ok && res.code === 'busy_retry' && attempt < 2) { setTimeout(function () { confirmBooking(slot, attempt + 1); }, 1500); return; }
        state.booking = false; setBusy(bookBtn, false);
        if (res.ok) return showDone(res);
        if (res.code === 'already_booked' && res.booking) return showDone(res.booking);
        if (res.code === 'slot_unavailable') return showAlternatives(res.alternatives || []);
        var msgs = {
          busy_retry: 'Hay mucha demanda en este momento. Tocá «Confirmar reserva» de nuevo.',
          calendar_error: 'No pudimos registrar la reserva. No quedó nada agendado: probá de nuevo o elegí otro horario.',
          needs_reconciliation: 'Hubo un problema al confirmar y lo estamos revisando. Tus datos quedaron guardados; por favor no vuelvas a reservar este horario por ahora.',
          invalid_token: 'Tu sesión venció. Recargá la página para continuar.',
          network: 'No pudimos confirmar si la reserva quedó hecha por un problema de conexión. Tocá «Confirmar reserva» otra vez: no se va a duplicar.'
        };
        status(bookStatus, msgs[res.code] || 'No pudimos confirmar la reserva. Probá de nuevo.', 'error');
      });
  }

  function showAlternatives(alts) {
    var lost = state.slot;
    state.page = 0; state.hasMore = true;
    renderRecommendations(alts);
    var p = document.createElement('p'); p.style.margin = '0';
    p.textContent = 'El horario de las ' + lost.time + ' se acaba de ocupar. ' + (alts.length ? 'Estos siguen libres:' : 'Por ahora no quedan otros horarios online.');
    slotState.innerHTML = ''; slotState.appendChild(p);
    slotState.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Paso 3 ────────────────────────────────────────────────
  function showDone(b, opts) {
    // Schedule SOLO con la reserva confirmada por el servidor.
    Track.send('Schedule', { eventID: b.scheduleEventId, dedupeKey: 'Schedule:' + b.bookingId });
    store.set('sessionStorage', 'cc_booking', b);
    goStep(3, 4); // reserva confirmada; queda el paso 4: pago
    var dl = $('#summary'); dl.innerHTML = '';
    [['Fecha', longDate(b.date)], ['Hora', b.time + ' a ' + endTime(b.startIso, b.durationMin) + ' (hora de Montevideo)'], ['Profesional', b.professional],
     ['Duración', b.durationMin + ' minutos'], ['Dirección', b.address], ['N.º de reserva', b.bookingId]].forEach(function (r) {
      var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = r[0]; dd.textContent = r[1]; dl.appendChild(dt); dl.appendChild(dd);
    });
    var title = 'Limpieza facial profunda — Clínica Centenario';
    var details = 'Sesión de ' + b.durationMin + ' minutos con ' + b.professional + '. Reserva ' + b.bookingId + '.';
    var z = function (iso) { return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    $('#gcalLink').href = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) +
      '&dates=' + z(b.startIso) + '/' + z(b.endIso) + '&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(b.address) + '&ctz=' + encodeURIComponent(TZ);
    if (b.emailSent) { $('#mailNote').textContent = 'Te enviamos la confirmación a tu correo.'; $('#mailNote').hidden = false; }
    // Paso 4: pagar la consulta por WhatsApp, con la reserva ya escrita en el mensaje.
    if (b.whatsapp) state.whatsapp = b.whatsapp;
    var pay = waUrl('Hola, quiero pagar mi reserva ' + b.bookingId + ' de limpieza facial del ' + longDate(b.date).toLowerCase() + ' a las ' + b.time + ' h.');
    $('#payWa').hidden = !pay; $('#payNoWa').hidden = !!pay;
    if (pay) $('#payWa').href = pay;
    if (CFG.PAYMENT && CFG.PAYMENT.confirmed && CFG.PAYMENT.instructionsAfterBooking) { $('#payAfter').textContent = CFG.PAYMENT.instructionsAfterBooking; $('#payAfter').hidden = false; }
    if (CFG.CANCELLATION_POLICY) { $('#cancelPolicy').textContent = CFG.CANCELLATION_POLICY; $('#cancelPolicy').hidden = false; }
    if (opts && opts.restore) return;
    var panel = $('#donePanel'); panel.focus({ preventScroll: true });
    $('#booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Contenido configurable ────────────────────────────────
  (function content() {
    var P = CFG.PAYMENT || {};
    if (P.confirmed && P.method && P.deadline) {
      var t = 'Para acceder al precio de $1.824, pagá por ' + P.method + ' ' + P.deadline + '. Si no se concreta el pago anticipado, el precio es el de lista ($2.280).';
      $('#faqPayment').textContent = t; $('#paymentTerms').textContent = t; $('#paymentTerms').hidden = false;
    }
    if (CFG.PRIVACY_CONTACT) $('#privacyContact').textContent = ', escribiendo a ' + CFG.PRIVACY_CONTACT;
    var reviews = (CFG.REVIEWS || []).filter(function (r) { return r && r.text && r.author; });
    if (reviews.length) {
      var box = $('#reviews');
      reviews.forEach(function (r) {
        var q = document.createElement('blockquote'); q.className = 'card';
        var p = document.createElement('p'); p.textContent = r.text; var f = document.createElement('footer'); f.textContent = r.author + (r.date ? ' · ' + r.date : '');
        q.appendChild(p); q.appendChild(f); box.appendChild(q);
      });
      $('#resenas').hidden = false;
    }
    if (CFG.CANONICAL_URL) { var c = $('link[rel=canonical]'); if (c) c.href = CFG.CANONICAL_URL; }
    if (CFG.TURNSTILE_SITE_KEY) {
      var ts = $('#turnstile'); ts.hidden = false; ts.className = 'turnstile cf-turnstile'; ts.setAttribute('data-sitekey', CFG.TURNSTILE_SITE_KEY); ts.setAttribute('data-language', 'es');
      var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; s.async = true; document.head.appendChild(s);
    }
  })();

  // ── Fotos ─────────────────────────────────────────────────
  (function photos() {
    var P = window.CC_PHOTOS || {};
    function picture(ph, eager, sizes) {
      var pic = document.createElement('picture');
      ['avif', 'webp'].forEach(function (fmtName) {
        if (!ph[fmtName]) return; var s = document.createElement('source'); s.type = 'image/' + fmtName; s.srcset = ph[fmtName]; s.sizes = sizes; pic.appendChild(s);
      });
      var img = document.createElement('img'); img.src = ph.fallback; img.srcset = ph.jpg || ''; img.sizes = sizes; img.alt = ph.alt || '';
      img.width = ph.width; img.height = ph.height; img.decoding = 'async';
      if (eager) { img.loading = 'eager'; img.setAttribute('fetchpriority', 'high'); } else img.loading = 'lazy';
      if (ph.position) img.style.objectPosition = ph.position;
      pic.appendChild(img); return pic;
    }
    [['hero', true, '(min-width: 900px) 520px, 100vw'], ['pro', false, '(min-width: 900px) 460px, 100vw']].forEach(function (x) {
      var ph = P[x[0]]; var slot = $('[data-photo-slot="' + x[0] + '"]'); if (!slot) return;
      if (!ph) { if (!DEMO) { slot.parentNode.classList.add('no-photo'); slot.remove(); } return; }
      slot.innerHTML = ''; slot.appendChild(picture(ph, x[1], x[2]));
    });
    if (P.gallery && P.gallery.length) {
      var g = $('#gallery');
      P.gallery.forEach(function (ph) { var f = document.createElement('figure'); if (ph.wide) f.className = 'wide'; f.appendChild(picture(ph, false, ph.wide ? '(min-width: 900px) 540px, 100vw' : '(min-width: 900px) 270px, 50vw')); g.appendChild(f); });
      $('#fotos').hidden = false;
    }
  })();

  // ── Evaluá tu cara con IA ─────────────────────────────────
  // Recorrido: introducción → cámara guiada (frente, un costado, el otro) → 4 preguntas → datos → resultado.
  // Las fotos se analizan SOLO en el teléfono: MediaPipe Face Landmarker (el modelo Apache-2.0 que incluye
  // UniFace) ubica el rostro y sus zonas, y se miden brillo, textura, tono, rojez relativa y, en prueba,
  // puntos oscuros en la nariz y poros. Las fotos nunca se envían ni se guardan: al servidor llegan solo
  // las categorías encontradas y los números medidos (para calibrar).
  // Analítica: solo hitos del recorrido, nunca respuestas, perfiles ni hallazgos.
  var QUIZ = [
    { k: 'sequedad', q: 'Después de lavarte la cara, ¿sentís tirantez o se te descama?', o: [['siempre', 'Sí, casi siempre'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
    { k: 'reactividad', q: '¿Tu piel arde, pica o se enrojece con algunos productos?', o: [['seguido', 'Sí, seguido'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
    { k: 'mejorar', multi: true, max: 2, q: '¿Qué te gustaría mejorar? Elegí hasta 2.', o: [['puntos_negros', 'Puntos negros'], ['poros', 'Poros'], ['suavidad', 'Suavidad'], ['luminosidad', 'Luminosidad'], ['confort', 'Confort e hidratación'], ['brillo', 'Brillo']] },
    { k: 'aplica', multi: true, exclusive: ['ninguna'], q: '¿Algo de esto aplica ahora?', o: [['exfoliantes', 'Uso exfoliantes o retinoides (retinol, ácido retinoico)'], ['procedimiento', 'Me hice un procedimiento en el rostro en el último mes'], ['lesiones', 'Tengo irritación fuerte, heridas o una lesión que duele, cambia o sangra'], ['ninguna', 'Ninguna']] }
  ];
  var QUIZ_NO_PHOTO = { k: 'brillo', q: 'A media tarde, ¿cómo está tu piel?', o: [['toda', 'Con brillo en toda la cara'], ['zona_t', 'Con brillo solo en frente, nariz y mentón'], ['no', 'Sin brillo notable'], ['nose', 'No sé']] };

  // Controles técnicos de la foto. Valores iniciales: calibrarlos con fotos reales de distintos tonos de piel,
  // teléfonos y luces. La exposición se mide por recortes extremos y contraste, no por brillo promedio,
  // para no penalizar pieles oscuras. Maquillaje, filtros y modo belleza NO se detectan: se pide a la persona.
  var PHOTO_RULES = { minFaceWidth: 0.28, minYawBalance: 0.55, maxRollDeg: 12, minSharpness: 45,
    maxClipHigh: 0.12, maxClipLow: 0.30, minContrast: 30, maxCheekRatio: 1.7 };
  // Guía de cámara: posición dentro del óvalo y giro (s = -1..1; 0 = de frente).
  var CAM_RULES = { frontMaxTurn: 0.18, sideMinTurn: 0.30, sideMaxTurn: 0.80, centerTol: 0.10, minSize: 0.42, sideMinSize: 0.28, maxSize: 0.80, holdFrames: 10 };
  // Indicadores de piel. Umbrales PROVISORIOS (calibrar con ?diagnostico=1). Mediciones de imagen, no un modelo validado.
  var SKIN_RULES = { shineT: 0.05, shineGeneralC: 0.04, shineRatio: 2, rednessDiff: 0.035, texture: 7, toneCv: 0.07,
    noseSpots: 3.5, cheekPores: 7 };
  var DIAG = params.get('diagnostico') === '1';
  var MP_VER = '0.10.14';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  // Zonas de la malla facial de MediaPipe usadas para medir.
  var ZONE_T = [151, 108, 337, 4, 195, 5], CHEEK_R = [50, 117, 205], CHEEK_L = [280, 346, 425];
  var ZONE_NOSE = [48, 278, 4, 45, 275], ZONE_PORES = [205, 425, 36, 266];

  // Utilidades de imagen: escala de grises, estadísticas, textura y tono (la del tono descuenta
  // la luz que cambia de a poco, para que la sombra natural de la mejilla no cuente como tono desparejo).
  function grayCrop(canvas, x, y, w, h, size) {
    var k = size / Math.max(1, w), c = document.createElement('canvas');
    c.width = size; c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { g: g, w: c.width, h: c.height };
  }
  function imageStats(im) {
    var g = im.g, w = im.w, h = im.h, n = g.length, hi = 0, lo = 0, hist = new Uint32Array(256), sum = 0, sum2 = 0, m = 0;
    for (var i = 0; i < n; i++) { var v = g[i] | 0; hist[v]++; if (v >= 250) hi++; if (v <= 15) lo++; }
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var p = y * w + x, lap = g[p - w] + g[p + w] + g[p - 1] + g[p + 1] - 4 * g[p];
      sum += lap; sum2 += lap * lap; m++;
    }
    var pct = function (t) { var acc = 0; for (var k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * t) return k; } return 255; };
    return { clipHigh: hi / n, clipLow: lo / n, contrast: pct(0.95) - pct(0.05), sharpness: m ? (sum2 / m - Math.pow(sum / m, 2)) : 0 };
  }
  function meanLum(canvas, x, y, s) {
    var im = grayCrop(canvas, Math.max(0, x), Math.max(0, y), Math.max(1, s), Math.max(1, s), 24), t = 0;
    for (var i = 0; i < im.g.length; i++) t += im.g[i];
    return t / im.g.length;
  }
  function lapEnergy(im) {
    var g = im.g, w = im.w, h = im.h, s = 0, m = 0, mean = 0;
    for (var i = 0; i < g.length; i++) mean += g[i];
    mean /= g.length;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var p = y * w + x; s += Math.abs(g[p - w] + g[p + w] + g[p - 1] + g[p + 1] - 4 * g[p]); m++;
    }
    return m ? (s / m) / (mean + 1) * 100 : 0; // relativo al brillo de la zona
  }
  function detrendedCv(im) {
    var g = im.g, w = im.w, h = im.h, n = g.length, mean = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxg = 0, syg = 0;
    for (var i = 0; i < n; i++) mean += g[i];
    mean /= n;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var cx = x - (w - 1) / 2, cy = y - (h - 1) / 2, v = g[y * w + x] - mean;
      sxx += cx * cx; syy += cy * cy; sxg += cx * v; syg += cy * v;
    }
    var b = sxx ? sxg / sxx : 0, c = syy ? syg / syy : 0, res = 0;
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      var r = g[y2 * w + x2] - mean - b * (x2 - (w - 1) / 2) - c * (y2 - (h - 1) / 2);
      res += r * r;
    }
    return mean ? Math.sqrt(res / n) / mean : 0;
  }

  // ── Detección de elementos puntuales en la piel (en prueba) ─────────────
  // Visión por computadora clásica, en el teléfono: se arma una máscara de piel con la malla facial
  // (sin ojos, cejas, labios ni fosas nasales), se compara cada punto con la piel que lo rodea
  // (luminosidad y rojo en CIELab) y se agrupan los puntos distintos por tamaño, forma y contraste.
  // Comparar con el entorno reduce el efecto del tono de piel y de la luz, pero hay falsos positivos
  // (pecas, sombras, vello, poros): los umbrales se calibran con fotos reales (?diagnostico=1).
  // Tamaños en píxeles con el rostro normalizado a 360 px de ancho (≈14 cm de mejilla a mejilla: ≈2,6 px por mm).
  var SPOT_RULES = {
    width: 360,              // ancho al que se normaliza el rostro
    bgRadius: 10,            // radio del "entorno" para comparar (≈4 mm)
    stainBgRadius: 30,       // las manchas son más grandes: se comparan con un entorno más amplio (≈12 mm)
    blackhead: { minDark: 9, maxArea: 12, minCount: 3 },                     // puntos negros: hasta ≈1,5 mm, en la nariz
    mole: { core: 12, minDark: 18, minArea: 8, maxArea: 190, minFill: 0.55 },  // lunares: ≈1,5 a 6 mm, redondos y bien oscuros
    stain: { minDark: 6, maxDark: 30, minArea: 130, maxArea: 2900, minFill: 0.45 }, // manchas: más de ≈5 mm, de bordes suaves
    maxElongation: 2.2,      // formas alargadas = pliegues, arrugas o sombras: no cuentan
    pimple: { minRed: 7, minArea: 20, maxArea: 340, minFill: 0.45 },        // granos: ≈2 a 8 mm, rojos y redondeados
    milium: { minLight: 11, maxChroma: 16, minArea: 1, maxArea: 21 }        // milium: ≈0,5 a 2 mm, claros, pómulos y debajo de los ojos
  };
  var FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  var EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  var EYE_L = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
  var BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
  var LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
  var NOSE_TIP_ZONE = [48, 278, 4, 45, 275, 5, 195];

  function detectSpots(canvas, P) {
    var R = SPOT_RULES, W = canvas.width, H = canvas.height;
    var ox = FACE_OVAL.map(function (i) { return P[i].x * W; }), oy = FACE_OVAL.map(function (i) { return P[i].y * H; });
    var x0 = Math.max(0, Math.min.apply(null, ox)), y0 = Math.max(0, Math.min.apply(null, oy));
    var bw = Math.min(W, Math.max.apply(null, ox)) - x0, bh = Math.min(H, Math.max.apply(null, oy)) - y0;
    var k = R.width / bw, w = R.width, h = Math.max(1, Math.round(bh * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.drawImage(canvas, x0, y0, bw, bh, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data;
    var pt = function (i) { return [(P[i].x * W - x0) * k, (P[i].y * H - y0) * k]; };
    // Máscara de piel: óvalo achicado, menos ojos (agrandados por las pestañas), cejas, labios y fosas nasales.
    var m = document.createElement('canvas'); m.width = w; m.height = h;
    var mc = m.getContext('2d');
    function poly(ids, scale, color) {
      var pts = ids.map(pt), cx = 0, cy = 0;
      pts.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
      mc.beginPath();
      pts.forEach(function (p, j) { var X = cx + (p[0] - cx) * scale, Y = cy + (p[1] - cy) * scale; if (j) mc.lineTo(X, Y); else mc.moveTo(X, Y); });
      mc.closePath(); mc.fillStyle = color; mc.fill();
    }
    poly(FACE_OVAL, 0.88, '#fff');
    poly(EYE_R, 2.2, '#000'); poly(EYE_L, 2.2, '#000'); poly(BROW_R, 1.35, '#000'); poly(BROW_L, 1.35, '#000'); poly(LIPS, 1.2, '#000');
    // Fosas nasales: se excluye solo la abertura (debajo de la punta), no las aletas, donde suele haber puntos negros.
    var nos = [98, 327, 2].map(pt), nr = w * 0.045;
    mc.beginPath(); mc.ellipse((nos[0][0] + nos[1][0]) / 2, (nos[0][1] + nos[1][1]) / 2 + nr * 0.4, Math.abs(nos[1][0] - nos[0][0]) / 2 + nr * 0.2, nr * 0.75, 0, 0, Math.PI * 2); mc.fillStyle = '#000'; mc.fill();
    var md = mc.getImageData(0, 0, w, h).data, n = w * h;
    var skin = new Uint8Array(n), L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (var i = 0, j = 0; j < n; i += 4, j++) {
      skin[j] = md[i] > 127 ? 1 : 0;
      var lab = rgbToLab(px[i], px[i + 1], px[i + 2]); L[j] = lab[0]; A[j] = lab[1]; B[j] = lab[2];
    }
    var bgL = maskedBlur(L, skin, w, h, R.bgRadius), bgA = maskedBlur(A, skin, w, h, R.bgRadius), bgW = maskedBlur(L, skin, w, h, R.stainBgRadius);
    var Ls = maskedBlur(L, skin, w, h, 3); // para manchas: piel suavizada, así la textura no "agujerea" la forma
    // Para manchas se deja afuera una franja junto a los bordes de la piel (pelo, contorno, cejas, labios): ahí hay sombras.
    var ones = new Uint8Array(n).fill(1), skinF = new Float32Array(n);
    for (var s2 = 0; s2 < n; s2++) skinF[s2] = skin[s2];
    var inner = maskedBlur(skinF, ones, w, h, 8);
    // Zonas útiles por tipo. Alrededor de los ojos hay ojeras y sombras: ahí no se buscan manchas ni lunares.
    var noseZone = zoneMask(NOSE_TIP_ZONE.map(pt), w * 0.06, w, h);
    var eyeZone = zoneMask([pt(159), pt(145), pt(33), pt(133), pt(386), pt(374), pt(263), pt(362)], w * 0.09, w, h);
    var eyeL = pt(145), eyeR = pt(374), noseTip = pt(4);
    var miliumZone = function (x, y) { // pómulos, debajo de los ojos y hasta la altura de la nariz (no pegado al ojo)
      var top = Math.max(eyeL[1], eyeR[1]) + w * 0.03, bottom = noseTip[1];
      return y > top && y < bottom && !noseZone[(y | 0) * w + (x | 0)];
    };
    // Una máscara por tipo: si se usa un solo umbral bajo, un lunar se "funde" con la sombra de alrededor.
    var nose = new Uint8Array(n), core = new Uint8Array(n), dark = new Uint8Array(n), red = new Uint8Array(n), light = new Uint8Array(n);
    for (var p = 0; p < n; p++) {
      if (!skin[p]) continue;
      var dL = bgL[p] - L[p], dA = A[p] - bgA[p], chroma = Math.sqrt(A[p] * A[p] + B[p] * B[p]);
      if (noseZone[p]) { if (dL >= R.blackhead.minDark) nose[p] = 1; }
      else if (!eyeZone[p]) { if (dL >= R.mole.core) core[p] = 1; if (inner[p] > 0.98 && bgW[p] - Ls[p] >= R.stain.minDark) dark[p] = 1; }
      if (dA >= R.pimple.minRed && dL < R.mole.minDark) red[p] = 1;
      if (-dL >= R.milium.minLight && chroma < R.milium.maxChroma && L[p] < 97) light[p] = 1; // los reflejos (L≈100) no cuentan
    }
    var found = [], add = function (type, cmp) { found.push({ type: type, x: (cmp.cx / k + x0) / W, y: (cmp.cy / k + y0) / H, r: Math.max(3, Math.sqrt(cmp.area / Math.PI) * 1.8) / k / W }); };
    var stats = function (cmp, bg, img) {
      var dMax = 0, dSum = 0; bg = bg || bgL; img = img || L;
      cmp.pixels.forEach(function (q) { var d = bg[q] - img[q]; dSum += d; if (d > dMax) dMax = d; });
      return { dMax: dMax, dMean: dSum / Math.max(1, cmp.pixels.length), fill: cmp.area / Math.max(1, cmp.bw * cmp.bh),
        elong: Math.max(cmp.bw, cmp.bh) / Math.max(1, Math.min(cmp.bw, cmp.bh)) };
    };
    components(nose, w, h, function (cmp) {
      if (cmp.area <= R.blackhead.maxArea) add('punto_negro', cmp);
    });
    var moleAt = [];
    components(core, w, h, function (cmp) {
      var st = stats(cmp);
      if (cmp.area >= R.mole.minArea && cmp.area <= R.mole.maxArea && st.dMax >= R.mole.minDark && st.fill >= R.mole.minFill && st.elong <= R.maxElongation) {
        add('lunar', cmp); moleAt.push(cmp);
      }
    });
    var stainCand = [];
    components(dark, w, h, function (cmp) {
      var st = stats(cmp, bgW, Ls);
      if (cmp.area >= 40) stainCand.push([cmp.area, +st.dMean.toFixed(1), +st.fill.toFixed(2), +st.elong.toFixed(1)]);
      if (moleAt.some(function (mo) { return Math.abs(mo.cx - cmp.cx) < cmp.bw / 2 + 2 && Math.abs(mo.cy - cmp.cy) < cmp.bh / 2 + 2; })) return; // es el halo de un lunar
      if (cmp.area >= R.stain.minArea && cmp.area <= R.stain.maxArea && st.dMean >= R.stain.minDark && st.dMean <= R.stain.maxDark &&
          st.fill >= R.stain.minFill && st.elong <= R.maxElongation) add('mancha', cmp);
    });
    components(red, w, h, function (cmp) {
      var st = stats(cmp);
      if (cmp.area >= R.pimple.minArea && cmp.area <= R.pimple.maxArea && st.fill >= R.pimple.minFill && st.elong <= R.maxElongation) add('grano', cmp);
    });
    components(light, w, h, function (cmp) {
      if (cmp.area >= R.milium.minArea && cmp.area <= R.milium.maxArea && miliumZone(cmp.cx, cmp.cy)) add('milium', cmp);
    });
    var counts = { grano: 0, punto_negro: 0, milium: 0, lunar: 0, mancha: 0 };
    found.forEach(function (f) { counts[f.type]++; });
    stainCand.sort(function (a, b) { return b[0] - a[0]; });
    return { spots: found, counts: counts, debug: { candidatosMancha: stainCand.slice(0, 5) } };
  }
  /** sRGB → CIELab (D65). */
  function rgbToLab(r, g, b) {
    function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var R = lin(r), G = lin(g), B = lin(b);
    var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  /** Promedio local que solo usa píxeles de piel (imagen integral). */
  function maskedBlur(v, mask, w, h, r) {
    var S = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      var rs = 0, rc = 0;
      for (var x = 0; x < w; x++) {
        var p = y * w + x; rs += mask[p] ? v[p] : 0; rc += mask[p];
        S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + rs; C[(y + 1) * (w + 1) + x + 1] = C[y * (w + 1) + x + 1] + rc;
      }
    }
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      var xa = Math.max(0, xx - r), xb = Math.min(w, xx + r + 1), ya = Math.max(0, yy - r), yb = Math.min(h, yy + r + 1);
      var s = S[yb * (w + 1) + xb] - S[ya * (w + 1) + xb] - S[yb * (w + 1) + xa] + S[ya * (w + 1) + xa];
      var cc = C[yb * (w + 1) + xb] - C[ya * (w + 1) + xb] - C[yb * (w + 1) + xa] + C[ya * (w + 1) + xa];
      out[yy * w + xx] = cc ? s / cc : v[yy * w + xx];
    }
    return out;
  }
  function zoneMask(pts, r, w, h) {
    var z = new Uint8Array(w * h);
    pts.forEach(function (p) {
      for (var y = Math.max(0, (p[1] - r) | 0); y < Math.min(h, p[1] + r); y++) for (var x = Math.max(0, (p[0] - r) | 0); x < Math.min(w, p[0] + r); x++) {
        if ((x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]) <= r * r) z[y * w + x] = 1;
      }
    });
    return z;
  }
  /** Componentes conexos (4 vecinos) de una máscara; llama a fn con área, centro, caja y píxeles. */
  function components(mask, w, h, fn) {
    var seen = new Uint8Array(w * h);
    for (var p = 0; p < w * h; p++) {
      if (!mask[p] || seen[p]) continue;
      var stack = [p], pixels = [], area = 0, minX = w, maxX = 0, minY = h, maxY = 0, sx = 0, sy = 0; seen[p] = 1;
      while (stack.length) {
        var q = stack.pop(), qx = q % w, qy = (q / w) | 0; area++; sx += qx; sy += qy;
        if (area <= 3000) pixels.push(q); // regiones enormes (sombras) se recorren enteras y se descartan
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx; if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        if (qx + 1 < w && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
        if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
        if (qy + 1 < h && mask[q + w] && !seen[q + w]) { seen[q + w] = 1; stack.push(q + w); }
        if (qy > 0 && mask[q - w] && !seen[q - w]) { seen[q - w] = 1; stack.push(q - w); }
      }
      if (area > 3000) continue;
      fn({ area: area, cx: sx / area, cy: sy / area, bw: maxX - minX + 1, bh: maxY - minY + 1, pixels: pixels });
    }
  }

  (function skinOrientation() {
    if (!CFG.AI_ANALYSIS_ENABLED) return;
    $('#analisis').hidden = false; $('#aiHeroLink').hidden = false; $('#aiHeroMicro').hidden = false;
    var card = $('#analisis .ai-tool');
    var answers = {}, quiz = QUIZ, qi = 0, shots = [], measured = null, busy = false, lms = {}, cam = null;

    function show(name) {
      $$('[data-ai]', card).forEach(function (e) { e.hidden = e.getAttribute('data-ai') !== name; });
      if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function getLandmarker(mode) {
      if (lms[mode]) return lms[mode];
      lms[mode] = import(MP_BASE + '/vision_bundle.mjs').then(function (v) {
        return v.FilesetResolver.forVisionTasks(MP_BASE + '/wasm').then(function (fs) {
          return v.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: mode, numFaces: 2 });
        });
      });
      lms[mode].catch(function () { delete lms[mode]; });
      return lms[mode];
    }
    function diag(d) { var b = $('#aiDiag'); if (!DIAG || !d) { b.hidden = true; return; } b.textContent = JSON.stringify(d, null, 1); b.hidden = false; }

    // 1. Introducción
    function needsAdult() {
      if ($('#aiAdult').checked) { status($('#aiIntroStatus'), ''); return false; }
      status($('#aiIntroStatus'), 'Esta evaluación es solo para mayores de 18 años.', 'error'); return true;
    }
    function begin() { Track.send('analisis_inicio', { dedupeKey: 'analisis_inicio:' + PAGE_LOADED_AT }); }
    $('#aiStart').addEventListener('click', function () { if (needsAdult()) return; begin(); startCamera(); });
    $('#aiUploadStart').addEventListener('click', function () { if (needsAdult()) return; begin(); show('camara'); $('#aiFile').click(); });
    $('#aiNoPhoto').addEventListener('click', function () { if (needsAdult()) return; begin(); shots = []; measured = null; startQuiz(); });

    // 2. Cámara guiada
    var STEPS = [{ key: 'frente', label: 'De frente' }, { key: 'lado1', label: 'Un costado' }, { key: 'lado2', label: 'El otro costado' }];
    function setMsg(t, ready) { $('#aiCamMsg').textContent = t; $('#aiCam').classList.toggle('is-ready', !!ready); }
    function startCamera() {
      show('camara'); resetShots(); setMsg('Preparando la cámara…');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraFail('Este navegador no permite usar la cámara.');
      var video = $('#aiVideo');
      Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false }),
        getLandmarker('VIDEO')
      ]).then(function (r) {
        cam = { stream: r[0], lm: r[1], step: 0, hold: 0, firstSign: 0, last: 0, frame: 0, light: null, started: Date.now() };
        video.srcObject = r[0];
        return video.play().then(function () { loop(); });
      }).catch(function (e) {
        cameraFail(e && e.name === 'NotAllowedError' ? 'No diste permiso para usar la cámara.' : 'No pudimos abrir la cámara.');
      });
    }
    function cameraFail(msg) {
      stopCamera(); setMsg(msg);
      status($('#aiCamStatus'), msg + ' Podés subir una foto o hacerlo sin fotos.', 'error');
    }
    function stopCamera() {
      if (cam && cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
      if (cam) cam.stopped = true;
      cam = null;
    }
    function resetShots() {
      shots = []; measured = null; $('#aiThumbs').innerHTML = ''; diag(null);
      $('#aiCamDone').hidden = true; $('#aiRetake').hidden = true; $('#aiSkipSides').hidden = true; status($('#aiCamStatus'), '');
      $('#aiCamStep').textContent = 'Foto 1 de 3 · De frente';
    }
    /** Posición del rostro en el recuadro visible (el video se muestra recortado y en espejo). */
    function faceBox(P, video) {
      var vw = video.videoWidth, vh = video.videoHeight, box = $('#aiCam').getBoundingClientRect();
      var sc = Math.max(box.width / vw, box.height / vh), ox = (vw * sc - box.width) / 2, oy = (vh * sc - box.height) / 2;
      var xs = P.map(function (p) { return 1 - (p.x * vw * sc - ox) / box.width; }), ys = P.map(function (p) { return (p.y * vh * sc - oy) / box.height; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX };
    }
    /** Giro: -1..1 (0 = de frente). El signo distingue un costado del otro. */
    function turnOf(P) { var dl = Math.abs(P[1].x - P[234].x), dr = Math.abs(P[454].x - P[1].x); return (dl - dr) / Math.max(1e-6, dl + dr); }
    function rollOf(P, W, H) { return Math.abs(Math.atan2((P[263].y - P[33].y) * H, (P[263].x - P[33].x) * W) * 180 / Math.PI); }
    function loop() {
      if (!cam || cam.stopped) return;
      var video = $('#aiVideo'), now = performance.now();
      if (now - cam.last < 66 || video.readyState < 2) { requestAnimationFrame(loop); return; } // ~15 cuadros por segundo
      cam.last = now; cam.frame++;
      var res = cam.lm.detectForVideo(video, now), faces = res && res.faceLandmarks || [];
      guide(faces, video);
      requestAnimationFrame(loop);
    }
    function guide(faces, video) {
      var st = STEPS[cam.step], R = CAM_RULES;
      if (cam.step > 0 && Date.now() - cam.stepAt > 12000) $('#aiSkipSides').hidden = false;
      if (!faces.length) { cam.hold = 0; return setMsg('Centrá tu cara en el óvalo'); }
      if (faces.length > 1) { cam.hold = 0; return setMsg('Tiene que aparecer solo tu cara'); }
      var P = faces[0], b = faceBox(P, video), s = turnOf(P), roll = rollOf(P, video.videoWidth, video.videoHeight);
      if (cam.frame % 6 === 0) cam.light = lightOf(video, P);
      var msg = '';
      if (b.w < (cam.step ? R.sideMinSize : R.minSize)) msg = 'Acercate un poco'; // de costado la cara se ve más angosta
      else if (b.w > R.maxSize) msg = 'Alejate un poco';
      else if (Math.abs(b.cx - 0.5) > (cam.step ? R.centerTol * 1.6 : R.centerTol) || Math.abs(b.cy - 0.45) > R.centerTol * 1.4) msg = 'Centrá tu cara en el óvalo';
      else if (cam.light === 'oscuro') msg = 'Buscá más luz, de frente';
      else if (cam.light === 'quemado') msg = 'Hay demasiada luz: buscá una más suave';
      else if (cam.step === 0) {
        if (Math.abs(s) > R.frontMaxTurn) msg = 'Mirá de frente a la cámara';
        else if (roll > PHOTO_RULES.maxRollDeg) msg = 'Enderezá la cabeza';
      } else {
        var wrongSide = cam.step === 2 && Math.sign(s) === cam.firstSign && Math.abs(s) > 0.15;
        if (wrongSide) msg = 'Ahora girá hacia el otro costado';
        else if (Math.abs(s) < R.sideMinTurn) msg = cam.step === 1 ? 'Girá la cabeza despacio hacia un costado' : 'Girá despacio hacia el otro costado';
        else if (Math.abs(s) > R.sideMaxTurn) msg = 'Girá un poco menos';
      }
      if (msg) { cam.hold = 0; return setMsg(msg); }
      cam.hold++;
      setMsg('¡Quedate quieta! Sacando foto…', true);
      if (cam.hold >= R.holdFrames) capture(P, s);
    }
    function lightOf(video, P) {
      var c = document.createElement('canvas'), W = video.videoWidth, H = video.videoHeight;
      var xs = P.map(function (p) { return p.x; }), ys = P.map(function (p) { return p.y; });
      var x = Math.min.apply(null, xs) * W, y = Math.min.apply(null, ys) * H, w = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * W, h = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * H;
      c.width = 48; c.height = 48; c.getContext('2d').drawImage(video, x, y, w, h, 0, 0, 48, 48);
      var d = c.getContext('2d').getImageData(0, 0, 48, 48).data, g = new Float32Array(48 * 48);
      for (var i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var q = imageStats({ g: g, w: 48, h: 48 });
      return q.clipHigh > PHOTO_RULES.maxClipHigh ? 'quemado' : (q.clipLow > PHOTO_RULES.maxClipLow || q.contrast < PHOTO_RULES.minContrast) ? 'oscuro' : 'ok';
    }
    function capture(P, s) {
      var video = $('#aiVideo'), c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0); // sin espejo: la imagen real
      var checks = {}, list = evaluatePhoto(c, [P], checks);
      if (cam.step > 0) list = list.filter(function (x) { return !/girada/.test(x[1]); }); // en los costados el giro es lo pedido
      var bad = list.filter(function (x) { return x[0] === 'bad'; })[0];
      if (bad) { cam.hold = 0; setMsg(bad[1]); return; }
      var fl = $('#aiFlash'); fl.classList.add('is-on'); setTimeout(function () { fl.classList.remove('is-on'); }, 60);
      if (cam.step === 1) cam.firstSign = Math.sign(s);
      shots.push({ view: STEPS[cam.step].key, canvas: c, P: P, turn: s, checks: checks });
      addThumb(c, STEPS[cam.step].label);
      cam.step++; cam.hold = 0; cam.stepAt = Date.now();
      if (cam.step === 1) $('#aiSkipSides').hidden = true;
      if (cam.step >= STEPS.length) return finishShots();
      $('#aiCamStep').textContent = 'Foto ' + (cam.step + 1) + ' de 3 · ' + STEPS[cam.step].label;
    }
    function addThumb(c, label) {
      var f = el('figure'), img = el('img');
      var t = document.createElement('canvas'), k = 160 / c.width; t.width = 160; t.height = Math.round(c.height * k);
      var x = t.getContext('2d'); x.translate(t.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0, t.width, t.height); // miniatura en espejo, como la ve la persona
      img.src = t.toDataURL('image/jpeg', 0.7); img.alt = 'Foto: ' + label;
      f.appendChild(img); f.appendChild(document.createTextNode(label)); $('#aiThumbs').appendChild(f);
    }
    function finishShots() {
      stopCamera();
      measured = measureSkin(shots);
      setMsg(shots.length > 1 ? '¡Listo! Tenemos tus fotos.' : '¡Listo! Tenemos tu foto.', true);
      diag({ controles: shots.map(function (x) { return x.checks; }), indicadores: measured.metrics, hallazgos: measured.findings, detalle: measured.debug });
      $('#aiCamDone').hidden = false; $('#aiRetake').hidden = false; $('#aiSkipSides').hidden = true;
      Track.send('analisis_foto_aceptada', { dedupeKey: 'analisis_foto_aceptada:' + PAGE_LOADED_AT });
    }
    $('#aiSkipSides').addEventListener('click', function () { if (shots.length) finishShots(); });
    $('#aiRetake').addEventListener('click', startCamera);
    $('#aiCamDone').addEventListener('click', function () { startQuiz(); });

    // Alternativa: subir una foto de frente
    $('#aiFile').addEventListener('change', function () { loadFile(this.files && this.files[0]); this.value = ''; });
    function loadFile(f) {
      stopCamera(); resetShots();
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { status($('#aiCamStatus'), 'Elegí una foto (JPG o PNG).', 'error'); return; }
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1280, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); // respeta la orientación EXIF y no copia metadatos
        URL.revokeObjectURL(url);
        if (Math.min(img.naturalWidth, img.naturalHeight) < 480) return photoRejected('La foto tiene poca resolución. Probá con la cámara del teléfono.');
        setMsg('Revisando la foto…');
        getLandmarker('IMAGE').then(function (lm) {
          var faces = (lm.detect(c) || {}).faceLandmarks || [], checks = {}, list = evaluatePhoto(c, faces, checks);
          var bad = list.filter(function (x) { return x[0] === 'bad'; }).map(function (x) { return x[1]; });
          if (bad.length) return photoRejected(bad.join(' '), checks);
          shots = [{ view: 'frente', canvas: c, P: faces[0], turn: 0, checks: checks }];
          addThumb(c, 'De frente'); finishShots();
        }).catch(function () { photoRejected('No pudimos revisar la foto en este dispositivo. Podés hacerlo sin fotos.'); });
      };
      img.onerror = function () { URL.revokeObjectURL(url); status($('#aiCamStatus'), 'No pudimos leer esa foto. Probá con una en JPG o PNG.', 'error'); };
      img.src = url;
    }
    function photoRejected(msg, checks) {
      setMsg('Esta foto no sirve'); diag(checks ? { controles: checks } : null);
      status($('#aiCamStatus'), msg + ' Sacá otra o hacelo sin fotos.', 'error');
      Track.send('analisis_foto_rechazada', { dedupeKey: 'analisis_foto_rechazada:' + Date.now() });
    }

    function evaluatePhoto(canvas, faces, m) {
      if (!faces.length) return [['bad', 'No encontramos un rostro. Ponete de frente y que se vea toda tu cara.']];
      if (faces.length > 1) return [['bad', 'Se ve más de una persona. Tiene que aparecer solo tu cara.']];
      var P = faces[0], W = canvas.width, H = canvas.height, out = [];
      var xs = P.map(function (p) { return p.x; }), ys = P.map(function (p) { return p.y; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      m.anchoRostro = +(maxX - minX).toFixed(3);
      if (minX < 0 || minY < 0 || maxX > 1 || maxY > 1) out.push(['bad', 'Tu cara quedó cortada. Alejá un poco la cámara.']);
      else if (maxX - minX < PHOTO_RULES.minFaceWidth) out.push(['bad', 'Tu cara se ve muy chica. Acercá la cámara.']);
      var nose = P[1], l = P[234], r = P[454], dl = Math.abs(nose.x - l.x), dr = Math.abs(r.x - nose.x), roll = rollOf(P, W, H);
      m.giro = +(Math.min(dl, dr) / Math.max(dl, dr)).toFixed(2); m.inclinacion = +roll.toFixed(1);
      if (Math.min(dl, dr) / Math.max(dl, dr) < PHOTO_RULES.minYawBalance) out.push(['bad', 'Tu cara está girada. Mirá de frente a la cámara.']);
      else if (roll > PHOTO_RULES.maxRollDeg) out.push(['bad', 'La cabeza está inclinada. Mantenela derecha.']);
      var bx = Math.max(0, minX * W), by = Math.max(0, minY * H), bw = Math.min(W, maxX * W) - bx, bh = Math.min(H, maxY * H) - by;
      var q = imageStats(grayCrop(canvas, bx, by, bw, bh, 256));
      m.nitidez = Math.round(q.sharpness); m.quemado = +q.clipHigh.toFixed(3); m.oscuro = +q.clipLow.toFixed(3); m.contraste = q.contrast;
      if (q.sharpness < PHOTO_RULES.minSharpness) out.push(['bad', 'La foto salió movida. Quedate quieta un segundo.']);
      if (q.clipHigh > PHOTO_RULES.maxClipHigh) out.push(['bad', 'Hay demasiada luz o reflejos en la cara. Buscá una luz más suave.']);
      else if (q.clipLow > PHOTO_RULES.maxClipLow || q.contrast < PHOTO_RULES.minContrast) out.push(['bad', 'La foto está muy oscura. Buscá más luz, de frente.']);
      var sz = (maxX - minX) * W * 0.12;
      var mL = meanLum(canvas, P[50].x * W - sz / 2, P[50].y * H - sz / 2, sz), mR = meanLum(canvas, P[280].x * W - sz / 2, P[280].y * H - sz / 2, sz);
      m.luzLados = +(Math.max(mL, mR) / Math.max(1, Math.min(mL, mR))).toFixed(2);
      return out;
    }

    /**
     * Indicadores por zona con los puntos faciales: zona T contra mejillas (de frente) y la mejilla que se ve
     * mejor en cada costado. Comparar zonas del mismo rostro reduce el efecto del tono de piel y de la luz
     * general, pero no lo elimina: por eso los umbrales se calibran con fotos reales.
     */
    function zoneStats(canvas, P, ids) {
      var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
      var xs = P.map(function (p) { return p.x; });
      var size = Math.max(8, Math.round((Math.max.apply(null, xs) - Math.min.apply(null, xs)) * W * 0.08));
      var spec = 0, red = 0, n = 0, nRed = 0, tex = 0, cv = 0, spots = 0, pores = 0;
      ids.forEach(function (i) {
        var x = Math.max(0, Math.round(P[i].x * W - size / 2)), y = Math.max(0, Math.round(P[i].y * H - size / 2));
        var d = ctx.getImageData(x, y, size, size).data;
        for (var k = 0; k < d.length; k += 4) {
          var r = d[k], g = d[k + 1], b = d[k + 2], lum = 0.299 * r + 0.587 * g + 0.114 * b;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
          n++;
          if (lum >= 230 && sat < 0.25) { spec++; continue; } // reflejo especular (brillo): no cuenta para el color
          red += (r - g) / (r + g + b + 1); nRed++;
        }
        var fine = grayCrop(canvas, x, y, size, size, 48);
        tex += lapEnergy(grayCrop(canvas, x, y, size, size, 32)); cv += detrendedCv(grayCrop(canvas, x, y, size, size, 8));
        spots += darkSpots(fine, 0.80, 12, 10); pores += darkSpots(fine, 0.90, 6, 4);
      });
      var m = ids.length;
      return { spec: spec / n, red: nRed ? red / nRed : 0, tex: tex / m, cv: cv / m, spots: spots / m, pores: pores / m };
    }
    /** Puntos más oscuros que su entorno (fondo = desenfoque local), chicos y aislados. Densidad por 1000 px. */
    function darkSpots(im, ratio, minDiff, maxArea) {
      var g = im.g, w = im.w, h = im.h, rad = 4, bg = new Float32Array(g.length), mask = new Uint8Array(g.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var s = 0, c = 0;
        for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++) {
          var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; s += g[yy * w + xx]; c++;
        }
        bg[y * w + x] = s / c;
        var v = g[y * w + x]; mask[y * w + x] = (v < bg[y * w + x] * ratio && bg[y * w + x] - v > minDiff) ? 1 : 0;
      }
      var seen = new Uint8Array(g.length), count = 0;
      for (var p = 0; p < g.length; p++) {
        if (!mask[p] || seen[p]) continue;
        var stack = [p], area = 0; seen[p] = 1;
        while (stack.length) {
          var q = stack.pop(); area++;
          var qx = q % w, qy = (q / w) | 0;
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) {
            var nx = qx + dd[0], ny = qy + dd[1], np = ny * w + nx;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
          });
        }
        if (area <= maxArea) count++;
      }
      return count / g.length * 1000;
    }
    function measureSkin(list) {
      var front = list[0], R = SKIN_RULES, f = [];
      var T = zoneStats(front.canvas, front.P, ZONE_T);
      var C = zoneStats(front.canvas, front.P, CHEEK_R.concat(CHEEK_L));
      var N = zoneStats(front.canvas, front.P, ZONE_NOSE), PO = zoneStats(front.canvas, front.P, ZONE_PORES);
      // En los costados se mide la mejilla que queda hacia la cámara (la más ancha entre nariz y borde).
      var tex = [C.tex], cv = [C.cv], pores = [PO.pores];
      list.slice(1).forEach(function (s) {
        var dl = Math.abs(s.P[1].x - s.P[234].x), dr = Math.abs(s.P[454].x - s.P[1].x);
        var side = zoneStats(s.canvas, s.P, dl > dr ? CHEEK_R : CHEEK_L);
        tex.push(side.tex); cv.push(side.cv); pores.push(side.pores);
      });
      var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
      var texA = avg(tex), cvA = avg(cv), poA = avg(pores);
      var det = detectSpots(front.canvas, front.P), n = det.counts;
      var metrics = { fotos: list.length, brilloZonaT: +T.spec.toFixed(3), brilloMejillas: +C.spec.toFixed(3), rojezDif: +(C.red - T.red).toFixed(3),
        texturaMejillas: +texA.toFixed(2), tonoMejillas: +cvA.toFixed(3), puntosNariz: +N.spots.toFixed(2), porosMejillas: +poA.toFixed(2),
        granos: n.grano, puntosNegros: n.punto_negro, milium: n.milium, lunares: n.lunar, manchas: n.mancha };
      if (T.spec >= R.shineT && C.spec >= R.shineGeneralC) f.push('brillo_general');
      else if (T.spec >= R.shineT && T.spec >= R.shineRatio * C.spec + 0.01) f.push('brillo_zona_t');
      if (texA >= R.texture) f.push('textura_irregular');
      if (cvA >= R.toneCv) f.push('tono_desparejo');
      if (C.red - T.red >= R.rednessDiff) f.push('enrojecimiento_visible');
      if (N.spots >= R.noseSpots || n.punto_negro >= SPOT_RULES.blackhead.minCount) f.push('puntos_negros_posibles');
      if (poA >= R.cheekPores) f.push('poros_visibles_posibles');
      if (n.grano) f.push('granos_posibles');
      if (n.milium) f.push('milium_posible');
      if (n.lunar) f.push('lunares_visibles');
      if (n.mancha) f.push('manchas_posibles');
      return { findings: f, metrics: metrics, spots: det.spots, debug: det.debug };
    }

    // 3. Cuestionario (4 preguntas; si no hubo foto, se suma la del brillo)
    function startQuiz() { quiz = measured ? QUIZ : [QUIZ_NO_PHOTO].concat(QUIZ); qi = 0; show('quiz'); renderQuestion(); }
    function optionList(name, opts, multi, current) {
      var wrap = el('div');
      opts.forEach(function (o) {
        var lab = el('label', 'ai-opt'), inp = document.createElement('input');
        inp.type = multi ? 'checkbox' : 'radio'; inp.name = name; inp.value = o[0];
        inp.checked = multi ? (current || []).indexOf(o[0]) >= 0 : current === o[0];
        lab.appendChild(inp); lab.appendChild(document.createTextNode(o[1])); wrap.appendChild(lab);
      });
      return wrap;
    }
    function renderQuestion() {
      var q = quiz[qi], box = $('#aiQ');
      $('#aiQStep').textContent = 'Pregunta ' + (qi + 1) + ' de ' + quiz.length;
      $('#aiQBar').style.width = Math.round(qi / quiz.length * 100) + '%';
      box.innerHTML = ''; status($('#aiQStatus'), '');
      box.appendChild(el('legend', null, q.q));
      box.appendChild(optionList('q_' + q.k, q.o, q.multi, answers[q.k]));
      box.onchange = function (e) {
        var t = e.target;
        if (q.multi) {
          var all = $$('input[name="q_' + q.k + '"]', box), excl = q.exclusive || [];
          all.forEach(function (i) { if (i !== t && t.checked && (excl.indexOf(t.value) >= 0 || excl.indexOf(i.value) >= 0)) i.checked = false; });
          if (q.max && all.filter(function (i) { return i.checked; }).length > q.max) { t.checked = false; status($('#aiQStatus'), 'Elegí hasta ' + q.max + '.', 'error'); return; }
          answers[q.k] = all.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
        } else answers[q.k] = t.value;
        status($('#aiQStatus'), '');
      };
      $('#aiQBack').textContent = 'Atrás';
      $('#aiQNext').textContent = qi === quiz.length - 1 ? 'Terminar' : 'Siguiente';
    }
    $('#aiQBack').addEventListener('click', function () { if (qi === 0) show(measured ? 'camara' : 'intro'); else { qi--; renderQuestion(); } });
    $('#aiQNext').addEventListener('click', function () {
      var a = answers[quiz[qi].k];
      if (!a || (Array.isArray(a) && !a.length)) { status($('#aiQStatus'), 'Elegí una opción para seguir.', 'error'); return; }
      if (qi < quiz.length - 1) { qi++; renderQuestion(); return; }
      $('#aiQBar').style.width = '100%';
      Track.send('analisis_cuestionario_completo', { dedupeKey: 'analisis_cuestionario:' + PAGE_LOADED_AT });
      if (session) submit(); else show('datos');
    });

    // 4. Datos de contacto, antes de ver el resultado
    bindLeadForm({ form: $('#aiLead'), btn: $('#aiLeadBtn'), statusEl: $('#aiLeadStatus'), p: 'a', e: 'ea', origin: 'analisis',
      onSaved: function () {
        submit();
        if (!store.get('sessionStorage', 'cc_booking')) prepareScheduling();
      } });

    // Envío: el servidor aplica las reglas y guarda el resultado. Las fotos nunca se envían.
    function submit() {
      if (busy) return;
      busy = true;
      var body = { requestId: session && session.requestId, token: session && session.token, adult: true, answers: answers };
      if (measured) body.photo = { findings: measured.findings, metrics: measured.metrics };
      api('analyze', body, 30000).then(function (r) {
        busy = false;
        if (r.code === 'invalid_token') {
          store.del('sessionStorage', 'cc_lead'); session = null; show('datos');
          status($('#aiLeadStatus'), 'Tu sesión venció. Volvé a confirmar tus datos.', 'error'); return;
        }
        if (!r.ok) { show(session ? 'quiz' : 'datos'); status(session ? $('#aiQStatus') : $('#aiLeadStatus'), 'No pudimos preparar tu resultado. Probá de nuevo en un momento.', 'error'); return; }
        renderResult(r);
        Track.send('analisis_resultado', { dedupeKey: 'analisis_resultado:' + PAGE_LOADED_AT });
      });
    }

    // 5. Resultado: cada conclusión muestra su origen
    var ORIGIN_LABEL = { 'cuestionario': 'Según tus respuestas', 'foto': 'Según tus fotos', 'foto y cuestionario': 'Según tus fotos y respuestas', 'evaluación presencial': 'En la consulta' };
    function origin(o) { return el('span', 'ai-origin' + (/foto/.test(o) ? ' is-photo' : o === 'evaluación presencial' ? ' is-visit' : ''), ORIGIN_LABEL[o] || o); }
    function block(title, items, cls) {
      var b = el('div', 'ai-block' + (cls ? ' ' + cls : '')); b.appendChild(el('h4', null, title));
      var ul = el('ul', 'ai-focus');
      items.forEach(function (i) {
        var li = el('li', null, i.text + ' ');
        if (i.beta) li.appendChild(el('span', 'ai-beta', 'Análisis en prueba'));
        li.appendChild(origin(i.origin)); ul.appendChild(li);
      });
      b.appendChild(ul); return b;
    }
    /** Dibujo de las zonas que realmente se midieron en la foto de frente (no es un mapa de lesiones). */
    function zonesFigure(findings) {
      var front = shots[0]; if (!front) return null;
      var src = front.canvas, P = front.P, k = 280 / src.width, c = document.createElement('canvas');
      c.width = 280; c.height = Math.round(src.height * k);
      var x = c.getContext('2d'); x.save(); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0, c.width, c.height); x.restore();
      var xs = P.map(function (p) { return p.x; }), r = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * c.width * 0.07;
      function mark(ids, hit) { // zona medida: contorno fino; relleno suave si ahí se midió brillo, textura o tono
        ids.forEach(function (i) {
          x.beginPath(); x.arc((1 - P[i].x) * c.width, P[i].y * c.height, r, 0, Math.PI * 2);
          x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.6)'; x.fillStyle = hit ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,0)';
          x.fill(); x.stroke();
        });
      }
      var has = function (k2) { return findings.indexOf(k2) >= 0; };
      mark(ZONE_T, has('brillo_zona_t') || has('brillo_general'));
      mark(CHEEK_R.concat(CHEEK_L), has('textura_irregular') || has('tono_desparejo') || has('enrojecimiento_visible') || has('brillo_general') || has('poros_visibles_posibles'));
      // Elementos puntuales: cada marca está donde se detectó (no es un mapa inventado).
      var used = {};
      (measured && measured.spots || []).forEach(function (sp) {
        var st = SPOT_STYLE[sp.type]; if (!st) return; used[sp.type] = true;
        x.beginPath(); x.arc((1 - sp.x) * c.width, sp.y * c.height, Math.max(4, sp.r * c.width), 0, Math.PI * 2);
        x.lineWidth = 2.5; x.strokeStyle = '#fff'; x.stroke(); // borde blanco para que se vea sobre cualquier tono de piel
        x.lineWidth = 1.6; x.strokeStyle = st.color; x.setLineDash(sp.type === 'mancha' ? [3, 2] : []); x.stroke(); x.setLineDash([]);
      });
      var fig = el('figure', 'ai-zones'); fig.appendChild(c);
      var cap = el('figcaption', null, 'Círculos blancos: zonas medidas (más claros si se identificó brillo, textura o tono). Marcas de color: lo detectado.');
      var leg = el('ul', 'ai-legend');
      Object.keys(SPOT_STYLE).forEach(function (t) {
        if (!used[t]) return;
        var li = el('li'), dot = el('span', 'ai-legend-dot'); dot.style.borderColor = SPOT_STYLE[t].color;
        li.appendChild(dot); li.appendChild(document.createTextNode(SPOT_STYLE[t].label)); leg.appendChild(li);
      });
      fig.appendChild(cap); if (leg.children.length) fig.appendChild(leg);
      return fig;
    }
    var SPOT_STYLE = { grano: { color: '#e5484d', label: 'Posible grano' }, punto_negro: { color: '#1f1f1f', label: 'Posible punto negro' },
      milium: { color: '#3b82f6', label: 'Posible milium' }, lunar: { color: '#8b5a2b', label: 'Lunar' }, mancha: { color: '#9b59b6', label: 'Posible mancha' } };
    function waSummary(r) {
      var obs = r.observations.map(function (o) { return o.text.replace(/\.$/, '').toLowerCase(); });
      return 'Hola, hice la evaluación de piel con IA en la web. Resultado orientativo: piel ' + r.profile.type.toLowerCase() + '.' +
        (obs.length ? ' Identificado: ' + obs.join('; ') + '.' : '') +
        (session && session.requestId ? ' Mi solicitud es ' + session.requestId + '.' : '') + ' Quisiera recibir mi resultado y consultar.';
    }
    function renderResult(r) {
      var out = $('#aiResult'); out.innerHTML = '';
      if (r.example) out.appendChild(el('p', 'ai-example', 'Resultado de ejemplo (vista previa): el perfil es fijo; las fotos sí se midieron en este dispositivo.'));
      var head = el('div', 'ai-result-head'), h = el('h3');
      if (r.profile.type !== 'Indeterminada') { h.appendChild(document.createTextNode('Tu piel parece ')); h.appendChild(el('strong', null, r.profile.type.toLowerCase())); }
      else h.textContent = 'Tipo de piel por definir en la consulta';
      head.appendChild(h); head.appendChild(origin(r.profile.origin)); out.appendChild(head);
      if (r.profile.warning) out.appendChild(el('p', 'ai-warn', r.profile.warning));
      var c = el('div', 'ai-block'); c.appendChild(el('h4', null, 'Lo que identificamos en tu piel'));
      if (r.photo === 'analizada') {
        var fig = zonesFigure(r.observations.map(function (o) { return o.rule.replace(/^OBS-/, ''); }));
        if (fig) c.appendChild(fig);
        if (r.observations.length) {
          var ul = el('ul', 'ai-focus');
          r.observations.forEach(function (o) { var li = el('li', null, o.text + ' '); if (o.beta) li.appendChild(el('span', 'ai-beta', 'Análisis en prueba')); ul.appendChild(li); });
          c.appendChild(ul);
        } else c.appendChild(el('p', 'ai-note', 'En tus fotos no se midieron diferencias claras de brillo, textura o tono.'));
        c.appendChild(el('p', 'ai-note', r.photoLimits));
      } else c.appendChild(el('p', 'ai-note', 'No sumaste fotos: la orientación sale de tus respuestas.'));
      out.appendChild(c);
      if (r.needs.length) out.appendChild(block('Lo que contaste de tu piel', r.needs));
      var d = block('Qué podría aportarte una limpieza facial', r.benefits);
      r.limits.forEach(function (l) { d.appendChild(el('p', 'ai-note', l.text)); });
      out.appendChild(d);
      if (r.toEvaluate.length) out.appendChild(block('Para ver con la profesional en la consulta', r.toEvaluate, 'ai-eval'));
      if (r.tips.length) {
        var t = el('div', 'ai-block'); t.appendChild(el('h4', null, 'Cuidados básicos'));
        var ul3 = el('ul', 'ai-tipsout'); r.tips.forEach(function (x) { ul3.appendChild(el('li', null, x.text)); }); t.appendChild(ul3); out.appendChild(t);
      }
      out.appendChild(el('p', 'ai-disclaimer', 'Este contenido es netamente orientativo y analizado por IA, no es certificado por profesionales.'));
      var acts = el('div', 'ai-actions');
      var wa = String(r.whatsapp || CFG.WHATSAPP_NUMBER || '').replace(/\D/g, '');
      if (wa) {
        var w = el('a', 'btn btn-wa', 'Recibir mi resultado por WhatsApp'); w.target = '_blank'; w.rel = 'noopener';
        w.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(waSummary(r));
        w.addEventListener('click', function () { Track.send('analisis_whatsapp', { dedupeKey: 'analisis_whatsapp:' + PAGE_LOADED_AT }); });
        acts.appendChild(w);
      }
      var cta = el('a', 'btn', 'Reservá tu sesión'); cta.href = '#reservar';
      cta.addEventListener('click', function () { Track.send('analisis_clic_reserva', { dedupeKey: 'analisis_clic_reserva:' + PAGE_LOADED_AT }); });
      var again = el('button', 'btn btn-ghost', 'Volver a empezar'); again.type = 'button';
      again.addEventListener('click', function () { answers = {}; resetShots(); show('intro'); });
      acts.appendChild(cta); acts.appendChild(again); out.appendChild(acts);
      show('resultado'); out.focus({ preventScroll: true });
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  })();

  // ── Videos: los clips cortos se reproducen sin sonido solo mientras están en pantalla ──
  (function videos() {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var saveData = navigator.connection && navigator.connection.saveData;
    var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
    var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5h3v13H8zM13 5.5h3v13h-3z"/></svg>';
    $$('.video-clip').forEach(function (fig) {
      var v = $('video', fig), btn = $('.clip-toggle', fig), label = v.getAttribute('aria-label').replace('Video: ', '');
      var userPaused = false;
      function sync() {
        var playing = !v.paused;
        btn.classList.toggle('is-playing', playing); btn.innerHTML = playing ? PAUSE : PLAY;
        btn.setAttribute('aria-label', (playing ? 'Pausar' : 'Reproducir') + ' video: ' + label);
      }
      v.addEventListener('play', sync); v.addEventListener('pause', sync);
      btn.addEventListener('click', function () {
        if (v.paused) { userPaused = false; v.play().catch(function () {}); } else { userPaused = true; v.pause(); }
      });
      v.addEventListener('click', function () { btn.click(); });
      if (reduce || saveData || !('IntersectionObserver' in window)) return; // sin reproducción automática
      new IntersectionObserver(function (e) {
        if (e[0].isIntersecting && !userPaused) v.play().catch(function () {});
        else if (!e[0].isIntersecting && !v.paused) v.pause();
      }, { threshold: 0.6 }).observe(v);
    });
    // Al reproducir el video principal se pausan los clips para no competir.
    var main = $('.video-main video');
    if (main) main.addEventListener('play', function () { $$('.js-clip').forEach(function (c) { c.pause(); }); });
  })();

  // ── CTA fijo en celular ───────────────────────────────────
  (function sticky() {
    var bar = $('#stickyCta'), heroCta = $('.hero .btn-lg'), booking = $('#reservar');
    if (!('IntersectionObserver' in window)) return;
    var heroVisible = true, bookingVisible = false, aiVisible = false;
    function update() {
      var show = !heroVisible && !bookingVisible && !aiVisible; // no tapar la cámara ni el resultado de la evaluación
      bar.classList.toggle('is-visible', show); bar.setAttribute('aria-hidden', String(!show));
      $('a', bar).tabIndex = show ? 0 : -1;
      document.documentElement.style.setProperty('--sticky-h', show && window.innerWidth < 900 ? '76px' : '0px');
    }
    new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; update(); }).observe(heroCta);
    new IntersectionObserver(function (e) { bookingVisible = e[0].isIntersecting; update(); }, { rootMargin: '0px 0px -30% 0px' }).observe(booking);
    new IntersectionObserver(function (e) { aiVisible = e[0].isIntersecting; update(); }).observe($('#analisis .ai-tool'));
  })();


  // ── Inicio ────────────────────────────────────────────────
  Track.init();
  var prevBooking = store.get('sessionStorage', 'cc_booking');
  if (session && prevBooking) showDone(prevBooking, { restore: true });
  else if (session) { goStep(2); loadRecommendations(0); }
})();
