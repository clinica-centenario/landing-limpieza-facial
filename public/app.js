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
          if (res.whatsapp) state.whatsapp = res.whatsapp;
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
        if (state.whatsapp) document.dispatchEvent(new Event('cc:whatsapp'));
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

  // ── Evaluación cosmética con IA ───────────────────────────
  // Recorrido: introducción → foto de frente (cámara guiada o archivo) → revisión de la foto → preguntas → datos → informe.
  // MediaPipe Face Landmarker (red neuronal, Apache-2.0) SOLO ubica el rostro y sus 478 puntos: no reconoce alteraciones
  // de la piel. Las observaciones son mediciones de imagen hechas en el teléfono (reflejos, contraste local, color relativo
  // entre zonas) con umbrales provisorios; las reglas y los textos están en evaluation.js.
  // La foto no se envía ni se guarda. Las respuestas tampoco, salvo que la persona elija enviar el resumen a la
  // profesional (consentimiento aparte). Analítica: solo hitos del recorrido, nunca respuestas, fotos ni resultados.
  var EV = window.CCEval;
  // Controles técnicos de la foto. Valores iniciales: calibrarlos con fotos reales de distintos tonos de piel,
  // teléfonos y luces. La exposición se mide por recortes extremos y contraste, no por brillo promedio,
  // para no penalizar pieles oscuras. Maquillaje, filtros y modo belleza NO se detectan: se pregunta.
  // Los controles de zona (tapada, luz de costado) solo vuelven "no evaluable" una categoría: nunca agregan hallazgos.
  var PHOTO_RULES = { minFaceWidth: 0.28, minYawBalance: 0.55, maxRollDeg: 12, minSharpness: 45,
    maxClipHigh: 0.12, maxClipLow: 0.30, minContrast: 30, maxSideLight: 1.4, occludedFrac: 0.35, occludedDeltaE: 22 };
  // Guía de cámara: posición dentro del óvalo y giro (s = -1..1; 0 = de frente).
  var CAM_RULES = { frontMaxTurn: 0.18, centerTol: 0.10, minSize: 0.42, maxSize: 0.80, holdFrames: 10 };
  var FACE_WIDTH_MM = 135; // ancho medio de pómulo a pómulo en adultos: solo para estimar el detalle (px por mm)
  var DIAG = params.get('diagnostico') === '1';
  var MP_VER = '0.10.14';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  // Puntos de la malla de MediaPipe donde se mide (cuadraditos alrededor de cada punto).
  var ZONE_T = [151, 108, 337, 4, 195, 5], CHEEK_R = [50, 117, 205], CHEEK_L = [280, 346, 425], ZONE_NOSE = [48, 278, 4, 45, 275];
  // Zonas para mostrar y para controlar si se ven: envolvente convexa de estos puntos (der/izq de la persona).
  var REGION_IDS = {
    frente: [67, 109, 10, 338, 297, 299, 337, 151, 108, 69, 104, 333],
    nariz: [168, 6, 197, 195, 5, 4, 1, 45, 275, 48, 278, 129, 358, 219, 439, 122, 351, 193, 417],
    mejilla_der: [50, 101, 36, 205, 187, 123, 117, 118, 119, 100, 142, 203, 206, 216, 147],
    mejilla_izq: [280, 330, 266, 425, 411, 352, 346, 347, 348, 329, 371, 423, 426, 436, 376]
  };

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

  /** Envolvente convexa (cadena monótona) de puntos [x, y]. */
  function convexHull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lo = [], hi = [];
    pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    pts.slice().reverse().forEach(function (p) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); });
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  /** Polígonos de cada zona en píxeles de la imagen original (sin espejo). */
  function regionPolygons(W, H, P) {
    var out = {};
    Object.keys(REGION_IDS).forEach(function (z) {
      out[z] = convexHull(REGION_IDS[z].map(function (i) { return [Math.round(P[i].x * W * 10) / 10, Math.round(P[i].y * H * 10) / 10]; }))
        .map(function (p) { return [Math.max(0, Math.min(W, p[0])), Math.max(0, Math.min(H, p[1]))]; });
    });
    return out;
  }
  /**
   * ¿Se ve cada zona? Fracción de píxeles muy distintos del color mediano de la piel (pelo, flequillo, mano,
   * marco de anteojos, sombra fuerte). Los reflejos no cuentan. Una zona tapada pasa a "no evaluable".
   */
  function occlusionOf(canvas, regions) {
    var W = canvas.width, H = canvas.height, all = [];
    Object.keys(regions).forEach(function (z) { all = all.concat(regions[z]); });
    var x0 = Math.min.apply(null, all.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, all.map(function (p) { return p[0]; }));
    var y0 = Math.min.apply(null, all.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, all.map(function (p) { return p[1]; }));
    var k = 160 / Math.max(1, x1 - x0), w = 160, h = Math.max(1, Math.round((y1 - y0) * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data;
    var masks = {}, lab = new Array(w * h);
    Object.keys(regions).forEach(function (z) {
      var m = document.createElement('canvas'); m.width = w; m.height = h;
      var mc = m.getContext('2d'); mc.beginPath();
      regions[z].forEach(function (p, i) { var X = (p[0] - x0) * k, Y = (p[1] - y0) * k; if (i) mc.lineTo(X, Y); else mc.moveTo(X, Y); });
      mc.closePath(); mc.fillStyle = '#fff'; mc.fill();
      masks[z] = mc.getImageData(0, 0, w, h).data;
    });
    var Ls = [], As = [], Bs = [];
    for (var p = 0, i = 0; p < w * h; p++, i += 4) {
      var inAny = Object.keys(masks).some(function (z) { return masks[z][i] > 127; });
      if (!inAny) continue;
      var v = rgbToLab(px[i], px[i + 1], px[i + 2]); lab[p] = v;
      if (!(v[0] > 90 && Math.hypot(v[1], v[2]) < 12)) { Ls.push(v[0]); As.push(v[1]); Bs.push(v[2]); }
    }
    var med = function (a) { a.sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; };
    var ref = [med(Ls), med(As), med(Bs)], out = {}, frac = {};
    Object.keys(masks).forEach(function (z) {
      var n = 0, bad = 0, md = masks[z];
      for (var p2 = 0, j = 0; p2 < w * h; p2++, j += 4) {
        if (md[j] <= 127 || !lab[p2]) continue;
        var v2 = lab[p2];
        if (v2[0] > 90 && Math.hypot(v2[1], v2[2]) < 12) continue; // reflejo
        n++;
        if (Math.hypot(v2[0] - ref[0], v2[1] - ref[1], v2[2] - ref[2]) > PHOTO_RULES.occludedDeltaE) bad++;
      }
      frac[z] = n ? +(bad / n).toFixed(2) : 1;
      out[z] = !n || bad / n > PHOTO_RULES.occludedFrac;
    });
    return { occluded: out, frac: frac };
  }

  (function skinEvaluation() {
    if (!CFG.AI_ANALYSIS_ENABLED || !EV) return;
    $('#analisis').hidden = false; $('#aiHeroLink').hidden = false; $('#aiHeroMicro').hidden = false;
    var card = $('#analisis .ai-tool');
    // photo: foto aceptada · pending: foto en revisión. { canvas, P, upload, mirror, url, quality, measures, observations, spots, checks }
    var answers = {}, screens = [], qi = 0, photo = null, pending = null, report = null, lms = {}, cam = null, camToken = null;
    // retake: "Repetir foto" desde el resultado (la foto anterior se conserva hasta aceptar la nueva) ·
    // resume: después de la nueva foto solo se preguntan las respuestas que falten (las de la foto se vuelven a pedir).
    var retake = false, resume = false;

    function show(name) {
      if (name !== 'camara') stopCamera();
      $$('[data-ai]', card).forEach(function (e) { e.hidden = e.getAttribute('data-ai') !== name; });
      if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function withTimeout(p, ms, code) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(code)); }, ms); })]); }
    function getLandmarker(mode) {
      if (lms[mode]) return lms[mode];
      lms[mode] = withTimeout(import(MP_BASE + '/vision_bundle.mjs').then(function (v) {
        return v.FilesetResolver.forVisionTasks(MP_BASE + '/wasm').then(function (fs) {
          return v.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: mode, numFaces: 2 });
        });
      }), 30000, 'model_timeout');
      lms[mode].catch(function () { delete lms[mode]; });
      return lms[mode];
    }
    function diag(d) { var b = $('#aiDiag'); if (!DIAG || !d) { b.hidden = true; return; } b.textContent = JSON.stringify(d, null, 1); b.hidden = false; }
    function releasePhoto(ph) { if (!ph) return; if (ph.url) URL.revokeObjectURL(ph.url); if (ph.canvas) { ph.canvas.width = 0; ph.canvas.height = 0; } }
    /** Borra la foto de la memoria de la página (no hay otra copia: nunca se envió ni se guardó). */
    function discardPhotos() { releasePhoto(photo); releasePhoto(pending); photo = null; pending = null; }

    // 1. Introducción
    function needsAdult() {
      if ($('#aiAdult').checked) { status($('#aiIntroStatus'), ''); return false; }
      status($('#aiIntroStatus'), 'Esta evaluación es solo para mayores de 18 años.', 'error'); return true;
    }
    function begin() { Track.send('analisis_inicio', { dedupeKey: 'analisis_inicio:' + PAGE_LOADED_AT }); }
    $('#aiStart').addEventListener('click', function () { if (needsAdult()) return; begin(); startCamera(); });
    $('#aiUploadStart').addEventListener('click', function () { if (needsAdult()) return; begin(); $('#aiFile').click(); });
    $('#aiNoPhoto').addEventListener('click', function () { if (needsAdult()) return; begin(); withoutPhoto(); });
    function withoutPhoto() {
      if (retake && report) { setRetake(false); releasePhoto(pending); pending = null; show('resultado'); return; }
      discardPhotos(); startQuiz();
    }
    function setRetake(on) {
      retake = on;
      $('#aiCamSkip').textContent = $('#aiReviewSkip').textContent = on ? 'Volver al resultado' : 'Seguir sin foto';
    }
    function retakePhoto() {
      setRetake(true);
      Track.send('analisis_repetir_foto', { dedupeKey: 'analisis_repetir_foto:' + Date.now() });
      if (photo && photo.upload) $('#aiFile').click(); else startCamera();
    }

    // 2. Cámara guiada: una foto de frente, con captura automática cuando la cara está bien ubicada
    function setMsg(t, ready) { $('#aiCamMsg').textContent = t; $('#aiCam').classList.toggle('is-ready', !!ready); }
    function startCamera() {
      show('camara'); stopCamera(); setMsg('Preparando la cámara…'); status($('#aiCamStatus'), ''); $('#aiCamRetry').hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraFail('Este navegador no permite usar la cámara.', false);
      var token = camToken = {};
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false }).then(function (stream) {
        if (camToken !== token) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        cam = { stream: stream, hold: 0, last: 0, frame: 0, light: null, startedAt: Date.now() };
        var video = $('#aiVideo'); video.srcObject = stream; video.play().catch(function () {});
        setMsg('Cargando el análisis de la foto…');
        return getLandmarker('VIDEO').then(function (lm) { if (cam && camToken === token) { cam.lm = lm; cam.startedAt = Date.now(); loop(); } },
          function () { if (camToken === token) modelFail(); });
      }, function (e) {
        if (camToken !== token) return;
        var n = e && e.name;
        cameraFail(n === 'NotAllowedError' || n === 'SecurityError' ? 'No diste permiso para usar la cámara. Podés habilitarlo en la configuración del navegador y reintentar.'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No encontramos una cámara en este dispositivo.'
          : n === 'NotReadableError' ? 'La cámara está en uso por otra aplicación. Cerrala y reintentá.' : 'No pudimos abrir la cámara.', n !== 'NotFoundError');
      });
    }
    function cameraFail(msg, canRetry) {
      stopCamera(); setMsg('Cámara no disponible');
      status($('#aiCamStatus'), msg + ' También podés subir una foto o seguir sin foto.', 'error');
      $('#aiCamRetry').hidden = !canRetry;
    }
    function modelFail() {
      stopCamera(); setMsg('No se pudo cargar el análisis');
      status($('#aiCamStatus'), 'No pudimos cargar el análisis de la foto (puede ser la conexión o el navegador). Reintentá o seguí sin foto: el resultado saldrá de tus respuestas.', 'error');
      $('#aiCamRetry').hidden = false;
    }
    function stopCamera() {
      camToken = null;
      if (cam && cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
      if (cam) cam.stopped = true;
      cam = null;
      var v = $('#aiVideo'); if (v) v.srcObject = null;
    }
    $('#aiCamRetry').addEventListener('click', startCamera);
    $('#aiCamSkip').addEventListener('click', withoutPhoto);
    $('#aiCamUpload').addEventListener('click', function () { $('#aiFile').click(); });
    /** Posición del rostro en el recuadro visible (el video se muestra recortado y en espejo). */
    function faceBox(P, video) {
      var vw = video.videoWidth, vh = video.videoHeight, box = $('#aiCam').getBoundingClientRect();
      var sc = Math.max(box.width / vw, box.height / vh), ox = (vw * sc - box.width) / 2, oy = (vh * sc - box.height) / 2;
      var xs = P.map(function (p) { return 1 - (p.x * vw * sc - ox) / box.width; }), ys = P.map(function (p) { return (p.y * vh * sc - oy) / box.height; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX };
    }
    /** Giro: -1..1 (0 = de frente). */
    function turnOf(P) { var dl = Math.abs(P[1].x - P[234].x), dr = Math.abs(P[454].x - P[1].x); return (dl - dr) / Math.max(1e-6, dl + dr); }
    function rollOf(P, W, H) { return Math.abs(Math.atan2((P[263].y - P[33].y) * H, (P[263].x - P[33].x) * W) * 180 / Math.PI); }
    function loop() {
      if (!cam || cam.stopped) return;
      var video = $('#aiVideo'), now = performance.now();
      if (now - cam.last < 66 || video.readyState < 2) { requestAnimationFrame(loop); return; } // ~15 cuadros por segundo
      cam.last = now; cam.frame++;
      var faces;
      try { var res = cam.lm.detectForVideo(video, now); faces = res && res.faceLandmarks || []; }
      catch (e) { return modelFail(); }
      guide(faces, video);
      if (cam && !cam.hinted && Date.now() - cam.startedAt > 25000) {
        cam.hinted = true;
        status($('#aiCamStatus'), '¿Cuesta? Probá mirando hacia una ventana, con el celular a la altura de los ojos. También podés subir una foto.');
      }
      if (cam) requestAnimationFrame(loop);
    }
    function guide(faces, video) {
      var R = CAM_RULES;
      if (!faces.length) { cam.hold = 0; return setMsg('Centrá tu cara en el óvalo'); }
      if (faces.length > 1) { cam.hold = 0; return setMsg('Tiene que aparecer solo tu cara'); }
      var P = faces[0], b = faceBox(P, video), s = turnOf(P), roll = rollOf(P, video.videoWidth, video.videoHeight);
      if (cam.frame % 6 === 0) cam.light = lightOf(video, P);
      var msg = '';
      if (b.w < R.minSize) msg = 'Acercate un poco';
      else if (b.w > R.maxSize) msg = 'Alejate un poco';
      else if (Math.abs(b.cx - 0.5) > R.centerTol || Math.abs(b.cy - 0.45) > R.centerTol * 1.4) msg = 'Centrá tu cara en el óvalo';
      else if (cam.light === 'oscuro') msg = 'Buscá más luz, de frente';
      else if (cam.light === 'quemado') msg = 'Hay demasiada luz: buscá una más suave';
      else if (Math.abs(s) > R.frontMaxTurn) msg = 'Mirá de frente a la cámara';
      else if (roll > PHOTO_RULES.maxRollDeg) msg = 'Enderezá la cabeza';
      if (msg) { cam.hold = 0; return setMsg(msg); }
      cam.hold++;
      setMsg('Quedate quieta un momento…', true);
      if (cam.hold >= R.holdFrames) capture(P);
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
    function capture(P) {
      var video = $('#aiVideo'), c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0); // sin espejo: la imagen real
      var checks = {}, bad = evaluatePhoto(c, [P], checks).filter(function (x) { return x[0] === 'bad'; })[0];
      if (bad) { cam.hold = 0; setMsg(bad[1]); c.width = 0; return; }
      var fl = $('#aiFlash'); fl.classList.add('is-on'); setTimeout(function () { fl.classList.remove('is-on'); }, 60);
      stopCamera();
      prepare(c, P, { upload: false, mirror: true, checks: checks });
    }

    // Alternativa: subir una foto de frente
    $('#aiFile').addEventListener('change', function () { loadFile(this.files && this.files[0]); this.value = ''; });
    function loadFile(f) {
      if (!f) return;
      stopCamera(); show('revision'); reviewLoading('Revisando la foto…');
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return reviewRejected(null, ['Elegí una foto (JPG o PNG).']);
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); // el navegador aplica la orientación EXIF; no se copian metadatos
        URL.revokeObjectURL(url);
        if (Math.min(img.naturalWidth, img.naturalHeight) < 480) return reviewRejected(c, ['La foto tiene poca resolución. Probá con la cámara del teléfono.']);
        getLandmarker('IMAGE').then(function (lm) {
          var faces = (lm.detect(c) || {}).faceLandmarks || [], checks = {};
          var bad = evaluatePhoto(c, faces, checks).filter(function (x) { return x[0] === 'bad'; }).map(function (x) { return x[1]; });
          if (bad.length) { diag({ controles: checks }); return reviewRejected(c, bad); }
          prepare(c, faces[0], { upload: true, mirror: false, checks: checks });
        }).catch(function () { reviewRejected(c, ['No pudimos cargar el análisis de la foto en este dispositivo (puede ser la conexión). Reintentá o seguí sin foto.']); });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reviewRejected(null, ['No pudimos leer esa foto. Probá con una en JPG o PNG.']); };
      img.src = url;
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
      // Primero la luz: con poca luz o zonas quemadas la nitidez medida baja y "movida" sería un motivo equivocado.
      if (q.clipHigh > PHOTO_RULES.maxClipHigh) out.push(['bad', 'Hay demasiada luz o reflejos fuertes en la cara. Buscá una luz más suave, sin sol directo.']);
      else if (q.clipLow > PHOTO_RULES.maxClipLow || q.contrast < PHOTO_RULES.minContrast) out.push(['bad', 'La foto está muy oscura. Buscá más luz, de frente (por ejemplo, mirando a una ventana).']);
      else if (q.sharpness < PHOTO_RULES.minSharpness) out.push(['bad', 'La foto salió movida o desenfocada. Apoyá los codos y quedate quieta un segundo.']);
      var sz = (maxX - minX) * W * 0.12;
      var mL = meanLum(canvas, P[50].x * W - sz / 2, P[50].y * H - sz / 2, sz), mR = meanLum(canvas, P[280].x * W - sz / 2, P[280].y * H - sz / 2, sz);
      m.luzLados = +(Math.max(mL, mR) / Math.max(1, Math.min(mL, mR))).toFixed(2);
      return out;
    }

    /** Analiza la foto de frente: zonas, si se ven, detalle disponible y mediciones. */
    function analyzeFront(canvas, P, checks) {
      var W = canvas.width, H = canvas.height;
      var regions = regionPolygons(W, H, P);
      var occ = occlusionOf(canvas, regions);
      var pxPerMm = Math.hypot((P[454].x - P[234].x) * W, (P[454].y - P[234].y) * H) / FACE_WIDTH_MM;
      var quality = { pxPerMm: +pxPerMm.toFixed(2), sideLight: checks.luzLados > PHOTO_RULES.maxSideLight, occluded: occ.occluded };
      var measures = measureSkin(canvas, P, occ.occluded, regions);
      var observations = EV.observePhoto(measures, quality, regions);
      return { regions: regions, quality: quality, occlusionFrac: occ.frac, measures: measures, observations: observations, spots: measures.spots };
    }
    function prepare(canvas, P, o) {
      var a;
      try { a = analyzeFront(canvas, P, o.checks); }
      catch (e) { return reviewRejected(canvas, ['No pudimos analizar esta foto. Probá con otra o seguí sin foto.'], true); }
      releasePhoto(pending);
      pending = { canvas: canvas, P: P, upload: o.upload, mirror: o.mirror, checks: o.checks, quality: a.quality, measures: a.measures,
        observations: a.observations, spots: a.spots, regions: a.regions, url: null };
      canvas.toBlob(function (b) {
        if (!pending || pending.canvas !== canvas) return;
        pending.url = b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', 0.92);
        renderReview(pending);
      }, 'image/jpeg', 0.92);
      diag({ controles: o.checks, calidad: a.quality, zonasTapadas: a.occlusionFrac, mediciones: a.measures.raw,
        observaciones: a.observations.map(function (x) { return x.category + ': ' + x.status + (x.reason ? ' (' + x.reason + ')' : ''); }),
        puntitos: { oscurosNariz: a.measures.darkSpots.length, clarosMejillas: a.measures.lightSpots.length }, reflejos: a.measures.shine });
    }

    // Revisión de la foto antes de usarla
    function reviewLoading(msg) {
      $('#aiReviewImg').hidden = true; $('#aiReviewChecks').innerHTML = ''; $('#aiUse').hidden = true;
      status($('#aiReviewStatus'), msg);
    }
    function showReviewImage(src, mirror) {
      var img = $('#aiReviewImg'); img.src = src; img.hidden = false; img.classList.toggle('is-mirror', !!mirror);
    }
    function checkItem(kind, text) { var li = el('li', 'is-' + kind, text); return li; }
    function renderReview(ph) {
      show('revision');
      showReviewImage(ph.url, ph.mirror);
      var ul = $('#aiReviewChecks'); ul.innerHTML = '';
      ul.appendChild(checkItem('ok', 'Se ve un solo rostro, de frente y completo.'));
      ul.appendChild(checkItem('ok', 'Nitidez y luz suficientes.'));
      var q = ph.quality, occ = q.occluded || {}, warns = [];
      if (occ.frente) warns.push('La frente se ve tapada o con sombra (pelo, flequillo o gorro). Esa zona no se va a evaluar.');
      if (occ.nariz) warns.push('La nariz se ve tapada o con sombra. Esa zona no se va a evaluar.');
      if (occ.mejilla_der && occ.mejilla_izq) warns.push('Las mejillas se ven tapadas o con sombra. No se van a evaluar.');
      else if (occ.mejilla_der || occ.mejilla_izq) warns.push('Una mejilla se ve tapada o con sombra (pelo, mano o luz de costado). Se evalúa solo la otra.');
      if (q.sideLight) warns.push('La luz llega más de un lado de la cara. Brillo, rojez y tono no se van a evaluar: probá de frente a una ventana.');
      if (!(q.pxPerMm >= EV.NEEDS.puntos_oscuros.pxPerMm)) warns.push('La foto tiene poco detalle de cerca: algunas observaciones no se van a evaluar. Acercá un poco la cámara si querés incluirlas.');
      warns.forEach(function (w) { ul.appendChild(checkItem('warn', w)); });
      $('#aiUse').hidden = false;
      $('#aiRetry').textContent = ph.upload ? 'Elegir otra foto' : 'Sacar otra foto';
      status($('#aiReviewStatus'), warns.length ? 'Podés usarla igual o repetirla para evaluar más zonas.' : 'Si se ve bien, usala. Si no, repetila.');
      Track.send('analisis_foto_lista', { dedupeKey: 'analisis_foto_lista:' + PAGE_LOADED_AT });
    }
    function reviewRejected(canvas, msgs, analysisError) {
      show('revision');
      var ul = $('#aiReviewChecks'); ul.innerHTML = '';
      msgs.forEach(function (m) { ul.appendChild(checkItem('bad', m)); });
      $('#aiUse').hidden = true;
      if (canvas && canvas.width) showReviewImage(canvas.toDataURL('image/jpeg', 0.85), false); else $('#aiReviewImg').hidden = true;
      if (canvas) { canvas.width = 0; canvas.height = 0; } // no se conserva
      $('#aiRetry').textContent = 'Probar de nuevo';
      status($('#aiReviewStatus'), analysisError ? 'Podés reintentar con otra foto o seguir solo con las preguntas.' : 'Esta foto no sirve para evaluar la piel. Sacá otra o seguí sin foto.', 'error');
      Track.send('analisis_foto_rechazada', { dedupeKey: 'analisis_foto_rechazada:' + Date.now() });
    }
    $('#aiUse').addEventListener('click', function () {
      if (!pending) return;
      releasePhoto(photo); photo = pending; pending = null;
      Track.send('analisis_foto_aceptada', { dedupeKey: 'analisis_foto_aceptada:' + PAGE_LOADED_AT });
      if (retake && report) { // nueva foto desde el resultado: se vuelve a preguntar solo lo de la foto
        setRetake(false); delete answers.en_cara; delete answers.filtro;
        screens = EV.quizFor({ photo: true, upload: !!photo.upload });
        var nx = nextMissing(0);
        if (nx < 0) return finish();
        resume = true; qi = nx; show('quiz'); renderScreen(); return;
      }
      startQuiz();
    });
    $('#aiRetry').addEventListener('click', function () {
      var wasUpload = pending ? pending.upload : $('#aiRetry').textContent === 'Elegir otra foto';
      releasePhoto(pending); pending = null; $('#aiReviewImg').removeAttribute('src');
      if (wasUpload) $('#aiFile').click(); else startCamera();
    });
    $('#aiReviewUpload').addEventListener('click', function () { $('#aiFile').click(); });
    $('#aiReviewSkip').addEventListener('click', withoutPhoto);

    /**
     * Mediciones por zona con los puntos faciales. Comparar zonas del mismo rostro reduce el efecto del tono de piel
     * y de la luz general, pero no lo elimina. Umbrales en evaluation.js (provisorios).
     */
    function zoneStats(canvas, P, ids) {
      var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
      var xs = P.map(function (p) { return p.x; });
      var size = Math.max(8, Math.round((Math.max.apply(null, xs) - Math.min.apply(null, xs)) * W * 0.08));
      var spec = 0, red = 0, n = 0, nRed = 0, tex = 0, cv = 0, spots = 0;
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
        tex += lapEnergy(grayCrop(canvas, x, y, size, size, 32)); cv += detrendedCv(grayCrop(canvas, x, y, size, size, 8));
        spots += darkSpots(grayCrop(canvas, x, y, size, size, 48), 0.80, 12, 10);
      });
      var m = ids.length;
      return { spec: spec / n, red: nRed ? red / nRed : 0, tex: tex / m, cv: cv / m, spots: spots / m };
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
      var count = 0;
      components(mask, w, h, function (cmp) { if (cmp.area <= maxArea) count++; });
      return count / g.length * 1000;
    }
    /**
     * Dónde están los reflejos (brillo) dentro de cada zona: fracción de píxeles con reflejo, su centro y cuánto se reparten,
     * en píxeles de la foto original. Sirve para ubicar la marca sobre la evidencia, no en un lugar genérico.
     */
    function regionShine(canvas, regions) {
      var all = [];
      Object.keys(regions).forEach(function (z) { all = all.concat(regions[z]); });
      var x0 = Math.min.apply(null, all.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, all.map(function (p) { return p[0]; }));
      var y0 = Math.min.apply(null, all.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, all.map(function (p) { return p[1]; }));
      var k = 240 / Math.max(1, x1 - x0), w = 240, h = Math.max(1, Math.round((y1 - y0) * k));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
      var px = c.getContext('2d').getImageData(0, 0, w, h).data, out = {};
      Object.keys(regions).forEach(function (z) {
        var m = document.createElement('canvas'); m.width = w; m.height = h;
        var mc = m.getContext('2d'); mc.beginPath();
        regions[z].forEach(function (p, i) { var X = (p[0] - x0) * k, Y = (p[1] - y0) * k; if (i) mc.lineTo(X, Y); else mc.moveTo(X, Y); });
        mc.closePath(); mc.fillStyle = '#fff'; mc.fill();
        var md = mc.getImageData(0, 0, w, h).data, n = 0, s = 0, sx = 0, sy = 0, pts = [];
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4; if (md[i] <= 127) continue; n++;
          var r = px[i], g = px[i + 1], b = px[i + 2], lum = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
          if (lum >= 230 && sat < 0.25) { s++; sx += x; sy += y; pts.push(x, y); }
        }
        if (!s) { out[z] = { frac: 0 }; return; }
        var cx = sx / s, cy = sy / s, v = 0;
        for (var j = 0; j < pts.length; j += 2) v += Math.pow(pts[j] - cx, 2) + Math.pow(pts[j + 1] - cy, 2);
        out[z] = { frac: +(s / n).toFixed(3), x: cx / k + x0, y: cy / k + y0, spread: Math.sqrt(v / s) / k };
      });
      return out;
    }
    function measureSkin(canvas, P, occ, regions) {
      var T = zoneStats(canvas, P, ZONE_T), N = zoneStats(canvas, P, ZONE_NOSE);
      var per = {}, cheeks = [];
      [['mejilla_der', CHEEK_R], ['mejilla_izq', CHEEK_L]].forEach(function (x) {
        if (occ[x[0]]) return;
        var c = zoneStats(canvas, P, x[1]); cheeks.push(c);
        per[x[0]] = { texture: c.tex, redDiff: c.red - T.red, toneCv: c.cv };
      });
      var avg = function (k) { return cheeks.length ? cheeks.reduce(function (s, c) { return s + c[k]; }, 0) / cheeks.length : NaN; };
      var det = detectSpots(canvas, P), W = canvas.width, H = canvas.height;
      var at = function (type) { return det.spots.filter(function (f) { return f.type === type; }).map(function (f) { return { x: f.x * W, y: f.y * H }; }); };
      var m = { shineT: T.spec, shineC: avg('spec'), redDiff: avg('red') - T.red, texture: avg('tex'), toneCv: avg('cv'), noseSpots: N.spots, noseBlobs: det.counts.punto_negro };
      var raw = {};
      Object.keys(m).forEach(function (k) { raw[k] = isFinite(m[k]) ? +m[k].toFixed(3) : null; });
      // Ubicación de la evidencia (solo en el teléfono; no se envía): reflejos por zona, cada mejilla, puntitos oscuros y claros.
      m.shine = regionShine(canvas, regions); m.cheeks = per; m.darkSpots = at('punto_negro'); m.lightSpots = at('milium');
      m.raw = raw; m.spots = det;
      return m;
    }

    // 3. Cuestionario: pantallas cortas, nada marcado de antemano; "No sé" es una respuesta válida
    function nextMissing(from) { for (var i = from; i < screens.length; i++) if (EV.missingIn(screens[i], answers).length) return i; return -1; }
    function startQuiz() { resume = false; screens = EV.quizFor({ photo: !!photo, upload: !!(photo && photo.upload) }); qi = 0; show('quiz'); renderScreen(); }
    function renderScreen() {
      var sc = screens[qi], box = $('#aiQ');
      $('#aiQStep').textContent = 'Paso ' + (qi + 1) + ' de ' + screens.length + ' · ' + sc.title;
      $('#aiQBar').style.width = Math.round(qi / screens.length * 100) + '%';
      box.innerHTML = ''; status($('#aiQStatus'), '');
      if (sc.intro) box.appendChild(el('p', 'ai-q-intro', sc.intro));
      var vis = EV.visibleItems(sc, answers);
      sc.items.forEach(function (it) { if (vis.indexOf(it) < 0) delete answers[it.k]; }); // lo que deja de aplicar no se conserva
      vis.forEach(function (it) {
        var fs = el('fieldset', 'ai-q' + (it.o.length === 2 ? ' is-inline' : '')); fs.setAttribute('data-k', it.k);
        fs.appendChild(el('legend', null, it.q));
        var cur = answers[it.k];
        it.o.forEach(function (o) {
          var lab = el('label', 'ai-opt'), inp = document.createElement('input');
          inp.type = it.multi ? 'checkbox' : 'radio'; inp.name = 'q_' + it.k; inp.value = o[0];
          inp.checked = it.multi ? (cur || []).indexOf(o[0]) >= 0 : cur === o[0];
          lab.appendChild(inp); lab.appendChild(document.createTextNode(o[1])); fs.appendChild(lab);
        });
        box.appendChild(fs);
      });
      box.onchange = function (e) {
        var t = e.target, fs = t.closest('fieldset'), k = fs && fs.getAttribute('data-k'), it = sc.items.filter(function (x) { return x.k === k; })[0];
        if (!it) return;
        if (it.multi) {
          var all = $$('input', fs), excl = it.exclusive || [];
          all.forEach(function (i) { if (i !== t && t.checked && (excl.indexOf(t.value) >= 0 || excl.indexOf(i.value) >= 0)) i.checked = false; });
          var vals = all.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
          if (vals.length) answers[k] = vals; else delete answers[k];
        } else answers[k] = t.value;
        fs.classList.remove('is-missing'); fs.removeAttribute('aria-invalid');
        status($('#aiQStatus'), '');
        // Si cambia una respuesta de la que depende otra pregunta de esta pantalla, se vuelve a dibujar.
        if (sc.items.some(function (x) { return x.showIf; })) {
          var before = vis.length; vis = EV.visibleItems(sc, answers);
          if (vis.length !== before) { renderScreen(); var f = $('input[name="q_' + k + '"]:checked', box); if (f) f.focus(); }
        }
      };
      $('#aiQNext').textContent = qi === screens.length - 1 || (resume && nextMissing(qi + 1) < 0) ? 'Ver mi resultado' : 'Siguiente';
    }
    $('#aiQBack').addEventListener('click', function () {
      if (qi > 0) { qi--; renderScreen(); return; }
      if (photo) { pending = photo; photo = null; renderReview(pending); } else show('intro');
    });
    $('#aiQNext').addEventListener('click', function () {
      var miss = EV.missingIn(screens[qi], answers);
      if (miss.length) {
        miss.forEach(function (k) { var fs = $('fieldset[data-k="' + k + '"]', $('#aiQ')); if (fs) { fs.classList.add('is-missing'); fs.setAttribute('aria-invalid', 'true'); } });
        status($('#aiQStatus'), miss.length > 1 ? 'Faltan ' + miss.length + ' respuestas en esta pantalla.' : 'Falta una respuesta en esta pantalla.', 'error');
        var first = $('fieldset.is-missing input', $('#aiQ')); if (first) first.focus();
        return;
      }
      var nx = resume ? nextMissing(qi + 1) : (qi < screens.length - 1 ? qi + 1 : -1);
      if (nx >= 0) { qi = nx; renderScreen(); $('#aiQStep').scrollIntoView({ block: 'nearest' }); return; }
      resume = false;
      $('#aiQBar').style.width = '100%';
      Track.send('analisis_cuestionario_completo', { dedupeKey: 'analisis_cuestionario:' + PAGE_LOADED_AT });
      if (session) finish(); else show('datos');
    });

    // 4. Datos de contacto, antes de ver el resultado (solo contacto: las respuestas y la foto no se envían)
    bindLeadForm({ form: $('#aiLead'), btn: $('#aiLeadBtn'), statusEl: $('#aiLeadStatus'), p: 'a', e: 'ea', origin: 'analisis',
      onSaved: function () {
        finish();
        if (!store.get('sessionStorage', 'cc_booking')) prepareScheduling();
      } });

    // 5. Informe: se arma en el teléfono con datos estructurados; si algo falla se informa y se puede reintentar
    function finish() {
      try {
        report = EV.buildReport(answers, photo ? { observations: photo.observations } : null);
        renderReport(report);
        Track.send('analisis_resultado', { dedupeKey: 'analisis_resultado:' + PAGE_LOADED_AT });
      } catch (e) {
        report = null;
        var out = $('#aiResult'); out.innerHTML = '';
        out.appendChild(el('h3', null, 'No pudimos preparar tu resultado'));
        out.appendChild(el('p', null, 'Ocurrió un error al armar la orientación. No te mostramos un resultado incompleto.'));
        var acts = el('div', 'ai-actions'), again = el('button', 'btn', 'Reintentar'), restart = el('button', 'btn btn-ghost', 'Volver a empezar');
        again.type = restart.type = 'button';
        again.addEventListener('click', finish); restart.addEventListener('click', restartAll);
        acts.appendChild(again); acts.appendChild(restart); out.appendChild(acts);
        show('resultado'); out.focus({ preventScroll: true });
      }
    }
    function restartAll() { setRetake(false); resume = false; discardPhotos(); answers = {}; report = null; $('#aiResult').innerHTML = ''; show('intro'); }

    var SVGNS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    var HOVER = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    /**
     * Foto con marcas: un solo SVG con la imagen original y las marcas en las MISMAS coordenadas (píxeles de la foto),
     * así siguen alineadas al ampliar, mover, cambiar el tamaño o girar la pantalla. El espejo es una transformación
     * (la foto no se modifica). Ampliar: botones, pellizco con dos dedos o Ctrl + rueda; con la foto ampliada, se arrastra.
     */
    function photoViewer(ph, seen, cb) {
      var W = ph.canvas.width, H = ph.canvas.height;
      var mx = function (x) { return ph.mirror ? W - x : x; };
      var xs = ph.P.map(function (p) { return mx(p.x * W); }), ys = ph.P.map(function (p) { return p.y * H; });
      var fx0 = Math.min.apply(null, xs), fx1 = Math.max.apply(null, xs), fy0 = Math.min.apply(null, ys), fy1 = Math.max.apply(null, ys), pad = (fx1 - fx0) * 0.14;
      var bx0 = Math.max(0, fx0 - pad), bx1 = Math.min(W, fx1 + pad), by0 = Math.max(0, fy0 - pad * 1.3), by1 = Math.min(H, fy1 + pad * 0.6);
      var base = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, view = Object.assign({}, base), sel = '', marksOn = true;
      var svg = svgEl('svg', { class: 'ai-photo-svg', role: 'group', 'aria-label': 'Tu foto' + (seen.length ? ' con las observaciones marcadas' : '') });
      svg.style.aspectRatio = (base.w / base.h).toFixed(4);
      var g = svgEl('g', ph.mirror ? { transform: 'translate(' + W + ' 0) scale(-1 1)' } : {});
      var im = svgEl('image', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' });
      im.setAttribute('href', ph.url); im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', ph.url);
      g.appendChild(im); svg.appendChild(g);
      var rings = svgEl('g', { class: 'ai-marks' }), badges = svgEl('g', { class: 'ai-marks' });
      svg.appendChild(rings); svg.appendChild(badges);
      // Anillos: solo donde la evidencia está localizada (reflejos, puntitos). En hallazgos extendidos va solo el número.
      seen.forEach(function (o) {
        (o.geometry ? o.geometry.marks : []).forEach(function (k) {
          if (k.kind !== 'punto') return;
          rings.appendChild(svgEl('circle', { class: 'ai-ring', 'data-n': o.n, cx: mx(k.x).toFixed(1), cy: k.y.toFixed(1), r: k.r.toFixed(1),
            stroke: EV.CAT[o.category].color, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
        });
      });
      var moved = false;
      function drawBadges() {
        badges.innerHTML = '';
        var r = view.w * 0.036, used = [];
        seen.forEach(function (o) {
          (o.geometry ? o.geometry.marks : []).forEach(function (k, i) {
            var cx = mx(k.x), cy = k.y;
            if (k.kind === 'punto') { var d = Math.max(k.r, r * 0.6) * 0.71 + r * 0.55; cx += ph.mirror ? -d : d; cy -= d; }
            for (var t = 0; t < 8 && used.some(function (u) { return Math.hypot(u[0] - cx, u[1] - cy) < r * 2.1; }); t++) cy += r * 2.2; // nunca dos números encimados
            used.push([cx, cy]);
            var b = svgEl('g', { class: 'ai-badge' + (String(o.n) === sel ? ' is-sel' : ''), 'data-n': o.n, tabindex: i ? '-1' : '0', role: 'button',
              'aria-label': 'Marca ' + o.n + ': ' + o.label + ', ' + o.zone, 'aria-controls': 'aiDetail' });
            if (i) b.setAttribute('aria-hidden', 'true');
            b.appendChild(svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), fill: EV.CAT[o.category].color, stroke: '#fff', 'stroke-width': (r * 0.2).toFixed(1) }));
            var tx = svgEl('text', { x: cx.toFixed(1), y: cy.toFixed(1), 'font-size': (r * 1.15).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff' });
            tx.textContent = String(o.n); b.appendChild(tx);
            b.addEventListener('click', function (e) { e.stopPropagation(); if (!moved) cb.pick(o.n); });
            b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.pick(o.n); } });
            if (HOVER) { b.addEventListener('mouseenter', function () { cb.hover(o.n); }); b.addEventListener('mouseleave', function () { cb.hover(null); }); }
            badges.appendChild(b);
          });
        });
      }
      function setView(v) {
        var w = Math.max(base.w / 5, Math.min(base.w, v.w)), h = w * base.h / base.w;
        var cx = v.x + v.w / 2, cy = v.y + v.h / 2;
        view = { w: w, h: h, x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)) };
        if (w >= base.w - 0.5) view = Object.assign({}, base);
        svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(function (n) { return n.toFixed(1); }).join(' '));
        svg.classList.toggle('is-zoomed', view.w < base.w - 0.5);
        if (zIn) { zIn.disabled = view.w <= base.w / 5 + 0.5; zOut.disabled = view.w >= base.w - 0.5; }
        drawBadges();
      }
      function zoomBy(f, at) {
        at = at || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
        var w = view.w / f, h = view.h / f;
        setView({ x: at.x - (at.x - view.x) / f, y: at.y - (at.y - view.y) / f, w: w, h: h });
      }
      function toSvg(e) { var b = svg.getBoundingClientRect(); return { x: view.x + (e.clientX - b.left) / b.width * view.w, y: view.y + (e.clientY - b.top) / b.height * view.h }; }
      var ptrs = {}, last = null, pinch = null;
      svg.addEventListener('pointerdown', function (e) {
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = false; last = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(ptrs);
        if (ids.length === 2) { var a = ptrs[ids[0]], c = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), w: view.w }; }
      });
      svg.addEventListener('pointermove', function (e) {
        if (!ptrs[e.pointerId]) return;
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(ptrs), b = svg.getBoundingClientRect();
        if (ids.length === 2 && pinch) {
          var a = ptrs[ids[0]], c = ptrs[ids[1]], d = Math.hypot(a.x - c.x, a.y - c.y);
          var mid = toSvg({ clientX: (a.x + c.x) / 2, clientY: (a.y + c.y) / 2 });
          zoomBy(view.w / (pinch.w * pinch.d / Math.max(20, d)), mid); moved = true; e.preventDefault();
        } else if (ids.length === 1 && svg.classList.contains('is-zoomed') && last) {
          var dx = (e.clientX - last.x) / b.width * view.w, dy = (e.clientY - last.y) / b.height * view.h;
          if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 0) {
            setView({ x: view.x - dx, y: view.y - dy, w: view.w, h: view.h });
            if (Math.abs(dx) + Math.abs(dy) > view.w * 0.004) moved = true;
          }
          last = { x: e.clientX, y: e.clientY }; e.preventDefault();
        }
      });
      var up = function (e) { delete ptrs[e.pointerId]; if (Object.keys(ptrs).length < 2) pinch = null; last = null; setTimeout(function () { moved = false; }, 0); };
      svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
      svg.addEventListener('wheel', function (e) { if (!e.ctrlKey) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, toSvg(e)); }, { passive: false });
      svg.addEventListener('dblclick', function (e) { zoomBy(svg.classList.contains('is-zoomed') ? 1 / 8 : 2.2, toSvg(e)); });

      var fig = el('figure', 'ai-photo'), frame = el('div', 'ai-photo-frame');
      frame.appendChild(svg);
      var zoom = el('div', 'ai-zoom'), zIn = el('button', 'ai-zoom-btn', '+'), zOut = el('button', 'ai-zoom-btn', '−');
      zIn.type = zOut.type = 'button'; zIn.setAttribute('aria-label', 'Ampliar la foto'); zOut.setAttribute('aria-label', 'Alejar la foto');
      var selCenter = function () {
        var o = seen.filter(function (x) { return String(x.n) === sel; })[0], k = o && o.geometry && o.geometry.marks[0];
        return k ? { x: mx(k.x), y: k.y } : null;
      };
      zIn.addEventListener('click', function () { var c = selCenter(); if (c) setView({ x: c.x - view.w / 4, y: c.y - view.h / 4, w: view.w / 2, h: view.h / 2 }); else zoomBy(2); });
      zOut.addEventListener('click', function () { zoomBy(1 / 2); });
      zoom.appendChild(zIn); zoom.appendChild(zOut); frame.appendChild(zoom);
      fig.appendChild(frame);
      setView(base);
      return {
        el: fig,
        select: function (n) {
          sel = n ? String(n) : '';
          svg.classList.toggle('has-sel', !!sel);
          $$('.ai-ring, .ai-badge', svg).forEach(function (m) { m.classList.toggle('is-sel', m.getAttribute('data-n') === sel); });
        },
        marks: function (on) { marksOn = on; svg.classList.toggle('marks-off', !on); return marksOn; }
      };
    }

    function waSummary(r) {
      return 'Hola, hice la evaluación cosmética en la web. ' + r.summary.join(' ') +
        (session && session.requestId ? ' Mi solicitud es ' + session.requestId + '.' : '') + ' Quisiera consultar.';
    }
    function numChip(o) { var s = el('span', 'ai-num', String(o.n)); s.style.background = EV.CAT[o.category].color; s.setAttribute('aria-hidden', 'true'); return s; }
    function more(title, cls) { var d = el('details', 'ai-more' + (cls ? ' ' + cls : '')); d.appendChild(el('summary', null, title)); return d; }

    /**
     * Resultado: título, foto con marcas, resumen breve, qué podemos trabajar, reserva y una sola aclaración.
     * Lo secundario (respuestas, método, lo no evaluado) va en desplegables. La revisión previa, si hace falta, queda a la vista.
     */
    function renderReport(r) {
      var out = $('#aiResult'); out.innerHTML = '';
      var ST = EV.ST, seen = r.observations.filter(function (o) { return o.status === ST.SEEN; });
      var byN = {}; seen.forEach(function (o) { byN[o.n] = o; });
      out.appendChild(el('h3', 'ai-title', 'Tu piel, de cerca'));

      // B. Foto con marcas interactivas
      if (r.photo === 'analizada' && photo) {
        var pinned = null, viewer, detail = el('div', 'ai-detail'), chips = el('ol', 'ai-chips');
        detail.id = 'aiDetail'; detail.setAttribute('aria-live', 'polite'); detail.hidden = true;
        var showDetail = function (n) {
          var o = byN[n]; detail.innerHTML = ''; detail.hidden = !o;
          viewer.select(o ? n : null);
          $$('.ai-chip', chips).forEach(function (c) { var on = c.getAttribute('data-n') === String(n); c.classList.toggle('is-sel', on); c.setAttribute('aria-expanded', on ? 'true' : 'false'); });
          if (!o) return;
          var h = el('p', 'ai-detail-title'); h.appendChild(numChip(o)); h.appendChild(el('strong', null, o.n + ' · ' + o.label)); detail.appendChild(h);
          var z = el('p'); z.appendChild(el('strong', null, 'Zona: ')); z.appendChild(document.createTextNode(o.zone + '.')); detail.appendChild(z);
          detail.appendChild(el('p', null, o.description + ' ' + o.meaning));
          if (o.consult) { var c = el('p'); c.appendChild(el('strong', null, 'En consulta: ')); c.appendChild(document.createTextNode(o.consult)); detail.appendChild(c); }
        };
        var pick = function (n) { pinned = pinned === n ? null : n; showDetail(pinned); if (pinned) detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        viewer = photoViewer(photo, seen, { pick: pick, hover: function (n) { showDetail(n || pinned); } });
        var bar = el('div', 'ai-photo-bar');
        if (seen.length) {
          var tg = el('button', 'ai-toggle', 'Ocultar marcas'); tg.type = 'button'; tg.setAttribute('aria-pressed', 'true');
          tg.addEventListener('click', function () {
            var on = viewer.marks(tg.getAttribute('aria-pressed') !== 'true');
            tg.setAttribute('aria-pressed', on ? 'true' : 'false'); tg.textContent = on ? 'Ocultar marcas' : 'Mostrar marcas';
          });
          bar.appendChild(tg);
        }
        var again = el('button', 'ai-toggle', 'Repetir foto'); again.type = 'button'; again.addEventListener('click', retakePhoto);
        bar.appendChild(again);
        viewer.el.appendChild(bar);
        out.appendChild(viewer.el);
        if (r.capture && !r.capture.blocking) out.appendChild(el('p', 'ai-tip', r.capture.text));
        if (seen.length) {
          seen.forEach(function (o) {
            var li = el('li'), btn = el('button', 'ai-chip'); btn.type = 'button'; btn.setAttribute('data-n', o.n);
            btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'aiDetail');
            btn.appendChild(numChip(o)); btn.appendChild(el('span', null, o.label)); btn.appendChild(el('span', 'ai-chip-zone', o.zone));
            btn.addEventListener('click', function () { pick(o.n); });
            li.appendChild(btn); chips.appendChild(li);
          });
          out.appendChild(chips); out.appendChild(detail);
        }
      } else {
        var add = el('button', 'btn btn-ghost btn-sm ai-addphoto', 'Sumar una foto'); add.type = 'button'; add.addEventListener('click', retakePhoto);
        out.appendChild(add);
      }

      // C. Resumen
      out.appendChild(el('p', 'ai-summary', r.summary.join(' ')));

      // Revisión previa: a la vista cuando las respuestas lo piden
      if (r.preReview.length) {
        var med = r.preReview.some(function (p) { return p.kind === 'medica'; });
        var e = el('section', 'ai-review-box' + (med ? ' is-medical' : ''));
        e.appendChild(el('h4', null, 'Antes de tu sesión'));
        var ule = el('ul', 'ai-list'); r.preReview.forEach(function (p) { ule.appendChild(el('li', null, p.text)); });
        e.appendChild(ule); out.appendChild(e);
      }

      // D. Qué podemos trabajar (hasta tres puntos, cada uno ligado a una marca o a tus respuestas)
      var d = el('section', 'ai-sec'); d.appendChild(el('h4', null, 'Qué podemos trabajar'));
      var uld = el('ul', 'ai-work');
      r.work.forEach(function (w) {
        var li = el('li'); li.appendChild(el('span', null, w.text));
        var refs = el('span', 'ai-refs');
        w.marks.forEach(function (n) { if (byN[n]) { var c = numChip(byN[n]); c.removeAttribute('aria-hidden'); c.setAttribute('aria-label', 'marca ' + n); c.title = byN[n].label; refs.appendChild(c); } });
        if (!w.marks.length) refs.appendChild(el('span', 'ai-src', 'por tus respuestas'));
        li.appendChild(refs); uld.appendChild(li);
      });
      d.appendChild(uld); out.appendChild(d);

      // E. Reserva
      var acts = el('div', 'ai-actions');
      var cta = el('a', 'btn', 'Reservar evaluación y limpieza facial'); cta.href = '#reservar';
      cta.addEventListener('click', function () { Track.send('analisis_clic_reserva', { dedupeKey: 'analisis_clic_reserva:' + PAGE_LOADED_AT }); });
      acts.appendChild(cta);
      // El número de WhatsApp llega con la agenda: si todavía no llegó, el botón se agrega cuando llegue.
      var addWa = function () {
        var wa = String(waNumber() || '').replace(/\D/g, '');
        if (!wa || report !== r || $('.btn-wa', acts)) return !!wa;
        var w = el('a', 'btn btn-wa', 'Consultar por WhatsApp'); w.target = '_blank'; w.rel = 'noopener';
        w.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(waSummary(r));
        w.addEventListener('click', function () { Track.send('analisis_whatsapp', { dedupeKey: 'analisis_whatsapp:' + PAGE_LOADED_AT }); });
        acts.appendChild(w); return true;
      };
      if (!addWa()) document.addEventListener('cc:whatsapp', addWa, { once: true });
      out.appendChild(acts);

      // Información secundaria
      var ans = more('Ver mis respuestas'), ula = el('ul', 'ai-list');
      if (r.tendency.key) ula.appendChild(el('li', null, 'Tendencia orientativa por tus respuestas: ' + EV.TENDENCY_LABEL[r.tendency.key] + '.'));
      r.declared.forEach(function (x) { ula.appendChild(el('li', null, x.text)); });
      if (!ula.children.length) ula.appendChild(el('li', null, 'No hay respuestas para mostrar.'));
      ans.appendChild(ula); out.appendChild(ans);

      var about = more('Sobre este análisis');
      about.appendChild(el('p', null, r.photo === 'analizada'
        ? 'La foto se analiza en tu teléfono: se ubican los puntos de tu cara y se miden reflejos, contraste y color por zona. Cada marca sale de esas mediciones. Tus respuestas no generan marcas.'
        : 'Sin foto, la orientación sale de tus respuestas.'));
      var photoNA = r.observations.filter(function (o) { return o.status === ST.NA && o.naKind !== EV.NA_KIND.DETECTOR; });
      var detNA = r.observations.filter(function (o) { return o.status === ST.NA && o.naKind === EV.NA_KIND.DETECTOR; });
      if (photoNA.length) {
        var ul2 = el('ul', 'ai-list');
        photoNA.forEach(function (o) { var li = el('li'); li.appendChild(el('strong', null, o.label + ': ')); li.appendChild(document.createTextNode(o.reason)); ul2.appendChild(li); });
        about.appendChild(el('p', 'ai-more-h', 'No se pudo evaluar en esta foto')); about.appendChild(ul2);
      }
      if (detNA.length) about.appendChild(el('p', null, detNA.map(function (o) { return o.reason; }).join(' ')));
      about.appendChild(el('p', null, 'Las técnicas las elige la ' + EV.PRO + ' en la consulta, según lo que observe y lo que tolere tu piel.'));
      out.appendChild(about);

      if (session && session.requestId) { var sh = more('Enviar este resumen a la profesional'); sh.appendChild(shareBox(r)); out.appendChild(sh); }

      var restart = el('button', 'link-btn ai-restart', 'Volver a empezar (borra la foto y las respuestas)'); restart.type = 'button';
      restart.addEventListener('click', restartAll); out.appendChild(restart);

      // F. Aclaración única
      out.appendChild(el('p', 'ai-disclaimer', r.disclaimer));
      show('resultado'); out.focus({ preventScroll: true });
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    /** Envío opcional del resumen a la profesional: consentimiento aparte, solo texto (nunca la foto). */
    function shareBox(r) {
      var box = el('div', 'ai-share');
      box.appendChild(el('p', 'ai-note', 'Así la ' + EV.PRO + ' lo puede leer antes de tu sesión. Se envía el texto de este resultado, no la foto, y queda guardado con tus datos de contacto en la planilla de la clínica. No se usa para otra cosa.'));
      var fld = el('div', 'field check'), cb = document.createElement('input'), lb = el('label', null, 'Acepto enviar este resumen a la profesional.');
      cb.type = 'checkbox'; cb.id = 'aiShareOk'; lb.htmlFor = 'aiShareOk'; fld.appendChild(cb); fld.appendChild(lb); box.appendChild(fld);
      var btn = el('button', 'btn btn-ghost btn-sm', 'Enviar resumen'); btn.type = 'button';
      var st = el('p', 'form-status'); st.setAttribute('role', 'status');
      btn.addEventListener('click', function () {
        if (!cb.checked) { status(st, 'Marcá la casilla si querés enviarlo.', 'error'); return; }
        setBusy(btn, true, 'Enviando…');
        var body = { requestId: session.requestId, token: session.token, adult: true, share: true, report: EV.compactReport(r) };
        if (photo && photo.measures) body.metrics = photo.measures.raw; // números generales de la foto, para calibrar (no la imagen ni las ubicaciones)
        api('saveReport', body, 20000).then(function (res) {
          setBusy(btn, false, 'Enviar resumen');
          if (res && res.ok) { status(st, 'Listo: la profesional lo va a poder leer antes de tu sesión.', 'ok'); btn.disabled = true; cb.disabled = true; Track.send('analisis_resumen_enviado', { dedupeKey: 'analisis_resumen:' + PAGE_LOADED_AT }); return; }
          if (res && res.code === 'invalid_token') { status(st, 'Tu sesión venció. Volvé a empezar para enviarlo.', 'error'); return; }
          status(st, 'No pudimos enviarlo. Probá de nuevo en un momento.', 'error');
        });
      });
      box.appendChild(btn); box.appendChild(st);
      return box;
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
