"""
Prueba de "Evaluá tu cara con IA" en un celular (390 px), en modo demo y sin tocar la API real.
Simula la cámara con un video generado desde UNA selfie de prueba (no se guardan fotos en el repo):
de frente, y dos variantes con una mitad comprimida que simulan el giro hacia cada costado.
Recorre: botón de portada, cámara guiada con captura automática de 3 fotos, 4 preguntas, datos,
resultado con zonas medidas y botón de WhatsApp.
Uso: python3 -I tests/e2e_orientacion.py public <carpeta de salida> <selfie.jpg>
Requiere: pip install playwright pillow, ffmpeg y Google Chrome instalados.
Para la validación con personas reales: probar con ?diagnostico=1 en teléfonos (distintos tonos de piel,
modelos y luces) y calibrar PHOTO_RULES, CAM_RULES y SKIN_RULES en public/app.js.
"""
import subprocess, tempfile
from PIL import Image
import sys, re, os, threading, http.server, functools, time
from playwright.sync_api import sync_playwright
PUBLIC, OUT, SELFIE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
_tmp = tempfile.mkdtemp()
_s = Image.open(SELFIE).convert('RGB')
_s = _s.resize((720, int(_s.height * 720 / _s.width)))
def _framed(im):
    c = Image.new('RGB', (720, max(960, im.height + 80)), (150, 120, 110)); c.paste(im, ((720 - im.width) // 2, 40)); return c.resize((720, 960))
_w, _h = _s.size; _L = _s.crop((0, 0, _w // 2, _h)); _R = _s.crop((_w // 2, 0, _w, _h)); _k = int(_w // 2 * 0.45)
_a = Image.new('RGB', (_k + _w // 2, _h)); _a.paste(_L.resize((_k, _h)), (0, 0)); _a.paste(_R, (_k, 0))
_b = Image.new('RGB', (_w // 2 + _k, _h)); _b.paste(_L, (0, 0)); _b.paste(_R.resize((_k, _h)), (_w // 2, 0))
for _n, _im in [('f', _s), ('a', _a), ('b', _b)]: _framed(_im).save(os.path.join(_tmp, _n + '.png'))
Y4M = os.path.join(_tmp, 'cam.y4m')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + sum([['-loop', '1', '-t', '3', '-i', os.path.join(_tmp, n + '.png')] for n in 'fab'], []) +
               ['-filter_complex', '[0][1][2]concat=n=3:v=1:a=0,fps=10,format=yuv420p', Y4M], check=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=PUBLIC)); threading.Thread(target=srv.serve_forever, daemon=True).start()
cfgjs = re.sub(r"API_URL: '[^']*'", "API_URL: ''", open(os.path.join(PUBLIC, "config.js")).read())
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={Y4M}"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, permissions=["camera"])
    pg = ctx.new_page()
    pg.route("**/config.js*", lambda r: r.fulfill(status=200, content_type="text/javascript", body=cfgjs)); pg.route("https://script.google.com/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(f"http://localhost:{srv.server_address[1]}/?demo=1&diagnostico=1&wa=59899123456")
    print("botón portada:", pg.inner_text("#aiHeroLink"), "| visible:", pg.is_visible("#aiHeroLink"))
    pg.click("#aiHeroLink"); pg.wait_for_timeout(800)
    pg.check("#aiAdult"); pg.click("#aiStart")
    msgs, last = [], ""
    t0 = time.time(); shot_saved = False
    while time.time() - t0 < 40:
        m = pg.inner_text("#aiCamMsg"); st = pg.inner_text("#aiCamStep")
        if m != last: msgs.append(f"{int(time.time()-t0)}s [{st}] {m}"); last = m
        if not shot_saved and "Sacando" in m: pg.locator("#aiCam").screenshot(path=OUT + "/c1-guia.png"); shot_saved = True
        if pg.is_visible("#aiCamDone"): break
        if pg.is_visible("#aiSkipSides") and time.time() - t0 > 30: pg.click("#aiSkipSides")
        pg.wait_for_timeout(250)
    print("\n".join(msgs[:25]))
    print("fotos:", pg.eval_on_selector_all("#aiThumbs figure", "e=>e.map(x=>x.textContent)"), "| continuar:", pg.is_visible("#aiCamDone"))
    print("diag:", pg.inner_text("#aiDiag").replace("\n", "")[-420:] if pg.is_visible("#aiDiag") else "-")
    pg.locator(".ai-tool").screenshot(path=OUT + "/c2-fotos.png")
    pg.click("#aiCamDone")
    print("preguntas:", pg.inner_text("#aiQStep"))
    pg.click("#aiQ .ai-opt >> nth=1"); pg.click("#aiQNext")
    pg.click("#aiQ .ai-opt >> nth=2"); pg.click("#aiQNext")
    for i in [0, 1, 2]: pg.click(f"#aiQ .ai-opt >> nth={i}")
    print("máx 2:", pg.inner_text("#aiQStatus"), pg.eval_on_selector_all("#aiQ input:checked", "e=>e.length")); pg.click("#aiQNext")
    pg.click("#aiQ .ai-opt:has-text('Ninguna')"); pg.click("#aiQNext")
    print("pantalla datos:", pg.is_visible("#aiLead"))
    pg.fill("#a-firstName", "Bea"); pg.fill("#a-lastName", "Gómez"); pg.fill("#a-phone", "098111222"); pg.fill("#a-email", "bea@example.com"); pg.check("#a-consent")
    pg.wait_for_timeout(2600); pg.click("#aiLeadBtn"); pg.wait_for_selector("#aiResult:not([hidden])", timeout=15000)
    print("resultado:", pg.inner_text("#aiResult")[:500].replace("\n", " / "))
    print("whatsapp:", (pg.get_attribute("#aiResult a.btn-wa", "href") or "")[:160])
    pg.locator(".ai-tool").screenshot(path=OUT + "/c3-resultado.png")
    print("scroll horizontal:", pg.evaluate("document.documentElement.scrollWidth > innerWidth"))
    b.close()
print("errores:", errors)
