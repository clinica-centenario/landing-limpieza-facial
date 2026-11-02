"""
Prueba de punta a punta en celular (390x844) con Chromium headless.
Usa el camino de PRODUCCIÓN del front (API_URL y META_PIXEL_ID configurados), interceptando:
  - la API de Apps Script (respuestas controladas por el test),
  - el script de Meta (stub que registra cada llamada a fbq).
Uso: python3 -I tests/e2e_mobile.py <carpeta public> <carpeta de salida para capturas>
"""
import json, sys, threading, http.server, functools, os
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

PUBLIC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
API = "https://api.example.test/exec"
UY = timezone(timedelta(hours=-3))

def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Q, directory=PUBLIC)
    
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


calls = []
state = {"lead_fail_once": True, "book_conflict_once": True}

def recommend(exclude=None, count=3):
    """Igual que el servidor: los horarios libres más próximos, sin superponerse (lun a vie 9–21, 10:00 y 10:30 ocupados)."""
    out, now = [], datetime.now(UY)
    d = now.date()
    while len(out) < count:
        if d.weekday() < 5:
            for t in range(9 * 60, 20 * 60 + 1, 30):
                st = datetime(d.year, d.month, d.day, t // 60, t % 60, tzinfo=UY)
                iso = st.astimezone(timezone.utc).isoformat().replace("+00:00", ".000Z")
                if st <= now or t in (600, 630) or iso == exclude: continue
                if out and st < out[-1]["_end"]: continue
                out.append({"start": iso, "date": d.isoformat(), "time": f"{t//60:02d}:{t%60:02d}", "soon": st <= now + timedelta(hours=24), "_end": st + timedelta(hours=1)})
                if len(out) == count: break
        d += timedelta(days=1)
    return [{k: v for k, v in s.items() if k != "_end"} for s in out]

def api_handler(route, request):
    body = json.loads(request.post_data or "{}")
    calls.append(body)
    a = body.get("action")
    if a == "lead":
        if state["lead_fail_once"]:
            state["lead_fail_once"] = False
            return route.abort("failed")  # fallo de red: el front debe conservar los datos
        res = {"ok": True, "requestId": "CC-261015-ABC123", "token": "t" * 40, "leadEventId": "lead_CC-261015-ABC123"}
    elif a == "availability":
        res = {"ok": True, "timezone": "America/Montevideo", "slots": recommend(), "withinHours": 24, "durationMin": 60, "whatsapp": "59899123456"}
    elif a == "track":
        res = {"ok": True}
    elif a == "book":
        if state["book_conflict_once"]:
            state["book_conflict_once"] = False
            alts = recommend(exclude=body["start"])
            res = {"ok": False, "code": "slot_unavailable", "alternatives": alts}
        else:
            st = datetime.fromisoformat(body["start"].replace("Z", "+00:00"))
            loc = st.astimezone(UY)
            res = {"ok": True, "bookingId": "RAB12CD34EF", "scheduleEventId": "schedule_RAB12CD34EF", "date": loc.date().isoformat(),
                   "time": loc.strftime("%H:%M"), "startIso": body["start"], "endIso": (st + timedelta(hours=1)).isoformat().replace("+00:00", ".000Z"),
                   "durationMin": 60, "professional": "Lic. Jaqueline Mansilla", "address": "Av. Centenario 3090A, Montevideo", "timezone": "America/Montevideo"}
    else:
        res = {"ok": False, "code": "invalid_request"}
    import time; time.sleep(0.4)
    route.fulfill(status=200, content_type="application/json", body=json.dumps(res))

FBQ_STUB = "window.__fbqCalls=window.__fbqCalls||[];(function(){var q=(window.fbq&&window.fbq.queue)||[];q.forEach(function(a){window.__fbqCalls.push(Array.prototype.slice.call(a))});window.fbq=function(){window.__fbqCalls.push(Array.prototype.slice.call(arguments))};window.fbq.loaded=true})();"

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))

def fbq(page):
    return page.evaluate("(window.__fbqCalls||[]).filter(c=>c[0]==='track'||c[0]==='trackCustom').map(c=>({name:c[1],params:c[2],extra:c[3]||null}))")

def names(page): return [c["name"] for c in fbq(page)]

srv = serve()
base = f"http://127.0.0.1:{srv.server_address[1]}"
with sync_playwright() as p:
    # CHROME_PATH apunta a un Chromium propio; si no, se usa el Google Chrome instalado.
    br = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {"channel": "chrome"}))
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="es-UY", timezone_id="Europe/Madrid")
    # Zona horaria del navegador distinta a propósito: la agenda tiene que mostrar hora de Montevideo igual.
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript",
        body=open(os.path.join(PUBLIC, "config.js")).read().replace("API_URL: ''", f"API_URL: '{API}'").replace("META_PIXEL_ID: ''", "META_PIXEL_ID: '000000000000000'")))
    ctx.route(API, api_handler)
    ctx.route("**/fbevents.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=FBQ_STUB))
    ctx.route(lambda u: ("fonts.g" in u) or ("clinicacentenario.com.uy" in u), lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(base + "/index.html?utm_source=instagram&utm_campaign=limpieza")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/01-hero-mobile.png")
    check("sin scroll horizontal", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    check("banner de consentimiento visible", page.is_visible("#consent"))
    check("sin consentimiento no hay eventos", names(page) == [], names(page))
    page.click("[data-consent=yes]")
    page.wait_for_timeout(200)
    check("PageView tras aceptar", names(page) == ["PageView"], names(page))

    # CTA no dispara Lead ni formulario_abierto
    page.click(".hero .btn-lg")
    page.wait_for_timeout(700)
    check("CTA no dispara Lead/formulario_abierto", names(page) == ["PageView"], names(page))
    page.screenshot(path=f"{OUT}/02-form-mobile.png")

    page.focus("#f-firstName")
    check("formulario_abierto al interactuar", names(page).count("formulario_abierto") == 1, names(page))

    # Envío inválido
    page.click("#leadBtn")
    check("inválido: no llama a la API", not any(c.get("action") == "lead" for c in calls))
    check("inválido: muestra errores", all(page.is_visible(f"#e-{f}") for f in ["firstName", "lastName", "phone", "consent"]))
    page.screenshot(path=f"{OUT}/03-form-errores.png")

    page.fill("#f-firstName", "Ana")
    page.fill("#f-lastName", "Pérez")
    page.fill("#f-phone", "099 123 456")
    page.fill("#f-email", "ana@example.com")
    page.check("#f-consent")
    page.wait_for_timeout(300)
    # Doble clic + primer intento con fallo de red
    page.dblclick("#leadBtn")
    page.wait_for_selector(".form-status.is-error")
    lead_calls = [c for c in calls if c.get("action") == "lead"]
    check("doble clic: un solo envío en vuelo", len(lead_calls) == 1, len(lead_calls))
    check("fallo de red: sin Lead", "Lead" not in names(page), names(page))
    check("fallo de red: datos conservados", page.input_value("#f-email") == "ana@example.com")
    page.screenshot(path=f"{OUT}/04-error-red.png")
    page.click("#leadBtn")
    page.wait_for_selector("[data-panel='2']:not([hidden])")
    page.wait_for_selector(".rec")
    lead_calls = [c for c in calls if c.get("action") == "lead"]
    check("nombre y apellido por separado", lead_calls[-1].get("firstName") == "Ana" and lead_calls[-1].get("lastName") == "Pérez")
    check("reintento usa la misma clave de envío", lead_calls[0]["submitKey"] == lead_calls[1]["submitKey"])
    check("UTM enviados", lead_calls[-1]["utm"].get("utm_source") == "instagram")
    lead_ev = [c for c in fbq(page) if c["name"] == "Lead"]
    check("Lead una vez, con eventID del servidor", len(lead_ev) == 1 and lead_ev[0]["extra"] == {"eventID": "lead_CC-261015-ABC123"}, lead_ev)
    check("agenda solo después de guardar", calls.index(lead_calls[-1]) < [i for i, c in enumerate(calls) if c.get("action") == "availability"][0])
    check("vio_horarios una vez", names(page).count("vio_horarios") == 1)

    # Tres horarios recomendados, en hora de Montevideo aunque el navegador esté en Madrid
    expected = recommend()
    shown = page.eval_on_selector_all(".rec .rt", "els => els.map(e => e.textContent)")
    check("muestra 3 horarios recomendados", len(shown) == 3, shown)
    check("horarios en hora UY con navegador en Madrid", all(sh.startswith(ex["time"]) for sh, ex in zip(shown, expected)), (shown, [e["time"] for e in expected]))
    check("marca los de las próximas 24 h", page.locator(".rec .rb").count() == sum(1 for e in expected if e["soon"]))
    wa = page.get_attribute("#waLink", "href") or ""
    check("WhatsApp si ninguno sirve", page.is_visible("#waHelp") and wa.startswith("https://wa.me/59899123456?text=") and "CC-261015-ABC123" in wa, wa)
    check("agenda sin scroll horizontal", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    page.locator("#booking").scroll_into_view_if_needed()
    page.screenshot(path=f"{OUT}/05-agenda-mobile.png")

    page.click(".rec >> nth=1")
    pick = expected[1]
    check("eligio_horario al elegir", names(page).count("eligio_horario") == 1)
    end = (datetime.strptime(pick["time"], "%H:%M") + timedelta(hours=1)).strftime("%H:%M")
    check("fin calculado en hora UY", f"{pick['time']} a {end}" in page.inner_text("#confirmWhen"), page.inner_text("#confirmWhen"))
    check("elegir no dispara Schedule", "Schedule" not in names(page))
    page.screenshot(path=f"{OUT}/06-confirmar.png")

    page.dblclick("#bookBtn")
    page.wait_for_function("document.querySelector('#slotState').textContent.includes('ocupar')")
    check("conflicto: nuevas recomendaciones sin el horario perdido", pick["start"] not in page.eval_on_selector_all(".rec", "e => e.map(x => x.dataset.start)"))
    book_calls = [c for c in calls if c.get("action") == "book"]
    check("confirmar doble clic: una sola solicitud", len(book_calls) == 1, len(book_calls))
    check("conflicto: sin Schedule", "Schedule" not in names(page))
    page.screenshot(path=f"{OUT}/07-conflicto-alternativas.png")

    page.click(".rec >> nth=0")
    page.click("#bookBtn")
    page.wait_for_selector("[data-panel='3']:not([hidden])")
    sched = [c for c in fbq(page) if c["name"] == "Schedule"]
    check("Schedule una vez tras confirmación del servidor", len(sched) == 1 and sched[0]["extra"] == {"eventID": "schedule_RAB12CD34EF"}, sched)
    summary = page.inner_text("#summary")
    check("confirmación con fecha, hora, profesional, duración y dirección",
          all(x in summary for x in ["Jaqueline Mansilla", "60 minutos", "Av. Centenario 3090A", "hora de Montevideo"]), summary)
    check("idempotencyKey enviada", all(len(c.get("idempotencyKey", "")) >= 16 for c in calls if c.get("action") == "book"))
    page.screenshot(path=f"{OUT}/08-confirmada.png", full_page=False)

    # Sin PII en el píxel
    blob = json.dumps(page.evaluate("window.__fbqCalls"))
    check("píxel sin PII", not any(x in blob for x in ["Ana", "ana@example.com", "99123456", "099"]), blob[:200])

    # Recarga: no duplica Schedule ni Lead
    page.reload(); page.wait_for_timeout(600)
    check("recarga: restaura confirmación", page.is_visible("[data-panel='3']"))
    after = names(page)
    check("recarga: no repite Lead/Schedule", "Lead" not in after and "Schedule" not in after, after)

    page.goto(base + "/index.html"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/09-full-mobile.png", full_page=True)
    check("sin errores JS", not errors, errors)

    # Desktop
    d = br.new_context(viewport={"width": 1366, "height": 860})
    d.route(lambda u: ("fonts.g" in u) or ("clinicacentenario.com.uy" in u), lambda r: r.abort())
    dp = d.new_page(); dp.goto(base + "/index.html"); dp.wait_for_timeout(300)
    dp.screenshot(path=f"{OUT}/10-desktop.png")
    dp.screenshot(path=f"{OUT}/11-desktop-full.png", full_page=True)
    br.close()

ok = sum(1 for r in results if r[1])
for n, passed, det in results:
    print(("PASS " if passed else "FAIL ") + n + ("" if passed else f"  → {det}"))
print(f"\n{ok}/{len(results)} verificaciones OK")
sys.exit(0 if ok == len(results) else 1)
