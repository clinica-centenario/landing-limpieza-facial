"""
Prueba del recorrido "Orientación para tu piel" en un celular (390 px), en modo demo y sin tocar la API real.
Controles de foto con variantes generadas desde UNA selfie de prueba (no se guardan fotos en el repo):
vacía, dos rostros, oscura, borrosa, inclinada, lejos y la selfie original.
Uso: python3 -I tests/e2e_orientacion.py public <carpeta de salida> <selfie.jpg>
Requiere: pip install playwright pillow  (usa Google Chrome instalado)
Para la validación con personas reales: repetir con selfies de distintos tonos de piel, teléfonos y luces,
y anotar qué controles fallan para calibrar PHOTO_RULES en public/app.js.
"""
import tempfile
from PIL import Image, ImageFilter, ImageEnhance
import sys, re, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
PUBLIC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FACES = tempfile.mkdtemp()
_s = Image.open(sys.argv[3]).convert('RGB')
_s.save(os.path.join(FACES, 'selfie.jpg'))
ImageEnhance.Brightness(_s).enhance(0.12).save(os.path.join(FACES, 'oscura.jpg'))
_s.filter(ImageFilter.GaussianBlur(8)).save(os.path.join(FACES, 'borrosa.jpg'))
_two = Image.new('RGB', (_s.width * 2, _s.height)); _two.paste(_s, (0, 0)); _two.paste(_s, (_s.width, 0)); _two.save(os.path.join(FACES, 'dos.jpg'))
_s.rotate(25, fillcolor=(120, 60, 50)).save(os.path.join(FACES, 'inclinada.jpg'))
_far = Image.new('RGB', (_s.width * 4, _s.height * 4), (225, 225, 225)); _far.paste(_s.resize((_s.width // 2, _s.height // 2)), (0, 0)); _far.save(os.path.join(FACES, 'lejos.jpg'))
Image.new('RGB', (800, 800), (200, 190, 180)).save(os.path.join(FACES, 'vacia.jpg'))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=PUBLIC))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://localhost:{srv.server_address[1]}/"
cfgjs = re.sub(r"API_URL: '[^']*'", "API_URL: ''", open(os.path.join(PUBLIC, "config.js")).read())
errors, calls = [], []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 390, "height": 844}, locale="es-UY")
    pg.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=cfgjs))
    pg.route("https://script.google.com/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(base + "?demo=1")
    pg.locator("#analisis").scroll_into_view_if_needed()
    pg.click("#aiStart"); print("sin 18+:", pg.inner_text("#aiIntroStatus"))
    pg.check("#aiAdult"); pg.click("#aiStart")
    print("pantalla datos:", pg.is_visible("#aiLead"))
    pg.fill("#a-firstName", "Bea"); pg.fill("#a-lastName", "Gómez"); pg.fill("#a-phone", "098111222"); pg.fill("#a-email", "bea@example.com"); pg.check("#a-consent")
    pg.wait_for_timeout(2600); pg.click("#aiLeadBtn"); pg.wait_for_selector("#aiQ legend")
    pg.locator(".ai-tool").screenshot(path=OUT + "/s1-pregunta.png")
    pg.click("#aiQNext"); print("sin respuesta:", pg.inner_text("#aiQStatus"))
    picks = ["Con brillo solo en frente", "A veces", "No", "A veces", None, "Piel más suave", "Sí", "No", "No"]
    for i, t in enumerate(picks):
        if i == 4:
            pg.click(".ai-opt:has-text('Puntos negros')"); pg.click(".ai-opt:has-text('Poros marcados')"); pg.click(".ai-opt:has-text('Nada en especial')")
            print("'Nada' excluye otras:", pg.eval_on_selector_all("#aiQ input:checked", "e=>e.map(x=>x.value)"))
            pg.click(".ai-opt:has-text('Puntos negros')")
        else:
            pg.click(f"#aiQ .ai-opt:has-text('{t}') >> nth=0")
        if i == 6:
            print("condicional visible:", pg.is_visible(".ai-follow")); pg.click("#aiQNext"); print("falta condicional:", pg.inner_text("#aiQStatus"))
            pg.click(".ai-follow .ai-opt:has-text('Retinoides')")
            pg.locator(".ai-tool").screenshot(path=OUT + "/s2-condicional.png")
        pg.click("#aiQNext")
    pg.wait_for_selector("[data-ai='foto']:not([hidden])")
    print("pantalla foto:", pg.is_visible("#aiSkip"))
    for name in ["vacia", "dos", "oscura", "borrosa", "inclinada", "lejos", "selfie"]:
        pg.set_input_files("#aiFile", os.path.join(FACES, name + ".jpg"))
        pg.wait_for_function("document.querySelector('#aiChecks').textContent && !document.querySelector('#aiChecks').textContent.includes('Revisando')", timeout=60000)
        print(f"{name}:", pg.eval_on_selector_all("#aiChecks li", "e=>e.map(x=>x.className.replace('is-','')+':'+x.textContent).join(' | ')"), "| enviar:", pg.is_visible("#aiSend"))
    pg.locator(".ai-tool").screenshot(path=OUT + "/s3-foto-ok.png")
    pg.click("#aiSend"); print("sin consentimiento foto:", pg.inner_text("#aiStatus"))
    pg.check("#aiPhotoConsent"); pg.click("#aiSend"); pg.wait_for_selector("#aiResult:not([hidden])", timeout=20000)
    print("resultado:", pg.inner_text("#aiResult")[:900].replace("\n", " / "))
    pg.locator(".ai-tool").screenshot(path=OUT + "/s4-resultado.png")
    pg.click("#aiResult a.btn"); pg.wait_for_selector(".rec", timeout=15000)
    print("reserva sin pedir datos:", not pg.is_visible("#leadForm"))
    print("scroll horizontal:", pg.evaluate("document.documentElement.scrollWidth > innerWidth"))
    b.close()
print("errores:", errors)
