"""
Genera las páginas Atlas de la web (ES y EN) a partir de:
  - los textos de este fichero (cada cadena en los dos idiomas: T("es", "en")),
  - obs/observaciones.json (tu trabajo: cielo profundo, tránsitos, eclipse).

Páginas que genera (y su gemela -en / en.html):
  index.html · observaciones.html · herramientas.html · programas.html · bitacora.html
  eclipse-2026.html · una ficha por observación (cielo-*.html, transito-*.html)

Después ejecuta SIEMPRE, en este orden y desde la raíz del repo:
    python tools/build_atlas.py
    python tools/sync_nav.py        (pone cabecera, cajón y pie)
    python tools/seo_inject.py      (canonical, hreflang, Open Graph, sitemap)

Para añadir una observación: añade su entrada en obs/observaciones.json (y sus ficheros en
obs/<slug>/) y vuelve a ejecutar los tres comandos.

Interior Atlas II en TODAS las páginas que genera (migración, ver propuestas-estetica/PLAN-MIGRACION.md): marcado del
prototipo aprobado (propuestas-estetica/v2/) con clases de atlas/atlas2.css, sin style="" salvo las letras de llamada
de la lámina del techo. page(): cargan atlas2.css y NO index.css ni atlas.css.
  - F3 (12-11-2026): portada, Observaciones, Herramientas, Programas y Bitácora.
  - F4 (12-11-2026): las láminas de cada observación (build_obs_page), con el diseño de v2/transito-qatar1b.html,
    las variantes de cielo profundo y eclipse, y su relato con referencias (campo `story` de observaciones.json,
    que sale de propuestas-estetica/d4-investigacion/RELATOS.md; fidelidad: tools/check_relatos.py). Una
    observación sin `story` se pinta igual, sin hueco.
Las rejillas usan la miniatura ligera <curva>-m.webp si existe (la escribe tools/miniaturas.py); si no, el original.
La carta animada de la portada sale de tools/atlas2/carta_capricornio.py (figure_for_page) y la mueve
atlas/capricornus2.js; la lámina del techo corredizo, de tools/atlas2/d3/ (letras en llamadas.json).
"""
import html
import json
import os
import re
import struct
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://cabraspace.com"
LANGS = ("es", "en")


class T:
    """A bilingual string."""
    def __init__(self, es, en=None):
        self.es, self.en = es, (en if en is not None else es)

    def __call__(self, lang):
        return self.es if lang == "es" else self.en


def tr(x, lang):
    return x(lang) if isinstance(x, T) else x


def fname(base, lang):
    """ES file name -> file name in `lang`."""
    if lang == "es":
        return base
    if base == "index.html":
        return "en.html"
    page, _, anchor = base.partition("#")
    return page[:-5] + "-en.html" + ("#" + anchor if anchor else "")


def esc(s):
    return html.escape(str(s), quote=True)


# ---------------------------------------------------------------- icons
ICON = {
    "arrow": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
    "web": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle></svg>',
    "cloud": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H8a5 5 0 1 1 1.3-9.8A6 6 0 0 1 20 12a3.5 3.5 0 0 1-2.5 7z"></path></svg>',
    "ghs": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16h16"></path><path d="M7 17c5 0 5-10 12-10"></path></svg>',
    "globe": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>',
    "pm": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 5H7l5 7-5 7h10"></path></svg>',
    "planes": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><path d="M2 20 22 4"></path></svg>',
    "obs": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2"></path></svg>',
    "down": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"></path></svg>',
    "code": '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"></path></svg>',
    "play": '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#f3d27e"></path></svg>',
}
ARROW = ICON["arrow"]

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "atlas2"))
import carta_capricornio  # noqa: E402  (tools/atlas2/carta_capricornio.py: the animated figure, stdlib only here)

# Atlas II pieces (F3)
A2_ASSET_V = "20261112f3"      # ?v= of the scripts this file links (armilar.js, capricornus2.js); atlas2.css: sync_nav VERSION
A2_FONTS = ('\n  <link rel="preconnect" href="https://fonts.googleapis.com">'
            '\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;'
            '1,6..96,400..700&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">')
PLAY = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">'
        '<circle cx="12" cy="12" r="9.5"></circle><path d="M10 8.2v7.6l6-3.8z" fill="currentColor"></path></svg>')
BACK = ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<path d="M19 12H5M11 6l-6 6 6 6"></path></svg>')


def cartela(num, label=""):
    """<p class="cartela">Tabula I <i>·</i> label</p> (D2: I Herramientas · II Observaciones · III Bitácora · IV Programas).
    A cartela is one line that never wraps: above 32 characters it does not fit a phone (measured at 390 px with
    «Tabula II · Photography and measurements»), so it gets .cartela--larga and atlas2.css hides the label there."""
    if not label:
        return f'<p class="cartela">{num}</p>'
    # F4: plate cartelas are longer (the subtitle): measured, «Lám. III · Eclipse total · 12 · VIII · 2026 · Mirador del
    # Cabrero» overflowed its column from 540 to 860 px. Two more steps: > 40 characters, label hidden below 760 px;
    # > 52, below 960 px (atlas2.css §17). The F3 cartelas (<= 40) do not change.
    n = len(f"{num} · {label}")
    long_ = (" cartela--larga" if n > 32 else "") + (" cartela--l40" if n > 40 else "") + (" cartela--l52" if n > 52 else "")
    return f'<p class="cartela{long_}">{num}<span class="cartela-l"> <i>·</i> {label}</span></p>'


# ---------------------------------------------------------------- shared text
TOOLS = [  # href, engraving (.grab-*), name, short, long, tag, more (second line on the Web tools page)
    # «more»: texts of the approved prototype (propuestas-estetica/v2/herramientas.html), taken from each tool's own
    # page; the EN from the EN twin of that page where it has one.
    ("cabraspace-imaging-workflow.html", "placa", "CabraSpace Web",
     T("Procesa tu imagen en el navegador.", "Process your image in the browser."),
     T("Procesa tus imágenes en el navegador: estirado, máscaras, anotación y separación de estrellas.",
       "Process your images in the browser: stretching, masks, annotation and star separation."),
     T("Beta", "Beta"),
     T("Basado en el cockpit de PixInsight. Estirado, calibración y mezcla en tiempo real.",
       "Based on the PixInsight cockpit. Real-time stretching, calibration and blending.")),
    ("astroforecast.html", "observatorio", "Astro Forecast",
     T("Cómo será la noche en AstroCamp.", "Tonight at AstroCamp."),
     T("Probabilidad de abrir, consejos de adquisición y sensores en vivo para AstroCamp.",
       "Chance of opening, acquisition advice and live sensors for AstroCamp (Spain)."),
     T("Planificación", "Planning"),
     T("Previsión de las condiciones de observación para AstroCamp (Nerpio), con los consejos según la noche y la cúpula de cualquier objeto.",
       "Observing-condition forecast for AstroCamp (Nerpio, Spain), with advice for the night and the dome path of any target.")),
    ("autoghs.html", "histograma", "AutoGHS",
     T("Estirado GHS automático.", "Automatic GHS stretch."),
     T("Estirado automático con Generalised Hyperbolic Stretch, directamente en la web.",
       "Automatic Generalised Hyperbolic Stretch, right in your browser."),
     T("Procesado", "Processing"),
     T("Para tomas en banda estrecha o banda ancha, preservando el color y controlando el rango dinámico. Lee FITS, XISF, TIFF de 16 bits, PNG o JPG.",
       "For narrowband or broadband images, preserving colour ratios and controlling dynamic range. Reads FITS, XISF, 16-bit TIFF, PNG or JPG.")),
    ("contaminacion-mapa.html", "factorias", T("Contaminación lumínica", "Light pollution"),
     T("El brillo del cielo en tu zona.", "Sky brightness near you."),
     T("El mapa interactivo para elegir dónde montar.", "The interactive map to choose where to set up."),
     T("Planificación", "Planning"),
     T("Encuentra los cielos más oscuros cerca de ti antes de cargar el coche, con DarkSkySites (mapa VIIRS y simulador APEX) o con Light Pollution Map (escala Bortle con decimales).",
       "Find the darkest skies near you before you pack the car, with DarkSkySites (VIIRS map and APEX simulator) or Light Pollution Map (Bortle scale with decimals).")),
    ("pixelmath.html", "pizarra", "PixelMath-teca",
     T("Fórmulas listas para copiar.", "Formulas ready to copy."),
     T("Más de 100 fórmulas PixelMath agrupadas, con un simulador en tiempo real para SHO y RGB.",
       "Over 100 grouped PixelMath formulas, with a live simulator for SHO and RGB."),
     T("Consulta", "Reference"),
     T("Prueba las mezclas en el simulador con tus propias imágenes y copia las ecuaciones directamente a PixInsight.",
       "Try the blends in the simulator with your own images and copy the equations straight into PixInsight.")),
]
TOOL_NAME_HTML = {"CabraSpace Web": 'CabraSpace <em class="gi">Web</em>', "PixelMath-teca": '<span class="nb">PixelMath-teca</span>'}

KIND = {
    "deep-sky": T("Cielo profundo", "Deep sky"),
    "transit": T("Exoplanetas", "Exoplanets"),
    "eclipse": T("Eclipses", "Eclipses"),
}
FAMILY = {"deep-sky": "foto", "eclipse": "foto", "transit": "med"}
ANCHOR = {"deep-sky": "cielo-profundo", "transit": "exoplanetas", "eclipse": "eclipses"}
MONTHS = {"es": ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"],
          "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]}


def short_date(iso, lang):
    if not iso:
        return ""
    y, m, d = iso[:10].split("-")
    return f"{int(d)} · {MONTHS['es'][int(m) - 1]}" if lang == "es" else f"{int(d)} {MONTHS['en'][int(m) - 1]}"


def roman(n):
    vals = [(10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = ""
    for v, s in vals:
        while n >= v:
            out += s
            n -= v
    return out


# ---------------------------------------------------------------- page shell
def page(lang, base, title, desc, body, og_image=None, extra_head="", extra_js="", interior="a2"):
    """Page shell, Atlas II interior: web fonts + atlas/atlas2.css (sync_nav.py puts atlas2-marco.css before it and
    adds no atlas.css), plain <main>. The marco (sheet, header, footer) is sync_nav.py's. Since F4 every generated page
    is "a2"; the Atlas I branch (index.css + atlas.css, <main class="a3 page">) was removed with its last user."""
    if interior != "a2":
        raise ValueError("build_atlas.py only writes Atlas II pages since F4")
    og = f'\n  <meta name="cabra:og-image" content="{SITE}/{og_image}">' if og_image else ""
    sheets = A2_FONTS + '\n  <link rel="stylesheet" href="atlas/atlas2.css">'
    main_open = "  <main>"
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <link rel="icon" href="favicon_cabra.png" type="image/png">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">{og}
  <!-- ATLAS-PAGE: generada por tools/build_atlas.py; editar ahí y re-ejecutar -->{sheets}{extra_head}
</head>
<body>
  <script>
    if (localStorage.getItem('night-vision') === 'enabled') {{ document.body.classList.add('night-vision'); }}
  </script>
  <header id="navbar"></header>
{main_open}
{body}
  </main>
  <footer></footer>
{extra_js}
</body>
</html>
"""


# ---------------------------------------------------------------- media sizes (stdlib: width/height attributes)
def img_size(rel):
    """(width, height) of a local PNG or JPEG read from its header, or None. Stdlib only (no Pillow here)."""
    try:
        with open(os.path.join(ROOT, rel), "rb") as f:
            head = f.read(24)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return struct.unpack(">II", head[16:24])
            if head[:2] != b"\xff\xd8":
                return None
            f.seek(2)
            while True:
                b = f.read(1)
                while b and b != b"\xff":
                    b = f.read(1)
                while b == b"\xff":
                    b = f.read(1)
                if not b:
                    return None
                marker = b[0]
                if marker == 0x01 or 0xD0 <= marker <= 0xD8:
                    continue
                seg = struct.unpack(">H", f.read(2))[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):   # SOFn: precision, height, width
                    f.read(1)
                    h, w = struct.unpack(">HH", f.read(4))
                    return w, h
                f.seek(seg - 2, 1)
    except (OSError, struct.error):
        return None


def mp4_size(rel):
    """(width, height) of a local MP4's first video track (its tkhd box), or None."""
    try:
        data = open(os.path.join(ROOT, rel), "rb").read()
    except OSError:
        return None
    i = data.find(b"tkhd")
    while i > 3:
        size = struct.unpack(">I", data[i - 4:i])[0]
        w, h = struct.unpack(">II", data[i - 4 + size - 8:i - 4 + size])
        if w and h:
            return w >> 16, h >> 16
        i = data.find(b"tkhd", i + 4)
    return None


def wh(size):
    return f' width="{size[0]}" height="{size[1]}"' if size else ""


def same_file(a, b):
    """True if two local files have the same bytes (a video poster that IS the field image)."""
    pa, pb = os.path.join(ROOT, a), os.path.join(ROOT, b)
    try:
        if a == b:
            return True
        if os.path.getsize(pa) != os.path.getsize(pb):
            return False
        return open(pa, "rb").read() == open(pb, "rb").read()
    except OSError:
        return False


# ---------------------------------------------------------------- observations
def load_obs():
    p = os.path.join(ROOT, "obs", "observaciones.json")
    data = json.load(open(p, encoding="utf-8"))
    data.sort(key=lambda o: o.get("date_iso") or "", reverse=True)
    # plate numbers (Lám. I, II…) in chronological order, stable over time; _n is the same number, for the
    # previous / next links of each plate
    for i, o in enumerate(sorted(data, key=lambda o: o.get("date_iso") or "")):
        o["_lam"] = roman(i + 1)
        o["_n"] = i + 1
    return data


def obs_page(o):
    return o.get("page") or {"transit": f"transito-{o['slug']}.html", "deep-sky": f"cielo-{o['slug']}.html",
                              "eclipse": f"{o['slug']}.html"}[o["kind"]]


def obs_title(o, lang):
    t = o.get("title", {})
    return t.get(lang) or t.get("es") or o.get("object", o["slug"])


def obs_thumb(o):
    return o.get("thumb")


def thumb_src(o):
    """What the grids show: the light copy <thumb>-m.webp next to the thumbnail if tools/miniaturas.py wrote one (the
    transit curves: 800 px WebP of ~70 KB instead of the 1600 px PNG of ~700 KB), else the thumbnail itself. The plate
    keeps the original."""
    t = obs_thumb(o)
    if t:
        small = os.path.splitext(t)[0] + "-m.webp"
        if os.path.isfile(os.path.join(ROOT, small)):
            return small
    return t


# ---------------------------------------------------------------- Atlas II index pages (F3, 12-11-2026)
# Marcado del prototipo aprobado (propuestas-estetica/v2/index.html, observaciones.html, herramientas.html,
# bitacora.html, programas.html) con las piezas de atlas/atlas2.css. Datos: obs/observaciones.json y, en el
# navegador, latest.json (portada) y equipamiento/novedades/youtube_courses.json (Bitácora), que los robots
# actualizan sin regenerar el HTML: por eso esas cifras las calcula el JavaScript, nunca este fichero.
def thumb_alt(o, lang):
    """Alt of a plate's thumbnail: the alt of the media it comes from (transit curves), else the title."""
    m = next((x for x in o.get("media", []) if x.get("src") == obs_thumb(o)), None)
    return ((m or {}).get("alt") or {}).get(lang) or obs_title(o, lang)


def nb_title(o, lang):
    """Plate title with the designation kept on one line (prototype: «Tránsito de <span class="nb">Qatar-1 b</span>»)."""
    t = esc(obs_title(o, lang))
    obj = esc(o.get("object") or "")
    if o["kind"] == "transit" and obj and obj in t:
        return t.replace(obj, f'<span class="nb">{obj}</span>', 1)
    head, sep, rest = t.partition(", ")
    if sep and " " in head and len(head) <= 12:          # «PK 164+31.1, nebulosa planetaria»
        return f'<span class="nb">{head}</span>, {rest}'
    return t


def lam_meta(o, lang, year=False):
    lam = T(f"Lám. {o['_lam']}", f"Pl. {o['_lam']}")(lang)
    d = short_date(o.get("date_iso"), lang)
    if year and o.get("date_iso"):
        d += (" · " if lang == "es" else " ") + o["date_iso"][:4]
    part = f'<span class="etq etq--pt">{T("parcial", "partial")(lang)}</span>' if o.get("status") == "parcial" else ""
    return (f'<span class="lam-meta"><span class="caps">{lam}</span>'
            f'<span class="fell">{tr(KIND[o["kind"]], lang)} · {d}</span>{part}</span>')


def lam_card(o, lang, cls="lam", kind_attr=True):
    """<a class="lam"> plate card (atlas2.css §10). data-kind lets the Observations filters hide it."""
    thumb = thumb_src(o)
    enc = ' class="encaja"' if o["kind"] == "transit" else ""
    img = f'<img{enc} src="{thumb}" alt="{esc(thumb_alt(o, lang))}" loading="lazy">' if thumb else ""
    da = f' data-kind="{o["kind"]}"' if kind_attr else ""
    return (f'<a class="{cls}" href="{fname(obs_page(o), lang)}"{da}><span class="lam-marco">{img}</span>'
            f'{lam_meta(o, lang)}<span class="lam-t">{nb_title(o, lang)}</span></a>')


def friso(kind, aria, num, caption):
    return (f'<figure class="friso-fig">\n  <div class="friso friso-{kind}" role="img" aria-label="{esc(aria)}"></div>\n'
            f'  <figcaption class="pie-lam"><span class="caps">{num}</span><span class="fell">{caption}</span></figcaption>\n</figure>')


FILETE = '<div class="filete" aria-hidden="true"></div>'
LAM_WORD = T("láminas", "plates")


def home_picks(obs, n=4):
    """Home: the newest of each kind (variety of the work), then more photographs, then the rest."""
    picks = []
    for k in ("transit", "eclipse", "deep-sky"):
        x = next((o for o in obs if o["kind"] == k), None)
        if x:
            picks.append(x)
    picks += [o for o in obs if o not in picks and FAMILY[o["kind"]] == "foto"]
    picks += [o for o in obs if o not in picks]
    return picks[:n]


def tool_name(n, lang):
    """Name of a minor tool card (CabraSpace Web, the major one, uses TOOL_NAME_HTML directly)."""
    n = tr(n, lang)
    return '<span class="nb">PixelMath-teca</span>' if n == "PixelMath-teca" else esc(n)


CSW_ALT = T("CabraSpace Web con una imagen de M82 abierta: panel de pasos a la izquierda y visor a la derecha",
            "CabraSpace Web with an image of M82 open: the steps panel on the left and the viewer on the right")


def build_home(lang, obs):
    open_ = T("Abrir", "Open")(lang)
    h, g, n, short, lng, tag, more = TOOLS[0]
    mayor = (f'<a class="herr herr--mayor" href="{fname(h, lang)}">'
             f'<span class="herr-captura"><img src="atlas/img/cabraspace-web.jpg" alt="{CSW_ALT(lang)}" width="1200" height="680"></span>'
             f'<span class="herr-cuerpo"><span class="herr-top"><span class="herr-n">Nº I</span><span class="etq">{tr(tag, lang)}</span></span>'
             f'<h3 class="herr-t">{TOOL_NAME_HTML[n]}</h3><span class="herr-d">{tr(lng, lang)}</span>'
             f'<span class="grab grab-{g} herr-lam" aria-hidden="true"></span>'
             f'<span class="btn">{T("Abrir CabraSpace Web", "Open CabraSpace Web")(lang)}{ARROW}</span></span></a>')
    small = "\n          ".join(
        f'<a class="herr" href="{fname(h, lang)}"><span class="herr-n">Nº {roman(k + 2)}</span>'
        f'<h3 class="herr-t">{tool_name(n, lang)}</h3><span class="herr-d">{tr(s, lang)}</span>'
        f'<span class="grab grab-{g} herr-lam" aria-hidden="true"></span><span class="herr-ir">{open_}{ARROW}</span></a>'
        for k, (h, g, n, s, _, _, _) in enumerate(TOOLS[1:]))
    lams = "\n        ".join(lam_card(o, lang, kind_attr=False) for o in home_picks(obs))
    eclipse = next((o for o in obs if o["kind"] == "eclipse"), None)
    aviso = (f'<a class="aviso" href="{fname(obs_page(eclipse), lang)}"><span class="aviso-k">{T("Nuevo", "New")(lang)}</span>'
             f'<span class="aviso-t">{T("Eclipse solar del 12 · VIII: el paso de la Luna, en vídeo.", "Solar eclipse of 12 August: the Moon crossing the Sun, on video.")(lang)}</span>'
             f'<span class="aviso-b">{T("Ver el vídeo", "Watch the video")(lang)}{PLAY}</span></a>') if eclipse else ""
    pause, play = T("Pausar la animación", "Pause the animation")(lang), T("Reanudar la animación", "Resume the animation")(lang)
    workshop = ", ".join(f"<b>{w}</b> ({tr(sub, lang)})" for w, _, sub, _ in WORKSHOP[:-1])
    workshop += T(" y ", " and ")(lang) + f"<b>{WORKSHOP[-1][0]}</b> ({tr(WORKSHOP[-1][2], lang)})"
    body = f"""
<section class="heroe" aria-labelledby="t-heroe">
  <div class="heroe-carta">
    <div class="carta">
      <i class="carta-oro" aria-hidden="true"></i><i class="carta-ecl" aria-hidden="true"></i><i class="carta-est" aria-hidden="true"></i>
<!-- CAP-SVG-BEGIN -->
{carta_capricornio.figure_for_page(lang)}
<!-- CAP-SVG-END -->
    </div>
    <i class="heroe-velo" aria-hidden="true"></i>
  </div>
  <div class="heroe-in">
    <div class="heroe-tx">
      <h1 class="tit-1" id="t-heroe">{T('Fotografía y <em class="gi">medidas</em> del cielo', 'Photographing and <em class="gi">measuring</em> the sky')(lang)}</h1>
      <p>{T("Cielo profundo, el eclipse y curvas de luz de exoplanetas desde el observatorio AstroCamp. Y las herramientas con que lo hago, abiertas a todos.", "Deep sky, the eclipse and exoplanet light curves from the AstroCamp observatory. And the tools I use to do it, open to everyone.")(lang)}</p>
      {aviso}
    </div>
  </div>
  <figure class="heroe-pie">
    <figcaption><span class="caps">{T("Carta I", "Chart I")(lang)}</span><span class="fell">{T("Capricornus, la cabra del cielo", "Capricornus, the sky goat")(lang)}</span></figcaption>
    <div class="cap-time" id="cap-time" hidden><button type="button" class="ic cap-play" id="cap-play" aria-label="{pause}" data-pause="{pause}" data-play="{play}"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path class="i-play" d="M8 5v14l11-7z" fill="currentColor"></path></svg></button><div class="cap-track" aria-hidden="true"><span class="cap-bar"></span><span class="cap-tick" data-age="7000000"></span><span class="cap-tick" data-age="2800000"></span><span class="cap-tick" data-age="300000"></span><span class="cap-tick" data-age="0"></span><span class="cap-dot" id="cap-dot"></span></div><span class="cap-txt"><span class="cap-age" id="cap-age" aria-live="off"></span><span class="cap-era" id="cap-era"></span></span></div>
  </figure>
</section>
{FILETE}

<section class="sec sec--1" aria-labelledby="t-herr">
  <div class="wrap">
    <div class="herr-zona">
      <div class="herr-lado">
        <header class="sec-cab sec-cab--izq">
          {cartela("Tabula I")}
          <h2 class="tit-2" id="t-herr">{T('Herramientas <em class="gi">web</em>', 'Web <em class="gi">tools</em>')(lang)}</h2>
          <p class="sub">{T("Se abren en el navegador, sin instalar nada.", "They open in your browser, nothing to install.")(lang)}</p>
        </header>
        <div class="armilar" data-armilar aria-hidden="true"></div>
      </div>
      <div class="herr-main">
        <div class="bento">
          {mayor}
          {small}
        </div>
        <p class="nota"><span class="fell">{T("Próximamente", "Coming soon")(lang)}</span><span><b>CabraPlanes</b></span></p>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap duo">
    <div class="col">
      <header class="sec-cab sec-cab--izq">
        {cartela("Tabula II")}
        <h2 class="tit-2">{T("Observaciones", "Observations")(lang)}</h2>
        <p class="sub">{T("Lo último del cuaderno.", "Latest in the notebook.")(lang)}</p>
      </header>
      <div class="laminas">
        {lams}
      </div>
      <a class="lnk" href="{fname("observaciones.html", lang)}">{T(f"Las {len(obs)} láminas del cuaderno", f"All {len(obs)} plates in the notebook")(lang)}{ARROW}</a>
    </div>
    <div class="col">
      <header class="sec-cab sec-cab--izq">
        {cartela("Tabula III")}
        <h2 class="tit-2">{T("Bitácora", "Logbook")(lang)}</h2>
        <p class="sub">{T("Equipo, software y cursos, cada día.", "Equipment, software and courses, every day.")(lang)}</p>
      </header>
      <ol class="bit bit--compacta" id="home-log" data-lang="{lang}"></ol>
      <a class="lnk" href="{fname("bitacora.html", lang)}">{T("Toda la bitácora", "The whole logbook")(lang)}{ARROW}</a>
    </div>
  </div>
</section>

<section class="sec sec--pegada" aria-labelledby="t-prog">
  <div class="wrap">
    <div class="taller">
      <span class="grab grab-astrolabio" aria-hidden="true"></span>
      <div>
        <h2 id="t-prog">{T('Programas, <em class="gi">en el taller</em>', 'Software, <em class="gi">in the workshop</em>')(lang)}</h2>
        <p>{T("Para instalar en PixInsight no hay ninguno publicado ahora. En el taller: ", "There is nothing to install in PixInsight published right now. In the workshop: ")(lang)}{workshop}.</p>
      </div>
      <a class="lnk" href="{fname("programas.html", lang)}">{T("Programas", "Software")(lang)}{ARROW}</a>
    </div>
  </div>
</section>

{friso("horizonte", T("Grabado: el observatorio en su colina, un viaducto y, a lo lejos, las chimeneas de una ciudad fabril bajo un cielo rayado", "Engraving: the observatory on its hill, a viaduct and, in the distance, the chimneys of a factory town under a hatched sky")(lang), "Fig. I", T("El horizonte. El observatorio en su colina y, a lo lejos, las chimeneas.", "The horizon. The observatory on its hill and, in the distance, the chimneys.")(lang))}
"""
    js = f"""  <script src="atlas/armilar.js?v={A2_ASSET_V}" defer></script>
  <script src="atlas/capricornus2.js?v={A2_ASSET_V}"></script>
  <script>
  (function () {{
    var box = document.getElementById('home-log'); if (!box) return;
    var en = box.getAttribute('data-lang') === 'en';
    var M = en ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    var TAG = en ? {{ sw: 'Software', hw: 'Equipment' }} : {{ sw: 'Software', hw: 'Equipo' }};
    function d(s) {{ var p = (s || '').split('-'); return p.length < 3 ? '' : (en ? (+p[2]) + ' ' + M[+p[1] - 1] : (+p[2]) + ' · ' + M[+p[1] - 1]); }}
    function esc(s) {{ var e = document.createElement('span'); e.textContent = s || ''; return e.innerHTML; }}
    fetch('latest.json').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var all = (j.software || []).map(function (x) {{ x.k = 'sw'; return x; }}).concat((j.hardware || []).map(function (x) {{ x.k = 'hw'; return x; }}));
      all.sort(function (a, b) {{ return (b.date || '').localeCompare(a.date || ''); }});
      box.innerHTML = all.slice(0, 4).map(function (x) {{
        return '<li><a class="bit-f" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer"><span class="bit-d">' + d(x.date) + '</span>'
          + '<span class="bit-t">' + esc(en ? x.title_en : x.title_es) + '</span><span class="bit-g">' + TAG[x.k] + '</span></a></li>';
      }}).join('');
    }}).catch(function () {{ box.innerHTML = ''; }});
  }})();
  </script>"""
    title = T("CabraSpace · Fotografía y medidas del cielo", "CabraSpace · Photographing and measuring the sky")(lang)
    desc = T("Astrofotografía de cielo profundo, tránsitos de exoplanetas y el eclipse de 2026 desde AstroCamp, y herramientas web gratuitas para procesar y planificar.",
             "Deep-sky astrophotography, exoplanet transits and the 2026 eclipse from AstroCamp, plus free web tools to process and plan.")(lang)
    return page(lang, "index.html", title, desc, body, extra_js=js, interior="a2")


SERIE_TEXT = {  # paragraph of the featured series on Observations, by slug (from the page before F3)
    "eclipse-2026": T("El eclipse del 12 de agosto de 2026 en vídeo, con la Vaonis Vespera Pro.",
                      "The eclipse of 12 August 2026 on video, with the Vaonis Vespera Pro."),
}


def serie_card(o, lang):
    img = o.get("poster") or obs_thumb(o)
    video = any(m.get("type") == "video" for m in o.get("media", []))
    badge = f'<span class="lam-video">{PLAY.replace("18", "16")}{T("En vídeo", "On video")(lang)}</span>' if video else ""
    text = SERIE_TEXT.get(o["slug"])
    text = tr(text, lang) if text else esc((o.get("description") or {}).get(lang, ""))
    title = (o.get("title_html") or {}).get(lang) or esc(obs_title(o, lang))
    return (f'<a class="serie" href="{fname(obs_page(o), lang)}" id="serie" data-kind="{o["kind"]}">'
            f'<span class="lam-marco"><img src="{img}" alt="{esc(thumb_alt(o, lang))}" loading="lazy">{badge}</span>'
            f'<span class="serie-tx"><span class="etq">{T("Serie", "Series")(lang)}</span>{lam_meta(o, lang, year=True)}'
            f'<span class="tit-2">{title}</span><p>{text}</p>'
            f'<span class="lnk">{T("Ver la serie", "Watch the series")(lang)}{ARROW}</span></span></a>')


def techo_fig(lang):
    """Fig. I of Observations: the roll-off roof observatory in section (D3, version 2), with its call-out letters.
    The letters' positions come from the generator (tools/atlas2/d3/llamadas.json), so redrawing moves them too."""
    with open(os.path.join(ROOT, "tools", "atlas2", "d3", "llamadas.json"), encoding="utf-8") as fh:
        labels = json.load(fh)["techo-corredizo"]["labels"]
    ll = "\n          ".join(f'<span class="ll" style="left:{x:g}%;top:{y:g}%" aria-hidden="true">{k}</span>'
                             for k, (x, y) in sorted(labels.items()))
    aria = T("Observatorio de techo corredizo en corte: el techo desplazado sobre sus raíles, telescopio sobre montura ecuatorial y pilar con su propio cimiento; al fondo, un segundo pilar y la puerta",
             "Roll-off roof observatory in section: the roof moved off along its rails, a telescope on an equatorial mount and a pier with its own footing; beyond, a second pier and the door")(lang)
    cap = T("<b>Fig. I.</b> Observatorio de techo corredizo, en corte. <i>a</i>, techo corredizo; <i>b</i>, raíles y vigas carril; <i>c</i>, telescopio; <i>d</i>, montura ecuatorial; <i>e</i>, pilar, separado del suelo; <i>f</i>, cimiento.",
            "<b>Fig. I.</b> Roll-off roof observatory, in section. <i>a</i>, roll-off roof; <i>b</i>, rails and rail beams; <i>c</i>, telescope; <i>d</i>, equatorial mount; <i>e</i>, pier, isolated from the floor; <i>f</i>, footing.")(lang)
    return (f'<figure class="fig">\n        <div class="fig-in">\n          <span class="grab grab-techo" role="img" aria-label="{esc(aria)}"></span>\n'
            f'          {ll}\n        </div>\n        <figcaption class="fig-pie">{cap}</figcaption>\n      </figure>')


def build_observaciones(lang, obs):
    kinds = [k for k in ("deep-sky", "eclipse", "transit") if any(o["kind"] == k for o in obs)]
    chips = [f'<button class="chip is-on" type="button" aria-pressed="true" data-f="all">{T("Todo", "All")(lang)}</button>']
    groups = {"foto": T("Fotografía", "Photography"), "med": T("Medidas", "Measurements")}
    for fam, label in groups.items():
        ks = [k for k in kinds if FAMILY[k] == fam]
        if not ks:
            continue
        chips.append(f'<span class="chips-g fell">{label(lang)}</span>')
        for k in ks:
            chips.append(f'<button class="chip" type="button" aria-pressed="false" data-f="{k}" data-anchor="{ANCHOR[k]}">{tr(KIND[k], lang)}</button>')
    chips_html = "\n        ".join(chips)
    # Photography: the newest eclipse as the featured series, then the photographs (two per row, large)
    eclipses = [o for o in obs if o["kind"] == "eclipse"]
    photos = [o for o in obs if FAMILY[o["kind"]] == "foto" and (not eclipses or o is not eclipses[0])]
    foto = ""
    if eclipses or photos:
        foto = (f'<div class="grupo" data-grupo="foto">\n    <h2 class="grupo-t">{groups["foto"](lang)}</h2>\n    '
                + (serie_card(eclipses[0], lang) + "\n    " if eclipses else "")
                + ('<div class="laminas">\n      ' + "\n      ".join(lam_card(o, lang, "lam lam--m") for o in photos) + '\n    </div>\n' if photos else "")
                + '   </div>')
    meds = [o for o in obs if FAMILY[o["kind"]] == "med"]
    med = (f'<div class="grupo" data-grupo="med">\n    <h2 class="grupo-t">{groups["med"](lang)}</h2>\n    <div class="laminas laminas--4">\n      '
           + "\n      ".join(lam_card(o, lang) for o in meds) + '\n    </div>\n   </div>') if meds else ""
    body = f"""
<div class="wrap">
  <div class="pag-cab">
    <div class="pag-tx">
      {cartela("Tabula II", T("Fotografía y medidas", "Photography and measurements")(lang))}
      <h1 class="tit-1">{T('El <em class="gi">cuaderno</em> de observación', 'The observing <em class="gi">notebook</em>')(lang)}</h1>
      <p class="entradilla">{T("Lo que hago desde el observatorio AstroCamp: imágenes de cielo profundo, curvas de luz de tránsitos de exoplanetas y el eclipse de 2026.", "What I do from the AstroCamp observatory: deep-sky images, exoplanet transit light curves and the 2026 eclipse.")(lang)}</p>
      <div class="chips" role="group" aria-label="{T("Filtrar las observaciones", "Filter the observations")(lang)}">
        {chips_html}
      </div>
    </div>
    <div class="pag-grab"><span class="grab grab-refractor" aria-hidden="true"></span></div>
  </div>
</div>
{FILETE}

<section class="sec">
  <div class="wrap">
   {foto}
   {med}
  </div>
</section>

{FILETE}
<section class="sec" aria-labelledby="t-desde">
  <div class="wrap">
    <div class="duo desde">
      {techo_fig(lang)}
      <div class="col">
        <header class="sec-cab sec-cab--izq">
          <h2 class="tit-2" id="t-desde">{T('Desde <em class="gi">dónde</em> se observa', 'Where I <em class="gi">observe</em> from')(lang)}</h2>
        </header>
        <div class="prosa">
          <p>{T("Las fotografías de cielo profundo y las curvas de luz de los tránsitos salen del observatorio AstroCamp. El eclipse del 12 de agosto se fotografió desde el mirador del Cabrero, en Teruel.", "The deep-sky photographs and the transit light curves come from the AstroCamp observatory. The eclipse of 12 August was photographed from the Cabrero viewpoint, in Teruel.")(lang)}</p>
        </div>
        <dl class="ficha">
          <div><dt>{T("Lugar", "Site")(lang)}</dt><dd>AstroCamp · 1600 m</dd></div>
          <div><dt>{T("Telescopio", "Telescope")(lang)}</dt><dd>Celestron C9.25</dd></div>
        </dl>
      </div>
    </div>
  </div>
</section>
"""
    js = """  <script>
  /* filtros: ocultan las láminas (y la serie) de otro tipo; una rejilla o un grupo que se quedan sin nada se ocultan
     también, para no dejar hueco. El ancla (#exoplanetas, #cielo-profundo, #eclipses) se recuerda en la URL. */
  (function () {
    var chips = document.querySelectorAll('.chip[data-f]');
    function apply(f) {
      chips.forEach(function (c) { var on = c.getAttribute('data-f') === f; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on); });
      document.querySelectorAll('.grupo [data-kind]').forEach(function (l) { l.hidden = !(f === 'all' || l.getAttribute('data-kind') === f); });
      document.querySelectorAll('.grupo .laminas, .grupo').forEach(function (box) { box.hidden = !box.querySelector('[data-kind]:not([hidden])'); });
    }
    chips.forEach(function (c) { c.addEventListener('click', function () {
      var f = c.getAttribute('data-f'); apply(f);
      history.replaceState(null, '', f === 'all' ? location.pathname : '#' + c.getAttribute('data-anchor'));
    }); });
    function fromHash() { var c = document.querySelector('.chip[data-anchor="' + location.hash.slice(1) + '"]'); apply(c ? c.getAttribute('data-f') : 'all'); }
    window.addEventListener('hashchange', fromHash); fromHash();
  })();
  </script>"""
    first_img = next((obs_thumb(o) for o in obs if obs_thumb(o) and o["kind"] == "deep-sky"), None)
    return page(lang, "observaciones.html", T("Observaciones · CabraSpace", "Observations · CabraSpace")(lang),
                T("Imágenes de cielo profundo, tránsitos de exoplanetas y el eclipse de 2026 desde el observatorio AstroCamp.",
                  "Deep-sky images, exoplanet transits and the 2026 eclipse from the AstroCamp observatory.")(lang),
                body, og_image=first_img, extra_js=js, interior="a2")


def build_herramientas(lang):
    open_ = T("Abrir", "Open")(lang)
    h, g, n, short, lng, tag, more = TOOLS[0]
    rest = "\n      ".join(
        f'<a class="herr" href="{fname(th, lang)}">'
        f'<span class="herr-top"><span class="herr-n">Nº {roman(k + 2)}</span><span class="etq">{tr(tg, lang)}</span></span>'
        f'<h2 class="herr-t">{tool_name(nm, lang)}</h2><span class="herr-d">{tr(lg, lang)}</span>'
        f'<span class="herr-usos">{tr(mo, lang)}</span>'
        f'<span class="grab grab-{gr} herr-lam" aria-hidden="true"></span><span class="herr-ir">{open_}{ARROW}</span></a>'
        for k, (th, gr, nm, _, lg, tg, mo) in enumerate(TOOLS[1:]))
    body = f"""
<div class="wrap">
  <div class="pag-cab pag-cab--par">
    <div class="pag-tx">
      <a class="miga" href="{fname("index.html", lang)}">{BACK}{T("Inicio", "Home")(lang)}</a>
      {cartela("Tabula I", T("Sin instalar nada", "Nothing to install")(lang))}
      <h1 class="tit-1">{T('Herramientas <em class="gi">web</em>', 'Web <em class="gi">tools</em>')(lang)}</h1>
    </div>
    <p class="entradilla">{T("Se abren en el navegador. No hace falta instalar nada ni crear cuenta.", "They open in your browser. Nothing to install, no account needed.")(lang)}</p>
  </div>
</div>

{friso("taller", T("Grabado: un banco de trabajo con un refractor, una cámara de fuelle, una balanza, engranajes, un teodolito y herramientas colgadas", "Engraving: a workbench with a refractor, a bellows camera, a balance, gears, a theodolite and hanging tools")(lang), "Fig. I", T("El banco de trabajo. Lo que se usa cada noche y lo que está a medio hacer.", "The workbench. What is used every night and what is still half-made.")(lang))}
{FILETE}

<section class="sec" aria-label="{T("Las herramientas", "The tools")(lang)}">
  <div class="wrap">

    <a class="herr herr--mayor herr--ancha" href="{fname(h, lang)}">
      <span class="herr-captura"><img src="atlas/img/cabraspace-web.jpg" alt="{CSW_ALT(lang)}" width="1200" height="680"></span>
      <span class="herr-cuerpo">
        <span class="herr-top"><span class="herr-n">{T("Nº I · la principal", "Nº I · Flagship")(lang)}</span><span class="etq">{tr(tag, lang)}</span></span>
        <h2 class="herr-t">{TOOL_NAME_HTML[n]}</h2>
        <span class="herr-d">{tr(lng, lang)}</span>
        <span class="herr-usos">{tr(more, lang)}</span>
        <span class="btn">{T("Abrir CabraSpace Web", "Open CabraSpace Web")(lang)}{ARROW}</span>
      </span>
    </a>

    <div class="herr-lista">
      {rest}
      <div class="herr herr--pronto">
        <span class="etq etq--pt">{T("Próximamente", "Coming soon")(lang)}</span>
        <div>
          <h2 class="herr-t">CabraPlanes</h2>
          <p class="herr-d">{T("Qué aviones cruzarán el Sol o la Luna desde donde estás.", "Which aircraft will transit the Sun or the Moon from your location.")(lang)}</p>
        </div>
      </div>
    </div>

    <p class="cierre"><span class="fell">{T("¿Necesitas algo que corra dentro de PixInsight?", "Need something that runs inside PixInsight?")(lang)}</span><a class="lnk" href="{fname("programas.html", lang)}">{T("Programas para instalar", "Software to install")(lang)}{ARROW}</a></p>

  </div>
</section>
"""
    return page(lang, "herramientas.html", T("Herramientas web · CabraSpace", "Web tools · CabraSpace")(lang),
                T("Herramientas gratuitas en el navegador para astrofotografía: CabraSpace Web, Astro Forecast, AutoGHS, mapa de contaminación lumínica y PixelMath-teca.",
                  "Free in-browser astrophotography tools: CabraSpace Web, Astro Forecast, AutoGHS, light pollution map and PixelMath-teca.")(lang),
                body, interior="a2")


WORKSHOP = [  # name, description, short subject (home line), subject (card label)
    ("CabraSolar", T("Apilado, deconvolución y realce del Sol en H-alfa.", "Stacking, deconvolution and sharpening of the Sun in H-alpha."),
     T("Sol en H-alfa", "the Sun in H-alpha"), T("El Sol en H-alfa", "The Sun in H-alpha")),
    ("CabraEclipse", T("Procesado de eclipses totales al estilo Druckmüller.", "Total-eclipse processing, Druckmüller style."),
     T("eclipses totales", "total eclipses"), T("Eclipses totales", "Total eclipses")),
    ("CabraTransit", T("Fotometría de tránsitos de exoplanetas, del FITS a la curva de luz.", "Exoplanet transit photometry, from FITS to light curve."),
     T("fotometría de tránsitos", "transit photometry"), T("Exoplanetas", "Exoplanets")),
]


def build_programas(lang):
    ws = "\n      ".join(f'<li class="herr herr--pronto"><span class="herr-n">{tr(lab, lang)}</span><h3 class="herr-t">{n}</h3>'
                         f'<p class="herr-d">{d(lang)}</p></li>' for n, d, _, lab in WORKSHOP)
    body = f"""
<div class="wrap">
  <div class="pag-cab prog-cab">
    <div class="pag-tx">
      {cartela("Tabula IV", T("Para instalar", "To install")(lang))}
      <h1 class="tit-1">{T('Programas para <em class="gi">PixInsight</em>', 'Software for <em class="gi">PixInsight</em>')(lang)}</h1>
      <p class="entradilla">{T("Ahora mismo no hay ninguno publicado. El script que estaba aquí se ha retirado temporalmente mientras se revisa su compatibilidad; volverá cuando esté listo.", "None is published right now. The script that used to be here has been temporarily withdrawn while its compatibility is reviewed; it will return when it is ready.")(lang)}</p>
    </div>
    <div class="pag-grab"><span class="grab grab-astrolabio" aria-hidden="true"></span></div>
  </div>
</div>
{FILETE}

<section class="sec" aria-labelledby="t-taller">
  <div class="wrap">
    <header class="sec-cab sec-cab--izq">
      {cartela(T("En el taller", "In the workshop")(lang))}
      <h2 class="tit-2" id="t-taller">{T('Aún <em class="gi">sin publicar</em>', 'Not <em class="gi">released yet</em>')(lang)}</h2>
      <p class="sub">{T("Programas en los que trabajo; saldrán cuando estén listos.", "Programs I am working on; they will be released when ready.")(lang)}</p>
    </header>
    <ul class="rejilla rejilla-3 prog">
      {ws}
    </ul>
  </div>
</section>
"""
    return page(lang, "programas.html", T("Programas · CabraSpace", "Software · CabraSpace")(lang),
                T("Programas de CabraSpace para PixInsight, en preparación.",
                  "CabraSpace software for PixInsight, in preparation.")(lang),
                body, interior="a2")


def build_bitacora(lang):
    kinds = [("all", T("Todo", "All")), ("hw", T("Equipo", "Equipment")), ("sw", T("Software", "Software")), ("yt", T("Cursos", "Courses"))]
    chips = "\n          ".join(
        f'<button class="chip{" is-on" if k == "all" else ""}" type="button" data-k="{k}" aria-pressed="{"true" if k == "all" else "false"}">'
        f'{l(lang)} <small data-n="{k}"></small></button>' for k, l in kinds)
    more = [("equipamiento.html", T("Catálogo de equipo", "Equipment catalogue")), ("novedades.html", T("Novedades de software", "Software news")),
            ("cursos-youtube.html", T("Cursos de YouTube", "YouTube courses")), ("contaminacion.html", T("Contaminación lumínica: vídeos y guías", "Light pollution: videos and guides")),
            ("divulgacion-coffeebreak.html", T("Archivo: Coffee Break, señal y ruido", "Archive: Coffee Break podcast"))]
    cats = "\n          ".join(f'<li><a href="{fname(h, lang)}">{l(lang)}{ARROW}</a></li>' for h, l in more)
    body = f"""
<div class="wrap">
  <div class="pag-cab pag-cab--par">
    <div class="pag-tx">
      {cartela("Tabula III", T("Registro", "Record")(lang))}
      <h1 class="tit-1">{T('Bitá<em class="gi">cora</em>', 'Log<em class="gi">book</em>')(lang)}</h1>
    </div>
    <p class="entradilla">{T("Novedades de equipo y de software y cursos, recopilados cada día. Se consulta, no se anuncia.", "Equipment and software news and courses, collected every day. For browsing, not announcing.")(lang)}</p>
  </div>
</div>
{friso("archivo", T("Grabado: una estantería de archivo con libros, tomos numerados, ficheros, rollos de cartas, un globo celeste y una esfera armilar", "Engraving: an archive shelf with books, numbered volumes, card files, rolled charts, a celestial globe and an armillary sphere")(lang), "Fig. I", T("El archivo. Tomos, ficheros y cartas enrolladas.", "The archive. Volumes, card files and rolled charts.")(lang))}
{FILETE}

<section class="sec" aria-labelledby="t-reg">
  <div class="wrap reg">
    <aside class="reg-lado" aria-label="{T("Filtros y catálogos", "Filters and catalogues")(lang)}">
      <div>
        <span class="caps rotulo">{T("Filtrar", "Filter")(lang)}</span>
        <div class="chips" role="group" aria-label="{T("Filtrar el registro", "Filter the record")(lang)}">
          {chips}
        </div>
      </div>
      <nav aria-label="{T("Catálogos completos", "Full catalogues")(lang)}">
        <span class="caps rotulo">{T("Catálogos completos", "Full catalogues")(lang)}</span>
        <ul class="cats">
          {cats}
        </ul>
      </nav>
      <span class="grab grab-octante" aria-hidden="true"></span>
    </aside>
    <div>
      <header class="reg-cab">
        <h2 id="t-reg">{T("Todo, lo más reciente primero", "Everything, newest first")(lang)}</h2>
      </header>
      <ol class="bit bit--reg" id="reg" data-lang="{lang}"></ol>
      <p class="reg-fin" id="reg-fin">{T("Cargando…", "Loading…")(lang)}</p>
      <div class="reg-mas" id="reg-mas" hidden><button type="button" class="btn-linea" id="more">{T("Cargar más", "Load more")(lang)}</button></div>
    </div>
  </div>
</section>
"""
    js = """  <script>
  /* Registro: lee los tres JSON que actualizan los robots (equipamiento, novedades, cursos), cuenta cada filtro,
     pinta las 25 entradas más recientes y oculta la fecha repetida de un mismo día. */
  (function () {
    var list = document.getElementById('reg'); if (!list) return;
    var en = list.getAttribute('data-lang') === 'en';
    var M = en ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    var LBL = en ? { all: 'Everything, newest first', hw: 'Equipment', sw: 'Software', yt: 'Courses' } : { all: 'Todo, lo más reciente primero', hw: 'Equipo', sw: 'Software', yt: 'Cursos' };
    var TAG = en ? { hw: 'Equipment', sw: 'Software', yt: 'Course' } : { hw: 'Equipo', sw: 'Software', yt: 'Curso' };
    var UNIT = { a: 'y', m: 'mo', d: 'd', 'sem.': 'wk', h: 'h' };
    var ARR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
    var head = document.getElementById('t-reg'), fin = document.getElementById('reg-fin'), mas = document.getElementById('reg-mas');
    function d(s) { var p = (s || '').split('-'); return p.length < 3 ? '' : (en ? (+p[2]) + ' ' + M[+p[1] - 1] : (+p[2]) + ' · ' + M[+p[1] - 1]); }
    function rel(s) {   // «Emitido hace 3 a» / «hace 3 a» (YouTube, in Spanish) -> «hace 3 a» · «3 y ago»
      s = (s || '').replace(/^Emitido\\s+/, '');
      var m = en && s.match(/^hace (\\d+) (a|m|d|sem\\.|h)$/);
      return m ? m[1] + ' ' + UNIT[m[2]] + ' ago' : s;
    }
    function esc(s) { var e = document.createElement('span'); e.textContent = s == null ? '' : s; return e.innerHTML; }
    var rows = [], k = 'all', shown = 25;
    function get(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); }
    Promise.all([get('equipamiento.json'), get('novedades.json'), get('youtube_courses.json')]).then(function (a) {
      function cap(s) { s = s || ''; return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s; }
      a[0].forEach(function (x) { rows.push({ k: 'hw', date: x.date, t: en ? x.title_en : x.title_es, src: x.source || cap(en ? x.category_en : x.category_es), url: x.url }); });
      a[1].forEach(function (x) { rows.push({ k: 'sw', date: x.date, t: en ? x.title_en : x.title_es, src: cap(en ? x.category_en : x.category_es), url: x.url }); });
      a[2].forEach(function (x) { rows.push({ k: 'yt', date: '', rel: x.published_relative, t: en ? x.title_en : x.title_es, src: x.author, url: x.url }); });
      rows.sort(function (p, q) { return (q.date || '').localeCompare(p.date || ''); });
      ['all', 'hw', 'sw', 'yt'].forEach(function (key) {
        var n = key === 'all' ? rows.length : rows.filter(function (r) { return r.k === key; }).length;
        var el = document.querySelector('[data-n="' + key + '"]'); if (el) el.textContent = n;
      });
      render();
    });
    function render() {
      var all = rows.filter(function (r) { return k === 'all' || r.k === k; }), prev = null;
      list.innerHTML = all.slice(0, shown).map(function (r) {
        var dl = r.date ? d(r.date) : rel(r.rel), same = dl === prev;
        prev = dl;
        var src = r.src && r.src.toLowerCase() !== TAG[r.k].toLowerCase() ? '<span class="bit-s">' + esc(r.src) + '</span>' : '';
        return '<li><a class="bit-f' + (same ? ' is-mismo' : '') + '" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">'
          + '<span class="bit-d">' + esc(dl || '—') + '</span><span class="bit-t">' + esc(r.t) + src + '</span>'
          + '<span class="bit-g">' + TAG[r.k] + '</span><span class="bit-a">' + ARR + '</span></a></li>';
      }).join('');
      var n = all.length, m = Math.min(shown, n);
      fin.textContent = !n ? '—' : m < n
        ? (en ? 'The ' + m + ' most recent entries of ' + n + '. The rest, in the full catalogues.' : 'Las ' + m + ' entradas más recientes de ' + n + '. El resto, en los catálogos completos.')
        : (en ? 'All ' + n + ' entries.' : 'Las ' + n + ' entradas.');
      mas.hidden = !(n > shown);
    }
    document.querySelectorAll('.chip[data-k]').forEach(function (b) { b.addEventListener('click', function () {
      k = b.getAttribute('data-k'); shown = 25;
      document.querySelectorAll('.chip[data-k]').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      head.textContent = LBL[k]; render();
    }); });
    document.getElementById('more').addEventListener('click', function () { shown += 25; render(); });
  })();
  </script>"""
    return page(lang, "bitacora.html", T("Bitácora · CabraSpace", "Logbook · CabraSpace")(lang),
                T("Novedades de equipo y software de astrofotografía y cursos de PixInsight, recopilados cada día.",
                  "Astrophotography equipment and software news and PixInsight courses, collected every day.")(lang),
                body, extra_js=js, interior="a2")


# ---------------------------------------------------------------- per-observation pages (F4, 12-11-2026)
# Diseño de la lámina de Qatar-1 b del prototipo aprobado (propuestas-estetica/v2/transito-qatar1b.html): miga de dos
# pasos, cartela «Lám. N · subtítulo», título, entradilla; la figura principal grande a su proporción natural (abre el
# original); debajo, el texto (relato, notas, «Hecho con», figuras secundarias) a la izquierda y la ficha técnica a la
# derecha, las referencias bajo el texto; al final, el paso a la lámina anterior y siguiente (por número de lámina).
# Variantes: cielo profundo (la fotografía protagonista, .lam-natural--foto, abre la versión completa) y eclipse
# (además, la serie de fases). La imagen científica manda: sin grabado.
STATUS = {"publicado": T("Publicado", "Published"),
          "preprint": T("Preprint, sin revisión por pares", "Preprint, not peer reviewed"),
          "base de datos": T("Base de datos", "Database"),
          "nota de prensa": T("Nota de prensa", "Press release"),
          "datos propios": T("Datos propios", "Own data")}
CALL_RE = re.compile(r"\s*\[((?:\d+|inf\.)(?:,\s*(?:\d+|inf\.))*)\]")     # [1] · [8, 9] · [9, inf.] · [inf.] of RELATOS.md
INF_TITLE = T("Inferencia, cuenta o comparación propia, no publicada", "Our own inference, calculation or comparison, not published")
INF_NOTE = T("marca una inferencia, una cuenta o una comparación propias, no publicadas.",
             "marks our own inference, calculation or comparison, not published.")


def story_calls(paragraphs):
    return [[x.strip() for x in m.group(1).split(",")] for p in paragraphs for m in CALL_RE.finditer(p)]


def story_para(text, lang, links):
    """One paragraph of the plate's story: escaped text, its calls [n] as linked superscripts and, if the story says so,
    a phrase turned into a link to another plate (Lám. VI -> «Lám. IX»)."""
    def call(m):
        parts = []
        for x in (x.strip() for x in m.group(1).split(",")):
            if x == "inf.":
                parts.append(f'<a class="cita-inf" href="#nota-inf" title="{INF_TITLE(lang)}">inf.</a>')
            else:
                parts.append(f'<a href="#ref-{x}" aria-label="{T("Referencia", "Reference")(lang)} {x}">{x}</a>')
        return '<sup class="cita">' + ", ".join(parts) + "</sup>"
    s = CALL_RE.sub(call, esc(text))
    for phrase, href in links:
        s = s.replace(esc(phrase), f'<a href="{href}">{esc(phrase)}</a>', 1)
    return f"<p>{s}</p>"


def story_links(o, obs, lang):
    """story.links {lang: {phrase: slug}} -> [(phrase, page)]; warns if the phrase names another plate number."""
    out = []
    for phrase, slug in ((o.get("story") or {}).get("links") or {}).get(lang, {}).items():
        target = next((x for x in obs if x["slug"] == slug), None)
        if not target:
            print(f"  AVISO {o['slug']}: el relato enlaza a '{slug}', que no existe", file=sys.stderr)
            continue
        if not phrase.endswith(" " + target["_lam"]):
            print(f"  AVISO {o['slug']}: «{phrase}» enlaza a la lámina {target['_lam']}", file=sys.stderr)
        out.append((phrase, fname(obs_page(target), lang)))
    return out


def link_label(url, several=False):
    """Visible text of a reference link: arXiv:id, doi:…, else the site (or the file name when one entry has several)."""
    m = re.match(r"https?://arxiv\.org/abs/(.+)$", url)
    if m:
        return "arXiv:" + m.group(1)
    m = re.match(r"https?://(?:dx\.)?doi\.org/(.+)$", url)
    if m:
        return "doi:" + m.group(1)
    u = urllib.parse.urlsplit(url)
    if several:
        return u.path.rstrip("/").rsplit("/", 1)[-1]
    return re.sub(r"^www\.", "", u.netloc)


def ref_item(r, lang):
    v = lambda x: x.get(lang) or x.get("es") if isinstance(x, dict) else x
    if r.get("own"):
        body = T("Datos propios: esta lámina.", "Own data: this plate.")(lang)
    else:
        urls = r.get("url") or []
        urls = [urls] if isinstance(urls, str) else urls
        if "text" in r:
            body = esc(v(r["text"]))
        else:
            q = ("«", "»") if lang == "es" else ("“", "”")
            body = f'{esc(r.get("authors", ""))} ({esc(r.get("year", ""))}). {q[0]}{esc(r.get("title", ""))}{q[1]}.'
            venue = v(r.get("venue") or "")
            if venue and not (urls and venue == link_label(urls[0])):     # a preprint's venue IS its arXiv link
                body += f' <i>{esc(venue)}</i>.'
            if r.get("note"):
                body += " " + esc(v(r["note"]))
        body += "".join(f' <a href="{esc(u)}" target="_blank" rel="noopener noreferrer">{esc(link_label(u, len(urls) > 1))}</a>'
                        for u in urls)
        st = STATUS.get(r.get("status"))
        if st:
            label = st(lang) + (f' ({esc(v(r["status_note"]))})' if r.get("status_note") else "")
            mod = " ref-est--preprint" if r["status"] == "preprint" else ""
            body += f' <span class="ref-est{mod}">{label}</span>'
    return f'<li id="ref-{r["n"]}"><span class="ref-n">{r["n"]}</span><span class="ref-tx">{body}</span></li>'


def refs_block(story, lang):
    refs = story.get("refs") or []
    if not refs:
        return ""
    items = "\n          ".join(ref_item(r, lang) for r in refs)
    has_inf = any("inf." in c for c in story_calls(story.get(lang) or story.get("es") or []))
    inf = f'\n        <p class="refs-inf" id="nota-inf"><i>inf.</i> {INF_NOTE(lang)}</p>' if has_inf else ""
    return (f'<section class="refs" aria-labelledby="t-refs">\n        <h2 class="caps rotulo" id="t-refs">{T("Referencias", "References")(lang)}</h2>\n'
            f'        <ol>\n          {items}\n        </ol>{inf}\n      </section>')


VIDEO_BOX = [(1300 / 988, " video--campo"), (16 / 9, " video--16x9")]     # box ratios atlas2.css knows (§10, .video)


def fig_pie(n, cap):
    return f'<figcaption class="fig-pie"><b>Fig. {n}.</b> {cap}</figcaption>' if cap else ""


def lower_first(s):
    return s[:1].lower() + s[1:] if s else s


def plate_figures(o, lang):
    """(main figure, secondary figures) of a plate. A video whose poster is the same file as an image of the plate (the
    transit field) absorbs that image: one figure, as in the prototype («Al reproducirlo, …»)."""
    title = obs_title(o, lang)
    media = list(o.get("media", []))
    merged = {}                                    # video index -> image it absorbs
    for i, m in enumerate(media):
        if m["type"] == "video" and m.get("poster"):
            j = next((j for j, x in enumerate(media) if x["type"] != "video" and j not in merged.values() and j != 0
                      and same_file(x["src"], m["poster"])), None)
            if j is not None:
                merged[i] = j
    shown = [i for i in range(len(media)) if i not in merged.values()]
    main, rest = "", []
    for n, i in enumerate(shown, 1):
        m = media[i]
        cap = (m.get("caption") or {}).get(lang) or ""
        alt = esc((m.get("alt") or {}).get(lang) or title)
        if m["type"] == "video":
            img = media[merged[i]] if i in merged else None
            if img:
                icap = (img.get("caption") or {}).get(lang) or ""
                cap = (icap + " " + T("Al reproducirlo, ", "Play it for ")(lang) + lower_first(cap)).strip() if cap else icap
            size = img_size(m["poster"]) if img else (mp4_size(m["src"]) or img_size(m.get("poster", "")))
            label = f' aria-label="{esc((img.get("alt") or {}).get(lang) or title)}"' if img else ""
            # width/height only hold until the poster and then the video load (ratio «auto»): pin the box with a class
            ratio = size[0] / size[1] if size else 0
            mod = next((c for r, c in VIDEO_BOX if abs(ratio - r) < 0.01), "")
            fig = (f'<figure class="fig">\n          <video class="video{mod}" controls preload="none" playsinline poster="{m.get("poster", "")}"{wh(size)}{label}>'
                   f'<source src="{m["src"]}" type="video/mp4"></video>\n          {fig_pie(n, cap)}\n        </figure>')
        else:
            plot = m["type"] == "plot" or m.get("fit")
            enc = ' class="encaja"' if plot else ""
            lazy = "" if n == 1 else ' loading="lazy"'
            cls = "lam-natural" if (plot or n > 1) else "lam-natural lam-natural--foto"
            if n > 1:
                cls = "fig " + cls
            fig = (f'<figure class="{cls}">\n      <a class="lam-marco" href="{m.get("full", m["src"])}" target="_blank" rel="noopener">'
                   f'<img{enc} src="{m["src"]}" alt="{alt}"{wh(img_size(m["src"]))}{lazy}></a>\n      {fig_pie(n, cap)}\n    </figure>')
        if n == 1:
            main = fig
        else:
            rest.append(fig)
    return main, rest


def phases_block(o, lang):
    ph = o.get("phases") or []
    if not ph:
        return ""
    items = "\n        ".join(
        f'<li><a href="{p["src"]}" target="_blank" rel="noopener"><img src="{p["src"]}" alt="{T("El Sol a las", "The Sun at")(lang)} {p["time"]} UTC"'
        f'{wh(img_size(p["src"]))} loading="lazy"><span class="fell">{esc((p.get("label") or {}).get(lang, p["time"]))}</span></a></li>' for p in ph)
    return (f'<div class="panel fases">\n      <span class="caps rotulo">{T("Las fases · hora UTC", "The phases · UTC time")(lang)}</span>\n'
            f'      <ol class="fases-l">\n        {items}\n      </ol>\n    </div>')


def pasa_block(o, obs, lang):
    """Previous / next plate by plate number (computed from the data, so a new observation slots in by itself)."""
    order = sorted(obs, key=lambda x: x["_n"])
    i = order.index(o)
    prev = order[i - 1] if i > 0 else None
    nxt = order[i + 1] if i + 1 < len(order) else None
    lam = o["_lam"]
    card = lambda x: lam_card(x, lang, "lam lam--fila", kind_attr=False)
    left = (f'<div>\n        <span class="caps rotulo">{T("Lámina anterior", "Previous plate")(lang)}</span>\n        '
            + (card(prev) if prev else f'<span class="fell">{T(f"La lámina {lam} es la primera del cuaderno.", f"Plate {lam} is the first in the notebook.")(lang)}</span>')
            + '\n      </div>')
    right = (f'<div class="pasa-fin">\n        <span class="caps rotulo">{T("Lámina siguiente", "Next plate")(lang)}</span>\n        '
             + (card(nxt) if nxt else f'<span class="fell">{T(f"La lámina {lam} es la más reciente del cuaderno.", f"Plate {lam} is the most recent in the notebook.")(lang)}</span>')
             + '\n      </div>')
    return f'<nav class="pasa" aria-label="{T("Láminas vecinas", "Neighbouring plates")(lang)}">\n      {left}\n      {right}\n    </nav>'


def title_h1(o, lang):
    """title_html, with the planet's designation kept on one line (prototype: <em class="gi nb">Qatar-1 b</em>)."""
    th = (o.get("title_html") or {}).get(lang) or esc(obs_title(o, lang))
    obj = esc(o.get("object") or "")
    if obj:
        th = th.replace(f'<em class="gi">{obj}</em>', f'<em class="gi nb">{obj}</em>', 1)
    return th


def build_obs_page(o, obs, lang):
    title = obs_title(o, lang)
    lam = T(f"Lám. {o['_lam']}", f"Pl. {o['_lam']}")(lang)
    kind_label = tr(KIND[o["kind"]], lang)
    sub = (o.get("subtitle") or {}).get(lang) or kind_label
    desc = (o.get("description") or {}).get(lang) or title
    ruta = (f'<nav class="ruta" aria-label="{T("Ruta", "Breadcrumb")(lang)}"><a class="miga" href="{fname("observaciones.html", lang)}">{BACK}'
            f'{T("Observaciones", "Observations")(lang)}</a><span aria-hidden="true">›</span>'
            f'<a class="miga" href="{fname("observaciones.html", lang)}#{ANCHOR[o["kind"]]}">{kind_label}</a></nav>')
    main_fig, more_figs = plate_figures(o, lang)
    # left column: story (D4), notes, «made with», secondary figures — each only if there is something to say
    story = o.get("story") or {}
    paras = story.get(lang) or []
    col = []
    if paras:
        links = story_links(o, obs, lang)
        col.append('<div class="prosa relato">\n          ' + "\n          ".join(story_para(p, lang, links) for p in paras) + "\n        </div>")
    notes = (o.get("notes") or {}).get(lang) or ""
    if notes:
        col.append(f'<div class="prosa notas">\n          <span class="caps rotulo">{T("Notas", "Notes")(lang)}</span>\n          {notes}\n        </div>')
    tool = o.get("made_with")
    if tool:
        col.append(f'<p class="nota"><span class="fell">{T("Hecho con", "Made with")(lang)}</span><span><b>{tool["name"]}</b> · '
                   f'{(tool.get("desc") or {}).get(lang, "")}</span></p>')
    col += more_figs
    col_html = ('<div class="col">\n        ' + "\n        ".join(col) + "\n      </div>\n      ") if col else ""
    facts = (o.get("facts_display") or {}).get(lang) or (o.get("facts_display") or {}).get("es") or []
    ficha = "\n          ".join(f"<div><dt>{esc(k)}</dt><dd>{esc(v)}</dd></div>" for k, v in facts if v)
    downloads = "\n          ".join(
        f'<li><a href="{d["src"]}" download>{esc(d["label"][lang])}<span>{esc(d["fmt"])} ↓</span></a></li>' for d in o.get("downloads", []))
    downloads = (f'\n        <span class="caps">{T("Descargas", "Downloads")(lang)}</span>\n        <ul class="cats">\n          {downloads}\n        </ul>'
                 if downloads else "")
    refs = refs_block(story, lang) if paras else ""
    body = f"""
<div class="wrap">
  <div class="pag-cab">
    <div class="pag-tx">
      {ruta}
      {cartela(lam, esc(sub))}
      <h1 class="tit-1">{title_h1(o, lang)}</h1>
      <p class="entradilla">{esc(desc)}</p>
    </div>
  </div>
</div>
{FILETE}

<section class="sec">
  <div class="wrap">
    {main_fig}
    {phases_block(o, lang)}
    <div class="duo det">
      {col_html}<div class="panel">
        <span class="caps">{T("Ficha técnica", "Technical details")(lang)}</span>
        <dl class="ficha">
          {ficha}
        </dl>{downloads}
      </div>
      {refs}
    </div>
  </div>
</section>

<section class="sec sec--pegada">
  <div class="wrap">
    {pasa_block(o, obs, lang)}
  </div>
</section>
"""
    body = re.sub(r"\n[ \t]*(?=\n)", "", body)        # blocks a plate does not have leave no blank lines
    og = o.get("og") or obs_thumb(o)
    return page(lang, obs_page(o), f"{title} · CabraSpace", desc, body, og_image=og, interior="a2")


# ---------------------------------------------------------------- main
def write(name, text):
    with open(os.path.join(ROOT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main():
    obs = load_obs()
    n = 0
    for lang in LANGS:
        write(fname("index.html", lang), build_home(lang, obs))
        write(fname("observaciones.html", lang), build_observaciones(lang, obs))
        write(fname("herramientas.html", lang), build_herramientas(lang))
        write(fname("programas.html", lang), build_programas(lang))
        write(fname("bitacora.html", lang), build_bitacora(lang))
        n += 5
        for o in obs:
            write(fname(obs_page(o), lang), build_obs_page(o, obs, lang))
            n += 1
    print(f"build_atlas: {n} páginas escritas ({len(obs)} observaciones).")


if __name__ == "__main__":
    main()
