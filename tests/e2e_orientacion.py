"""
Prueba de la evaluación cosmética en un celular (390 px), en modo demo y sin tocar la API real.
Simula la cámara con un video generado desde UNA selfie de prueba (no se guardan fotos en el repo).

Casos: cámara guiada y revisión de la foto · preguntas obligatorias sin respuestas marcadas · informe con
secciones A-F · marcas: activar/desactivar, selección sincronizada con la tarjeta, alineadas al cambiar tamaño
y orientación · envío opcional con consentimiento aparte (y su falla) · permiso de cámara denegado ·
modelo de IA que no carga · foto oscura, sobreexpuesta, borrosa, sin rostro y con dos rostros · sin foto ·
respuestas que piden consulta médica.

Uso: python3 -I tests/e2e_orientacion.py public <carpeta de salida> <selfie.jpg>
Requiere: pip install playwright pillow, ffmpeg y Google Chrome instalados.
Para la validación con personas reales: probar con ?diagnostico=1 en teléfonos (distintos tonos de piel,
modelos y luces) y calibrar PHOTO_RULES (app.js) y SKIN_RULES (evaluation.js).
"""
import subprocess, tempfile, sys, re, os, threading, http.server, functools, time
from PIL import Image, ImageFilter, ImageEnhance
from playwright.sync_api import sync_playwright

PUBLIC, OUT, SELFIE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()
face = Image.open(SELFIE).convert('RGB')
face = face.resize((560, int(face.height * 560 / face.width)), Image.LANCZOS)

def framed(im, w=720, h=960):
    c = Image.new('RGB', (w, h), (150, 120, 110)); c.paste(im, ((w - im.width) // 2, max(0, (h - im.height) // 2 - 60))); return c

framed(face.resize((760, int(face.height * 760 / face.width)), Image.LANCZOS)).save(os.path.join(TMP, 'f.png'))
Y4M = os.path.join(TMP, 'cam.y4m')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-t', '6', '-i', os.path.join(TMP, 'f.png'),
                '-vf', 'fps=10,format=yuv420p', Y4M], check=True)
# Fotos para subir (casos de rechazo)
up = {}
def save(name, im): p = os.path.join(TMP, name + '.jpg'); im.save(p, quality=92); up[name] = p
big = framed(face, 900, 1200)
save('buena', big)
from PIL import ImageDraw
def marked():
    f = face.copy(); W, H = f.size; d = ImageDraw.Draw(f, 'RGBA')
    for y in range(int(H * .12), int(H * .62), 7):
        for x in range(int(W * .40), int(W * .60), 7): d.ellipse((x, y, x + 4, y + 4), fill=(255, 255, 255, 255))
    for cx in (.30, .70): d.ellipse((W * (cx - .11), H * .52, W * (cx + .11), H * .72), fill=(230, 40, 40, 70))
    return framed(f, 900, 1200)
save('marcada', marked())
save('oscura', ImageEnhance.Brightness(big).enhance(0.12))
save('quemada', ImageEnhance.Brightness(big).enhance(3.2))
save('borrosa', big.filter(ImageFilter.GaussianBlur(9)))
save('sinrostro', Image.new('RGB', (900, 1200), (180, 170, 160)))
two = Image.new('RGB', (1400, 1000), (150, 120, 110)); small = face.resize((560, int(face.height)), Image.LANCZOS)
two.paste(small, (60, 150)); two.paste(small, (780, 150)); save('dos', two)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=PUBLIC)); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{srv.server_address[1]}/"
cfgjs = re.sub(r"API_URL: '[^']*'", "API_URL: ''", open(os.path.join(PUBLIC, "config.js")).read())
errors, fails = [], []

def check(cond, msg):
    print(('  ok  ' if cond else '  FALLA ') + msg)
    if not cond: fails.append(msg)

ANS = {  # pantalla → opciones a marcar (texto)
    'Sobre la foto': ['Nada, la cara lavada'],
    'Brillo': ['En frente, nariz y mentón', 'A pocas horas de lavarme la cara'],
    'Después de lavarte la cara': ['A veces', 'No'],
    'Productos': ['A veces'],
    'Tu rutina': ['Limpiador facial', 'Protector solar'],
    'Tu objetivo': ['Despejar puntitos oscuros o poros'],
    'Últimas semanas': ['Nada de esto'],
}

def answer_quiz(pg, safety='no', medical=False):
    for _ in range(12):
        if not pg.is_visible('#aiQ'): break
        step = pg.text_content('#aiQStep'); title = step.split('·')[-1].strip()
        if title == 'Para tu seguridad':
            for i, fs in enumerate(pg.query_selector_all('#aiQ fieldset')):
                k = fs.get_attribute('data-k')
                val = 'si' if medical and k in ('sangrado', 'cambio') else safety
                fs.query_selector(f'input[value="{val}"]').check()
        elif title == 'Sobre la foto':
            pg.click('#aiQ fieldset[data-k="en_cara"] .ai-opt:has-text("Nada, la cara lavada")')
            if pg.is_visible('#aiQ fieldset[data-k="filtro"]'): pg.click('#aiQ fieldset[data-k="filtro"] .ai-opt:has-text("No")')
        elif title == 'Brillo':
            pg.click('#aiQ .ai-opt:has-text("En frente, nariz y mentón")'); pg.wait_for_timeout(100)
            pg.click('#aiQ .ai-opt:has-text("A pocas horas de lavarme la cara")')
        elif title == 'Después de lavarte la cara':
            pg.click('#aiQ fieldset[data-k="tirantez"] .ai-opt:has-text("A veces")'); pg.click('#aiQ fieldset[data-k="descamacion"] .ai-opt:has-text("No")')
        else:
            for t in ANS.get(title, []): pg.click(f'#aiQ .ai-opt:has-text("{t}")')
        last = 'Ver mi resultado' in pg.inner_text('#aiQNext')
        pg.click('#aiQNext'); pg.wait_for_timeout(150)
        if last: break

def lead(pg):
    if pg.is_visible('#aiLead'):
        pg.fill("#a-firstName", "Bea"); pg.fill("#a-lastName", "Gómez"); pg.fill("#a-phone", "098111222"); pg.fill("#a-email", "bea@example.com"); pg.check("#a-consent")
        pg.wait_for_timeout(2600); pg.click("#aiLeadBtn")
    pg.wait_for_selector("#aiResult:not([hidden])", timeout=15000)

def badge_rel(pg):
    """Posición de cada número relativa a la foto (0..1): debe mantenerse al cambiar el tamaño."""
    return pg.evaluate("""() => { const s = document.querySelector('.ai-photo-svg'); if (!s) return null; const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('.ai-badge circle')].map(c => { const b = c.getBoundingClientRect();
        return [+((b.x + b.width / 2 - r.x) / r.width).toFixed(3), +((b.y + b.height / 2 - r.y) / r.height).toFixed(3)]; }); }""")

def marks_checks(pg, n_badges, shot):
    if True:
        pg.click('.ai-badge >> nth=0'); pg.wait_for_timeout(300)
        check(pg.get_attribute('.ai-card >> nth=0', 'class').find('is-sel') >= 0 and pg.is_visible('.ai-card-body >> nth=0'), 'tocar la marca abre su tarjeta')
        check(pg.inner_text('.ai-mark-detail').startswith('1.'), 'detalle de la marca: ' + pg.inner_text('.ai-mark-detail')[:90])
        pg.locator('.ai-photo').screenshot(path=OUT + shot)
        pg.click('.ai-card-head >> nth=0'); check('is-sel' not in pg.get_attribute('.ai-badge >> nth=0', 'class'), 'tocar la tarjeta abierta deselecciona la marca')
        pg.click('.ai-toggle'); check(pg.evaluate("getComputedStyle(document.querySelector('.ai-photo-svg .ai-marks')).display") == 'none', 'se pueden ocultar las marcas')
        pg.click('.ai-toggle')
        before = badge_rel(pg); pg.set_viewport_size({"width": 844, "height": 390}); pg.wait_for_timeout(400); after = badge_rel(pg)
        check(before == after, f'marcas alineadas al girar la pantalla {before} → {after}')
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={Y4M}"])
    def page(perms=("camera",), url="?demo=1&wa=59899123456", block_model=False):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, permissions=list(perms), device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.route("**/config.js*", lambda r: r.fulfill(status=200, content_type="text/javascript", body=cfgjs))
        pg.route("https://script.google.com/**", lambda r: r.abort())
        if block_model: pg.route("https://cdn.jsdelivr.net/**", lambda r: r.abort())
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE + url); pg.click("#aiHeroLink"); pg.wait_for_timeout(500); pg.check("#aiAdult")
        return pg

    print("1. Cámara guiada → revisión → preguntas → informe")
    pg = page(url="?demo=1&wa=59899123456&diagnostico=1")
    pg.click("#aiStart"); t0 = time.time(); msgs = []
    while time.time() - t0 < 45 and not pg.is_visible('[data-ai="revision"]'):
        m = pg.inner_text("#aiCamMsg")
        if not msgs or msgs[-1] != m: msgs.append(m)
        pg.wait_for_timeout(250)
    print("   mensajes de la cámara:", ' → '.join(msgs[:8]))
    check(pg.is_visible('[data-ai="revision"]'), 'captura automática y pantalla de revisión')
    pg.wait_for_selector('#aiReviewImg:not([hidden])', timeout=5000)
    print("   controles:", pg.eval_on_selector_all('#aiReviewChecks li', 'e=>e.map(x=>x.className+": "+x.textContent)'))
    print("   diag:", pg.inner_text('#aiDiag').replace('\n', '')[:700])
    check(pg.is_visible('#aiUse') and pg.is_visible('#aiRetry'), 'permite usar o repetir la foto')
    check('is-mirror' in (pg.get_attribute('#aiReviewImg', 'class') or ''), 'la vista previa de la cámara se ve en espejo, como la vio la persona')
    pg.locator('.ai-tool').screenshot(path=OUT + '/1-revision.png')
    pg.click('#aiUse')
    check(pg.text_content('#aiQStep').startswith('Paso 1 de 8'), 'con foto de cámara: 8 pasos (sin la pregunta del filtro) — ' + pg.text_content('#aiQStep'))
    check(pg.eval_on_selector_all('#aiQ input:checked', 'e=>e.length') == 0, 'ninguna respuesta viene marcada')
    pg.click('#aiQNext'); check('Falta' in pg.inner_text('#aiQStatus'), 'no avanza con preguntas sin responder: ' + pg.inner_text('#aiQStatus'))
    answer_quiz(pg)
    check(pg.is_visible('#aiLead'), 'pide los datos de contacto antes del resultado')
    lead(pg)
    txt = pg.inner_text('#aiResult')
    for h in ['Tu evaluación cosmética', 'Lo que se observa en tu foto', 'Lo que nos contaste', 'Qué podemos valorar en tu limpieza facial', 'Próximo paso']:
        check(h in txt, 'sección: ' + h)
    check('Antes de tu sesión' not in txt, 'sin revisión previa cuando todas las respuestas de seguridad son "No"')
    check(txt.count('No es un diagnóstico') == 1, 'una única aclaración general')
    check(not re.search(r'\(\d+\)|%|[Aa]nálisis en prueba|[Pp]osibles? ', txt), 'sin conteos, porcentajes, "posible" ni "análisis en prueba"')
    check('Reservar evaluación y limpieza facial' in txt, 'botón de reserva con el texto del servicio')
    print("   resumen:", pg.inner_text('.ai-summary'))
    n_badges = pg.eval_on_selector_all('.ai-badge', 'e=>e.length'); n_cards = pg.eval_on_selector_all('.ai-card', 'e=>e.length')
    print(f"   marcas: {n_badges} · tarjetas: {n_cards} · no evaluables: {pg.inner_text('.ai-na summary') if pg.is_visible('.ai-na') else '-'}")
    check(n_badges == n_cards, 'una marca numerada por cada tarjeta')
    pg.locator('#aiResult').screenshot(path=OUT + '/2-informe.png')
    check(not pg.evaluate("document.documentElement.scrollWidth > innerWidth"), 'sin scroll horizontal')
    pg.click('.ai-share button'); check('Marcá la casilla' in pg.inner_text('.ai-share .form-status'), 'no envía el resumen sin el consentimiento aparte')
    pg.check('#aiShareOk'); pg.click('.ai-share button'); pg.wait_for_timeout(900)
    check('Listo' in pg.inner_text('.ai-share .form-status'), 'envía el resumen con consentimiento')
    wa = pg.get_attribute('#aiResult a.btn-wa', 'href') or ''
    check('Mi%20solicitud' in wa and 'data%3Aimage' not in wa, 'WhatsApp con el resumen en texto')
    pg.click('#aiResult .link-btn'); check(pg.is_visible('[data-ai="intro"]'), 'volver a empezar')
    pg.context.close()

    print("2. Permiso de cámara denegado")
    pg = page(perms=())
    pg.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); }")
    pg.click('#aiStart'); pg.wait_for_timeout(600)
    st = pg.inner_text('#aiCamStatus'); print('   ', st)
    check('permiso' in st and pg.is_visible('#aiCamSkip') and pg.is_visible('#aiCamUpload') and pg.is_visible('#aiCamRetry'), 'explica el problema y ofrece reintentar, subir foto o seguir sin foto')
    check(pg.is_visible('#reservar'), 'la landing sigue funcionando')
    pg.context.close()

    print("3. El modelo de IA no carga")
    pg = page(block_model=True)
    pg.click('#aiStart'); pg.wait_for_selector('#aiCamRetry:not([hidden])', timeout=35000)
    check('No pudimos cargar el análisis' in pg.inner_text('#aiCamStatus'), pg.inner_text('#aiCamStatus'))
    pg.click('#aiCamSkip'); check(pg.is_visible('#aiQ'), 'puede seguir sin foto')
    check(not pg.is_visible('#aiQ fieldset[data-k="en_cara"]'), 'sin foto no pregunta por la foto')
    answer_quiz(pg, medical=True); lead(pg)
    txt = pg.inner_text('#aiResult')
    check('No sumaste foto' in txt and 'ai-photo-svg' not in pg.inner_html('#aiResult'), 'informe sin foto y sin marcas')
    check('consultá con un médico o dermatólogo' in txt and 'Antes de tu sesión' in txt, 'lesión que sangra o cambia → consulta médica antes')
    check('no se trabaja sobre ella hasta tener la consulta médica' in txt, 'la reserva no se presenta como solución')
    pg.locator('#aiResult').screenshot(path=OUT + '/4-sin-foto-revision-medica.png')
    pg.context.close()

    print("4. Fotos subidas que no sirven, y una que sí")
    pg = page(url="?demo=1&savefail=1&diagnostico=1")
    for name, expect in [('oscura', 'oscura'), ('quemada', 'luz'), ('borrosa', 'movida'), ('sinrostro', 'No encontramos un rostro'), ('dos', 'más de una persona')]:
        with pg.expect_file_chooser() as fc: pg.click('#aiUploadStart' if pg.is_visible('#aiUploadStart') else '#aiReviewUpload')
        fc.value.set_files(up[name]); pg.wait_for_function("document.querySelector('#aiReviewChecks li') !== null", timeout=40000)
        t = pg.inner_text('#aiReviewChecks'); check(expect in t and not pg.is_visible('#aiUse'), f'{name}: {t[:90]}')
    pg.locator('.ai-tool').screenshot(path=OUT + '/5-foto-rechazada.png')
    with pg.expect_file_chooser() as fc: pg.click('#aiReviewUpload')
    fc.value.set_files(up['marcada']); pg.wait_for_selector('#aiUse:not([hidden])', timeout=40000)
    print("   diag:", pg.inner_text('#aiDiag').replace('\n', '')[:600] if pg.is_visible('#aiDiag') else '-')
    check('is-mirror' not in (pg.get_attribute('#aiReviewImg', 'class') or ''), 'una foto subida se muestra tal cual')
    pg.click('#aiUse'); check(pg.is_visible('#aiQ fieldset[data-k="filtro"]'), 'foto subida: pregunta por filtro o modo belleza')
    answer_quiz(pg); lead(pg)
    nb = pg.eval_on_selector_all('.ai-badge', 'e=>e.length'); print('   resumen:', pg.inner_text('.ai-summary'))
    check(nb > 0 and nb == pg.eval_on_selector_all('.ai-card', 'e=>e.length'), f'foto con brillo y rojez: {nb} marcas, una por tarjeta')
    pg.locator('#aiResult').screenshot(path=OUT + '/6-informe-con-marcas.png')
    if nb: marks_checks(pg, nb, '/7-marca-seleccionada.png')
    pg.check('#aiShareOk'); pg.click('.ai-share button'); pg.wait_for_timeout(900)
    check('No pudimos enviarlo' in pg.inner_text('.ai-share .form-status') and pg.is_enabled('.ai-share button'), 'si falla el envío lo informa y permite reintentar')
    pg.context.close()
    b.close()
print("errores de la página:", errors)
print("RESULTADO:", "todo OK" if not fails and not errors else f"{len(fails)} fallas")
sys.exit(1 if fails or errors else 0)
