"""Genera una vista previa autocontenida (un solo HTML, modo demo, recursos embebidos).
Uso: python3 -I tools/build_preview.py <carpeta public> <video liviano para el principal> <salida.html>"""
import base64, mimetypes, os, re, sys
PUB, MAINVID, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
rd = lambda f: open(os.path.join(PUB, f), encoding='utf-8').read()
html = rd('index.html')
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + rd('styles.css') + '\n</style>')
html = re.sub(r'  <script>\n    /\* Modo demo:.*?</script>\n', '', html, flags=re.S)
html = re.sub(r'<link rel="preload" as="image"[^>]*>\n?', '', html)
inline = ('<script>\n' + rd('config.js') + '\nwindow.CC_PREVIEW_DEMO = true;\n</script>\n<script>\n' + rd('photos.js') +
          '\n</script>\n<script>\n' + rd('demo-api.js') + '\nwindow.__ccDemoReady = Promise.resolve();\n</script>\n<script>\n' + rd('app.js') + '\n</script>\n')
html = html.replace('  <script src="config.js"></script>\n  <script src="photos.js"></script>\n  <script src="app.js" defer></script>\n', inline)
# Video principal: una sola fuente liviana
html = re.sub(r'<source src="media/sesion-completa-540\.mp4"[^>]*>\s*<source src="media/sesion-completa-720\.mp4" type="video/mp4">',
              '<source src="media/__preview_main.mp4" type="video/mp4">', html)
cache = {}
def data_uri(path):
    if path not in cache:
        real = MAINVID if path == 'media/__preview_main.mp4' else os.path.join(PUB, path)
        typ = mimetypes.guess_type(real)[0] or ('image/avif' if real.endswith('.avif') else 'image/webp' if real.endswith('.webp') else 'application/octet-stream')
        cache[path] = 'data:%s;base64,%s' % (typ, base64.b64encode(open(real, 'rb').read()).decode())
    return cache[path]
# Solo se embeben los recursos realmente usados; para srcset se deja una sola variante (la mediana) para no inflar el archivo.
html = re.sub(r'(img/hero)-(?:480|1080)\.(avif|webp|jpg) \d+w, ?', '', html)
html = re.sub(r', ?img/hero-(?:480|1080)\.(?:avif|webp|jpg) \d+w', '', html)
html = re.sub(r'\b((?:img|media)/[\w.\-]+\.(?:png|jpg|webp|avif|mp4))', lambda m: data_uri(m.group(1)), html)
html = html.replace('MODO DEMO · datos ficticios · no se guarda nada ni se crean reservas', 'VISTA PREVIA · horarios ficticios · no se guarda nada ni se crean reservas')
assert 'src="app.js"' not in html and 'href="styles.css"' not in html
open(OUT, 'w', encoding='utf-8').write(html)
print('%s: %.1f MB' % (OUT, len(html) / 1e6))
