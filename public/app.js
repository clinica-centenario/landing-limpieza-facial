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

  // ── Análisis de piel con IA ───────────────────────────────
  // La foto se reduce y se re-codifica en el dispositivo (sin EXIF ni GPS) y no se guarda en ningún almacenamiento.
  (function aiAnalysis() {
    if (!CFG.AI_ANALYSIS_ENABLED) return;
    // La sección aparece solo si el servidor tiene el análisis listo (clave de IA cargada).
    var ready = DEMO ? Promise.resolve(true) : !CFG.API_URL ? Promise.resolve(false) :
      fetch(CFG.API_URL).then(function (r) { return r.json(); }).then(function (j) { return !!j.aiReady; }).catch(function () { return false; });
    ready.then(function (ok) { if (ok) aiInit(); });
  })();

  function aiInit() {
    $('#analisis').hidden = false; $('#aiHeroLink').hidden = false;
    // Paso 1: datos de contacto (la misma solicitud sirve para reservar sin volver a cargarlos).
    var aiLead = $('#aiLead');
    function showPhotoStep() { aiLead.hidden = true; $('#aiPick').hidden = false; }
    if (session) showPhotoStep();
    bindLeadForm({ form: aiLead, btn: $('#aiLeadBtn'), statusEl: $('#aiLeadStatus'), p: 'a', e: 'ea', origin: 'analisis',
      onSaved: function () {
        showPhotoStep(); $('#aiPick').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (!store.get('sessionStorage', 'cc_booking')) prepareScheduling();
      } });
    var fileIn = $('#aiFile'), drop = $('#aiDrop'), prev = $('#aiPreview'), prevImg = $('#aiPreviewImg');
    var btn = $('#aiBtn'), st = $('#aiStatus'), pick = $('#aiPick'), out = $('#aiResult');
    var photo = null, busy = false;
    var cid = store.get('localStorage', 'cc_cid'); if (!cid) { cid = 'c_' + uid(); store.set('localStorage', 'cc_cid', cid); }
    var FOCUS = { higiene: 'Higiene y preparación', exfoliacion_manual: 'Exfoliación manual', punta_diamante: 'Exfoliación con punta de diamante',
      extraccion: 'Extracción de puntos negros', mascara_descongestiva: 'Máscara descongestiva', activos: 'Activos elegidos para tu piel',
      led: 'Lámpara LED', hidratacion: 'Hidratación y protección', rutina_casa: 'Orientación para tu rutina en casa' };

    function loadFile(f) {
      status(st, '');
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { status(st, 'Elegí una foto (JPG o PNG).', 'error'); return; }
      if (f.size > 25 * 1024 * 1024) { status(st, 'La foto es muy pesada. Probá con otra.', 'error'); return; }
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1024, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        if (Math.min(w, h) < 300) { URL.revokeObjectURL(url); status(st, 'La foto tiene muy poca resolución. Probá con otra.', 'error'); return; }
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); // respeta la orientación EXIF y no copia metadatos
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        photo = dataUrl.split(',')[1];
        prevImg.src = dataUrl; prev.hidden = false; drop.hidden = true;
      };
      img.onerror = function () { URL.revokeObjectURL(url); status(st, 'No pudimos leer esa foto. Probá con una en JPG o PNG.', 'error'); };
      img.src = url;
    }
    fileIn.addEventListener('change', function () { loadFile(this.files && this.files[0]); this.value = ''; });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { loadFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
    $('#aiChange').addEventListener('click', function () { fileIn.click(); });

    function reset() {
      photo = null; prevImg.removeAttribute('src'); prev.hidden = true; drop.hidden = false;
      out.hidden = true; out.innerHTML = ''; pick.hidden = false; status(st, '');
    }

    btn.addEventListener('click', function () {
      if (busy) return;
      if (!photo) { status(st, 'Primero sacá o subí una foto.', 'error'); return; }
      if (!$('#aiAdult').checked || !$('#aiConsent').checked) { status(st, 'Marcá las dos casillas para continuar.', 'error'); return; }
      busy = true; setBusy(btn, true, 'Analizando tu foto…'); status(st, 'Puede demorar unos segundos.');
      var tsInput = $('input[name="cf-turnstile-response"]');
      api('analyze', { image: photo, mediaType: 'image/jpeg', consent: true, adult: true, clientId: cid, requestId: session && session.requestId, token: session && session.token, turnstileToken: tsInput ? tsInput.value : '' }, 60000)
        .then(function (r) {
          busy = false; setBusy(btn, false);
          if (r.ok && r.status === 'ok') { photo = null; Track.send('analisis_piel', { dedupeKey: 'analisis_piel:' + PAGE_LOADED_AT }); return render(r); }
          if (r.ok && r.status === 'retry') { status(st, (r.retry_reason || 'Probá con otra foto.') + ' Elegí otra foto y volvé a intentar.', 'error'); return; }
          if (r.ok && r.status === 'not_allowed') { reset(); status(st, 'Este análisis es solo para mayores de 18 años, con una foto de tu propia cara.', 'error'); return; }
          if (r.code === 'invalid_token') {
            store.del('sessionStorage', 'cc_lead'); session = null; aiLead.hidden = false; pick.hidden = true;
            status($('#aiLeadStatus'), 'Tu sesión venció. Volvé a confirmar tus datos para analizar la foto.', 'error'); return;
          }
          var msgs = {
            rate_limited: 'Llegaste al máximo de análisis por ahora. Probá más tarde o reservá tu evaluación con la profesional.',
            ai_not_configured: 'El análisis todavía no está disponible. Podés reservar tu sesión igual.',
            invalid_image: 'No pudimos procesar esa foto. Probá con otra.',
            consent_required: 'Marcá las dos casillas para continuar.'
          };
          status(st, msgs[r.code] || 'No pudimos analizar la foto. Probá de nuevo en un momento.', 'error');
        });
    });

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function render(r) {
      out.innerHTML = '';
      if (r.example) out.appendChild(el('p', 'ai-example', 'Resultado de ejemplo (vista previa): tu foto no fue analizada.'));
      var head = el('div', 'ai-result-head'), h = el('h3');
      if (r.skin_type && r.skin_type !== 'indeterminado') { h.appendChild(document.createTextNode('Tu piel parece ')); h.appendChild(el('strong', null, r.skin_type)); }
      else h.textContent = 'No pudimos estimar tu tipo de piel con esta foto';
      head.appendChild(h); head.appendChild(el('span', 'chip', 'Confianza ' + (r.skin_type_confidence || 'baja') + ' · lo confirma la profesional'));
      out.appendChild(head);
      if (r.summary) out.appendChild(el('p', null, r.summary));
      if (r.observations && r.observations.length) {
        var b = el('div', 'ai-block'); b.appendChild(el('h4', null, 'Lo que se observa en la foto')); var ul = el('ul', 'ai-obs');
        r.observations.forEach(function (o) { var li = el('li'); if (o.area) { li.appendChild(el('strong', null, o.area + ': ')); } li.appendChild(document.createTextNode(o.text)); ul.appendChild(li); });
        b.appendChild(ul); out.appendChild(b);
      }
      if (r.session_focus && r.session_focus.length) {
        var b2 = el('div', 'ai-block'); b2.appendChild(el('h4', null, 'En tu limpieza facial se podría trabajar')); var ul2 = el('ul', 'ai-focus');
        r.session_focus.forEach(function (k) { if (FOCUS[k]) ul2.appendChild(el('li', null, FOCUS[k])); });
        b2.appendChild(ul2); b2.appendChild(el('p', 'fine', 'La Lic. Jaqueline Mansilla define las técnicas en la evaluación inicial.')); out.appendChild(b2);
      }
      if (r.home_tips && r.home_tips.length) {
        var b3 = el('div', 'ai-block'); b3.appendChild(el('h4', null, 'Para tu día a día')); var ul3 = el('ul', 'ai-tipsout');
        r.home_tips.forEach(function (t) { ul3.appendChild(el('li', null, t)); }); b3.appendChild(ul3); out.appendChild(b3);
      }
      if (r.see_doctor) out.appendChild(el('p', 'ai-doctor', r.see_doctor_reason || 'Conviene que consultes a un médico antes de un tratamiento estético.'));
      var acts = el('div', 'ai-actions');
      var cta = el('a', 'btn', 'Reservá tu limpieza facial'); cta.href = '#reservar';
      var again = el('button', 'btn btn-ghost', 'Analizar otra foto'); again.type = 'button'; again.addEventListener('click', reset);
      acts.appendChild(cta); acts.appendChild(again); out.appendChild(acts);
      pick.hidden = true; out.hidden = false; out.focus({ preventScroll: true });
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

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
