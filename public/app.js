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

  // ── Orientación de la piel (cuestionario + foto opcional) ─
  // Recorrido: introducción → datos → cuestionario → foto (opcional) → resultado.
  // El tipo de piel sale de las respuestas. La foto se analiza SOLO en el teléfono: MediaPipe Face Landmarker
  // (el mismo modelo Apache-2.0 que incluye UniFace) ubica el rostro y sus zonas, y se miden brillo, textura,
  // tono y enrojecimiento relativo con reglas simples. La foto nunca se envía ni se guarda: al servidor llegan
  // solo las categorías encontradas y los números medidos (para calibrar).
  // Analítica: solo hitos del recorrido, nunca respuestas, perfiles ni hallazgos.
  var QUIZ = [
    { k: 'brillo', q: 'A media tarde, ¿cómo está tu piel?', o: [['toda', 'Con brillo en toda la cara'], ['zona_t', 'Con brillo solo en frente, nariz y mentón'], ['no', 'Sin brillo notable'], ['nose', 'No sé']] },
    { k: 'tirantez', q: 'Después de lavarte la cara, ¿sentís tirantez?', o: [['siempre', 'Sí, casi siempre'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
    { k: 'descamacion', q: '¿Notás zonas que se descaman o se sienten ásperas y secas?', o: [['si', 'Sí'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
    { k: 'reactividad', q: '¿Tu piel arde, pica o se enrojece con algunos productos?', o: [['seguido', 'Sí, seguido'], ['aveces', 'A veces'], ['no', 'No'], ['nose', 'No sé']] },
    { k: 'imperfecciones', multi: true, q: '¿Qué notás en tu piel? Podés marcar varias.', o: [['puntos_negros', 'Puntos negros'], ['granitos', 'Granitos de vez en cuando'], ['poros', 'Poros marcados'], ['textura', 'Textura irregular'], ['nada', 'Nada en especial'], ['nose', 'No sé']] },
    { k: 'objetivo', q: '¿Qué te gustaría lograr principalmente?', o: [['suavidad', 'Piel más suave'], ['luminosidad', 'Más luminosidad'], ['confort', 'Más confort'], ['limpieza', 'Sensación de limpieza'], ['otro', 'Otro']] },
    { k: 'exfoliantes', q: '¿Usás exfoliantes o productos con retinoides (retinol, ácido retinoico)?', o: [['si', 'Sí'], ['no', 'No'], ['nose', 'No sé']],
      follow: { k: 'exfoliantes_cual', when: 'si', q: '¿Cuáles?', o: [['exfoliante', 'Exfoliantes'], ['retinoide', 'Retinoides'], ['ambos', 'Los dos'], ['nose', 'No sé']] } },
    { k: 'procedimiento', q: 'En el último mes, ¿te hiciste algún procedimiento o tratamiento en el rostro (peeling, láser u otro)?', o: [['si', 'Sí'], ['no', 'No'], ['nose', 'No sé']],
      follow: { k: 'procedimiento_tipo', when: 'si', q: '¿De qué tipo?', o: [['estetico', 'Estético'], ['medico', 'Indicado por un profesional de la salud'], ['otro', 'Otro']] } },
    { k: 'lesiones', q: '¿Tenés ahora irritación fuerte, heridas, lesiones que duelen, o algo en la piel que cambia o sangra?', o: [['si', 'Sí'], ['no', 'No']] }
  ];

  // Controles técnicos de la foto. Valores iniciales: calibrarlos con fotos reales de distintos tonos de piel,
  // teléfonos y luces. La exposición se mide por recortes extremos y contraste, no por brillo promedio,
  // para no penalizar pieles oscuras. Maquillaje, filtros y modo belleza NO se detectan: se pide a la persona.
  var PHOTO_RULES = { minFaceWidth: 0.28, minYawBalance: 0.55, maxRollDeg: 12, minSharpness: 45,
    maxClipHigh: 0.12, maxClipLow: 0.30, minContrast: 30, maxCheekRatio: 1.7 };
  // Indicadores de piel medidos en la foto. Umbrales PROVISORIOS: se calibran con las pruebas en teléfonos
  // (modo ?diagnostico=1 muestra los números). Son mediciones de imagen, no un modelo validado de piel.
  var SKIN_RULES = { shineT: 0.05, shineGeneralC: 0.04, shineRatio: 2, rednessDiff: 0.035, texture: 7, toneCv: 0.07 };
  var DIAG = params.get('diagnostico') === '1';
  var MP_VER = '0.10.14';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  (function skinOrientation() {
    if (!CFG.AI_ANALYSIS_ENABLED) return;
    $('#analisis').hidden = false; $('#aiHeroLink').hidden = false;
    var card = $('#analisis .ai-tool');
    var answers = {}, qi = 0, measured = null, busy = false, landmarker = null;

    function show(name) {
      $$('[data-ai]', card).forEach(function (el) { el.hidden = el.getAttribute('data-ai') !== name; });
      var target = $('[data-ai="' + name + '"]', card);
      if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return target;
    }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    // 1. Introducción
    $('#aiStart').addEventListener('click', function () {
      if (!$('#aiAdult').checked) { status($('#aiIntroStatus'), 'Esta orientación es solo para mayores de 18 años.', 'error'); return; }
      status($('#aiIntroStatus'), '');
      Track.send('analisis_inicio', { dedupeKey: 'analisis_inicio:' + PAGE_LOADED_AT });
      if (session) startQuiz(); else show('datos');
    });

    // 2. Datos de contacto
    bindLeadForm({ form: $('#aiLead'), btn: $('#aiLeadBtn'), statusEl: $('#aiLeadStatus'), p: 'a', e: 'ea', origin: 'analisis',
      onSaved: function () {
        startQuiz();
        if (!store.get('sessionStorage', 'cc_booking')) prepareScheduling();
      } });

    // 3. Cuestionario
    function startQuiz() { qi = 0; show('quiz'); renderQuestion(); }
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
      var q = QUIZ[qi], box = $('#aiQ');
      $('#aiQStep').textContent = 'Pregunta ' + (qi + 1) + ' de ' + QUIZ.length;
      $('#aiQBar').style.width = Math.round(qi / QUIZ.length * 100) + '%';
      box.innerHTML = ''; status($('#aiQStatus'), '');
      box.appendChild(el('legend', null, q.q));
      box.appendChild(optionList('q_' + q.k, q.o, q.multi, answers[q.k]));
      if (q.follow) {
        var f = el('div', 'ai-follow'); f.hidden = answers[q.k] !== q.follow.when;
        f.appendChild(el('p', null, q.follow.q));
        f.appendChild(optionList('q_' + q.follow.k, q.follow.o, false, answers[q.follow.k]));
        box.appendChild(f);
      }
      box.onchange = function (e) {
        var t = e.target;
        if (t.name === 'q_' + q.k) {
          if (q.multi) {
            // "Nada en especial" y "No sé" excluyen el resto de las opciones.
            var excl = ['nada', 'nose'];
            $$('input[name="q_' + q.k + '"]', box).forEach(function (i) {
              if (i === t || !t.checked) return;
              if (excl.indexOf(t.value) >= 0 || excl.indexOf(i.value) >= 0) i.checked = false;
            });
            answers[q.k] = $$('input[name="q_' + q.k + '"]:checked', box).map(function (i) { return i.value; });
          } else answers[q.k] = t.value;
          if (q.follow) { var fb = $('.ai-follow', box); fb.hidden = answers[q.k] !== q.follow.when; if (fb.hidden) delete answers[q.follow.k]; }
        } else if (q.follow && t.name === 'q_' + q.follow.k) answers[q.follow.k] = t.value;
        status($('#aiQStatus'), '');
      };
      $('#aiQBack').textContent = qi === 0 ? 'Salir' : 'Atrás';
      $('#aiQNext').textContent = qi === QUIZ.length - 1 ? 'Terminar' : 'Siguiente';
      var first = $('input', box); if (first && document.activeElement && card.contains(document.activeElement)) first.focus({ preventScroll: true });
    }
    $('#aiQBack').addEventListener('click', function () { if (qi === 0) show('intro'); else { qi--; renderQuestion(); } });
    $('#aiQNext').addEventListener('click', function () {
      var q = QUIZ[qi], a = answers[q.k];
      if (!a || (q.multi && !a.length)) { status($('#aiQStatus'), 'Elegí una opción para seguir.', 'error'); return; }
      if (q.follow && a === q.follow.when && !answers[q.follow.k]) { status($('#aiQStatus'), 'Contanos cuáles para seguir.', 'error'); return; }
      if (qi < QUIZ.length - 1) { qi++; renderQuestion(); return; }
      $('#aiQBar').style.width = '100%';
      Track.send('analisis_cuestionario_completo', { dedupeKey: 'analisis_cuestionario:' + PAGE_LOADED_AT });
      openPhoto();
    });

    // 4. Foto opcional, con controles técnicos en el dispositivo
    function openPhoto() {
      show('foto');
      if (!landmarker) loadLandmarker().catch(function () {}); // se precarga mientras la persona lee las indicaciones
    }
    function loadLandmarker() {
      if (landmarker) return landmarker;
      landmarker = import(MP_BASE + '/vision_bundle.mjs').then(function (v) {
        return v.FilesetResolver.forVisionTasks(MP_BASE + '/wasm').then(function (fs) {
          return v.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: 'IMAGE', numFaces: 2 });
        });
      });
      landmarker.catch(function () { landmarker = null; });
      return landmarker;
    }
    ['#aiCam', '#aiFile'].forEach(function (id) {
      $(id).addEventListener('change', function () { loadFile(this.files && this.files[0]); this.value = ''; });
    });
    function resetPhotoUi() {
      measured = null; $('#aiPreview').hidden = true; $('#aiChecks').innerHTML = '';
      $('#aiSend').hidden = true; $('#aiDiag').hidden = true; status($('#aiStatus'), '');
    }
    function loadFile(f) {
      resetPhotoUi();
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { status($('#aiStatus'), 'Elegí una foto (JPG o PNG).', 'error'); return; }
      if (f.size > 25 * 1024 * 1024) { status($('#aiStatus'), 'La foto es muy pesada. Probá con otra.', 'error'); return; }
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1024, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); // respeta la orientación EXIF y no copia metadatos
        URL.revokeObjectURL(url);
        $('#aiPreviewImg').src = c.toDataURL('image/jpeg', 0.85); $('#aiPreview').hidden = false;
        if (Math.min(w, h) < 480) return rejectPhoto([['bad', 'La foto tiene poca resolución. Probá con la cámara del teléfono.']], null);
        checkPhoto(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); status($('#aiStatus'), 'No pudimos leer esa foto. Probá con una en JPG o PNG.', 'error'); };
      img.src = url;
    }
    function renderChecks(list) {
      var ul = $('#aiChecks'); ul.innerHTML = '';
      list.forEach(function (c) { ul.appendChild(el('li', 'is-' + c[0], c[1])); });
    }
    function rejectPhoto(list, diag) {
      renderChecks(list); showDiag(diag);
      status($('#aiStatus'), 'Esta foto no sirve para la orientación. Sacá otra siguiendo las indicaciones, o seguí sin foto.', 'error');
      Track.send('analisis_foto_rechazada', { dedupeKey: 'analisis_foto_rechazada:' + Date.now() });
    }
    function checkPhoto(canvas) {
      renderChecks([['info', 'Revisando la foto…']]);
      Promise.resolve(loadLandmarker()).then(function (lm) {
        var res = lm.detect(canvas), faces = res && res.faceLandmarks || [];
        var diag = { controles: {} };
        var list = evaluatePhoto(canvas, faces, diag.controles);
        if (list.some(function (c) { return c[0] === 'bad'; })) return rejectPhoto(list, diag);
        measured = measureSkin(canvas, faces[0]);
        diag.indicadores = measured.metrics; diag.hallazgos = measured.findings;
        renderChecks(list); showDiag(diag);
        $('#aiSend').hidden = false; status($('#aiStatus'), '');
        Track.send('analisis_foto_aceptada', { dedupeKey: 'analisis_foto_aceptada:' + PAGE_LOADED_AT });
      }).catch(function () {
        renderChecks([['warn', 'No pudimos revisar la foto en este dispositivo.']]);
        status($('#aiStatus'), 'Sin poder revisar la foto no la usamos. Podés seguir sin foto.', 'error');
      });
    }
    function showDiag(d) {
      var box = $('#aiDiag'); if (!DIAG || !d) { box.hidden = true; return; }
      box.textContent = JSON.stringify(d, null, 1); box.hidden = false;
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
      else out.push(['ok', 'Un solo rostro, bien encuadrado.']);
      // Orientación: nariz centrada entre los bordes del rostro (giro) y ojos nivelados (inclinación).
      var nose = P[1], l = P[234], r = P[454], eL = P[33], eR = P[263];
      var dl = Math.abs(nose.x - l.x), dr = Math.abs(r.x - nose.x), roll = Math.abs(Math.atan2((eR.y - eL.y) * H, (eR.x - eL.x) * W) * 180 / Math.PI);
      m.giro = +(Math.min(dl, dr) / Math.max(dl, dr)).toFixed(2); m.inclinacion = +roll.toFixed(1);
      if (Math.min(dl, dr) / Math.max(dl, dr) < PHOTO_RULES.minYawBalance) out.push(['bad', 'Tu cara está girada. Mirá de frente a la cámara.']);
      else if (roll > PHOTO_RULES.maxRollDeg) out.push(['bad', 'La cabeza está inclinada. Mantenela derecha.']);
      else out.push(['ok', 'Mirada de frente.']);
      // Nitidez y exposición sobre el recorte del rostro.
      var bx = Math.max(0, minX * W), by = Math.max(0, minY * H), bw = Math.min(W, maxX * W) - bx, bh = Math.min(H, maxY * H) - by;
      var g = grayCrop(canvas, bx, by, bw, bh, 256);
      var q = imageStats(g);
      m.nitidez = Math.round(q.sharpness); m.quemado = +q.clipHigh.toFixed(3); m.oscuro = +q.clipLow.toFixed(3); m.contraste = q.contrast;
      if (q.sharpness < PHOTO_RULES.minSharpness) out.push(['bad', 'La foto está movida o desenfocada. Sostené el teléfono quieto.']);
      else out.push(['ok', 'Foto nítida.']);
      if (q.clipHigh > PHOTO_RULES.maxClipHigh) out.push(['bad', 'Hay demasiada luz o reflejos en la cara. Buscá una luz más suave.']);
      else if (q.clipLow > PHOTO_RULES.maxClipLow || q.contrast < PHOTO_RULES.minContrast) out.push(['bad', 'La foto está muy oscura. Buscá más luz, de frente.']);
      else out.push(['ok', 'Luz suficiente.']);
      // Luz despareja entre mejillas: aviso, no bloquea.
      var s = (maxX - minX) * W * 0.12;
      var mL = meanLum(canvas, P[50].x * W - s / 2, P[50].y * H - s / 2, s), mR = meanLum(canvas, P[280].x * W - s / 2, P[280].y * H - s / 2, s);
      m.luzLados = +(Math.max(mL, mR) / Math.max(1, Math.min(mL, mR))).toFixed(2);
      if (Math.max(mL, mR) / Math.max(1, Math.min(mL, mR)) > PHOTO_RULES.maxCheekRatio) out.push(['warn', 'La luz llega más de un lado. Si podés, ponete de frente a la ventana.']);
      out.push(['info', 'No podemos detectar maquillaje ni filtros: si usaste alguno, mejor sacá otra.']);
      return out;
    }

    /**
     * Indicadores por zona con los puntos faciales (índices de la malla de MediaPipe):
     * frente y nariz (zona T) contra mejillas. Comparar zonas del mismo rostro reduce el efecto del tono
     * de piel y de la luz general, pero no lo elimina: por eso los umbrales se calibran con fotos reales.
     */
    var ZONE_T = [151, 108, 337, 4, 195, 5], ZONE_CHEEKS = [50, 117, 205, 280, 346, 425];
    function measureSkin(canvas, P) {
      var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
      var xs = P.map(function (p) { return p.x; });
      var size = Math.max(8, Math.round((Math.max.apply(null, xs) - Math.min.apply(null, xs)) * W * 0.08));
      function patch(i) {
        var x = Math.round(P[i].x * W - size / 2), y = Math.round(P[i].y * H - size / 2);
        return { x: Math.max(0, x), y: Math.max(0, y) };
      }
      function zone(ids) {
        var spec = 0, red = 0, n = 0, nRed = 0, tex = 0, cv = 0;
        ids.forEach(function (i) {
          var pt = patch(i), d = ctx.getImageData(pt.x, pt.y, size, size).data;
          for (var k = 0; k < d.length; k += 4) {
            var r = d[k], g = d[k + 1], b = d[k + 2], y = 0.299 * r + 0.587 * g + 0.114 * b;
            var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
            n++;
            if (y >= 230 && sat < 0.25) { spec++; continue; } // reflejo especular (brillo): no cuenta para el color
            red += (r - g) / (r + g + b + 1); nRed++;
          }
          var fine = grayCrop(canvas, pt.x, pt.y, size, size, 32), coarse = grayCrop(canvas, pt.x, pt.y, size, size, 8);
          tex += lapEnergy(fine); cv += detrendedCv(coarse);
        });
        return { spec: spec / n, red: nRed ? red / nRed : 0, tex: tex / ids.length, cv: cv / ids.length };
      }
      var T = zone(ZONE_T), C = zone(ZONE_CHEEKS), R = SKIN_RULES, f = [];
      var metrics = { brilloZonaT: +T.spec.toFixed(3), brilloMejillas: +C.spec.toFixed(3), rojezDif: +(C.red - T.red).toFixed(3),
        texturaMejillas: +C.tex.toFixed(2), tonoMejillas: +C.cv.toFixed(3) };
      if (T.spec >= R.shineT && C.spec >= R.shineGeneralC) f.push('brillo_general');
      else if (T.spec >= R.shineT && T.spec >= R.shineRatio * C.spec + 0.01) f.push('brillo_zona_t');
      if (C.tex >= R.texture) f.push('textura_irregular');
      if (C.cv >= R.toneCv) f.push('tono_desparejo');
      if (C.red - T.red >= R.rednessDiff) f.push('enrojecimiento_visible');
      return { findings: f, metrics: metrics };
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
    // Variación del tono descontando la luz que cambia de a poco (plano a + b·x + c·y ajustado por mínimos
    // cuadrados): así la sombra natural de la mejilla no cuenta como "tono desparejo".
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
    $('#aiSend').addEventListener('click', function () { if (measured) submit(true); });
    $('#aiSkip').addEventListener('click', function () { submit(false); });

    // Envío: el servidor aplica las reglas (y la IA, si hay foto) y guarda solo el resultado.
    function submit(withPhoto) {
      if (busy) return;
      var btn = withPhoto ? $('#aiSend') : $('#aiSkip');
      busy = true; setBusy(btn, true, 'Preparando tu orientación…');
      // Al servidor van las respuestas y, si hubo foto, solo lo medido en el teléfono (nunca la imagen).
      var body = { requestId: session && session.requestId, token: session && session.token, adult: true, answers: answers };
      if (withPhoto) body.photo = { findings: measured.findings, metrics: measured.metrics };
      api('analyze', body, 30000).then(function (r) {
        busy = false; setBusy(btn, false);
        if (r.code === 'invalid_token') {
          store.del('sessionStorage', 'cc_lead'); session = null; show('datos');
          status($('#aiLeadStatus'), 'Tu sesión venció. Volvé a confirmar tus datos.', 'error'); return;
        }
        if (!r.ok) { status(withPhoto ? $('#aiStatus') : $('#aiQStatus'), 'No pudimos preparar tu orientación. Probá de nuevo en un momento.', 'error'); return; }
        renderResult(r);
        Track.send('analisis_resultado', { dedupeKey: 'analisis_resultado:' + PAGE_LOADED_AT });
      });
    }

    // 5. Resultado: cada conclusión muestra su origen
    var ORIGIN_LABEL = { 'cuestionario': 'Según tus respuestas', 'foto': 'Según tu foto', 'evaluación presencial': 'En la consulta' };
    function origin(o) { var s = el('span', 'ai-origin' + (o === 'foto' ? ' is-photo' : o === 'evaluación presencial' ? ' is-visit' : ''), ORIGIN_LABEL[o] || o); return s; }
    function block(title, items, cls) {
      var b = el('div', 'ai-block' + (cls ? ' ' + cls : '')); b.appendChild(el('h4', null, title));
      var ul = el('ul', 'ai-focus');
      items.forEach(function (i) { var li = el('li', null, i.text + ' '); li.appendChild(origin(i.origin)); ul.appendChild(li); });
      b.appendChild(ul); return b;
    }
    function renderResult(r) {
      var out = $('#aiResult'); out.innerHTML = '';
      if (r.example) out.appendChild(el('p', 'ai-example', 'Resultado de ejemplo (vista previa): no se analizó nada.'));
      // A. Perfil referido
      var head = el('div', 'ai-result-head'), h = el('h3');
      if (r.profile.type !== 'Indeterminada') { h.appendChild(document.createTextNode('Tu piel parece ')); h.appendChild(el('strong', null, r.profile.type.toLowerCase())); }
      else h.textContent = 'Tipo de piel por definir en la consulta';
      head.appendChild(h); head.appendChild(origin(r.profile.origin)); out.appendChild(head);
      if (r.profile.warning) out.appendChild(el('p', 'ai-warn', r.profile.warning));
      // B. Necesidades referidas
      if (r.needs.length) out.appendChild(block('Lo que contaste de tu piel', r.needs));
      // C. Observaciones de la foto
      var c = el('div', 'ai-block'); c.appendChild(el('h4', null, 'Lo que se ve en tu foto'));
      if (r.photo === 'analizada' && r.observations.length) {
        var ul = el('ul', 'ai-obs'); r.observations.forEach(function (o) { var li = el('li', null, o.text + ' '); li.appendChild(origin(o.origin)); ul.appendChild(li); });
        c.appendChild(ul);
        if (r.photoLimits) c.appendChild(el('p', 'ai-note', r.photoLimits));
      } else {
        c.appendChild(el('p', 'ai-note', r.photo === 'analizada' ? 'En la foto no se midieron diferencias claras de brillo, textura o tono.' :
          'No sumaste foto: la orientación sale de tus respuestas.'));
      }
      out.appendChild(c);
      // D. Qué podría aportar una limpieza facial
      var d = block('Qué podría aportarte una limpieza facial', r.benefits);
      r.limits.forEach(function (l) { d.appendChild(el('p', 'ai-note', l.text)); });
      out.appendChild(d);
      if (r.toEvaluate.length) out.appendChild(block('Para ver con la profesional en la consulta', r.toEvaluate, 'ai-eval'));
      if (r.tips.length) {
        var t = el('div', 'ai-block'); t.appendChild(el('h4', null, 'Cuidados básicos'));
        var ul3 = el('ul', 'ai-tipsout'); r.tips.forEach(function (x) { ul3.appendChild(el('li', null, x.text)); }); t.appendChild(ul3); out.appendChild(t);
      }
      out.appendChild(el('p', 'ai-disclaimer', 'Este contenido es netamente orientativo y analizado por IA, no es certificado por profesionales.'));
      // F. Próximo paso
      var acts = el('div', 'ai-actions');
      var cta = el('a', 'btn', 'Reservá tu sesión'); cta.href = '#reservar';
      cta.addEventListener('click', function () { Track.send('analisis_clic_reserva', { dedupeKey: 'analisis_clic_reserva:' + PAGE_LOADED_AT }); });
      var again = el('button', 'btn btn-ghost', 'Volver a empezar'); again.type = 'button';
      again.addEventListener('click', function () { answers = {}; resetPhotoUi(); startQuiz(); });
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
    var heroVisible = true, bookingVisible = false;
    function update() {
      var show = !heroVisible && !bookingVisible;
      bar.classList.toggle('is-visible', show); bar.setAttribute('aria-hidden', String(!show));
      $('a', bar).tabIndex = show ? 0 : -1;
      document.documentElement.style.setProperty('--sticky-h', show && window.innerWidth < 900 ? '76px' : '0px');
    }
    new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; update(); }).observe(heroCta);
    new IntersectionObserver(function (e) { bookingVisible = e[0].isIntersecting; update(); }, { rootMargin: '0px 0px -30% 0px' }).observe(booking);
  })();


  // ── Inicio ────────────────────────────────────────────────
  Track.init();
  var prevBooking = store.get('sessionStorage', 'cc_booking');
  if (session && prevBooking) showDone(prevBooking, { restore: true });
  else if (session) { goStep(2); loadRecommendations(0); }
})();
