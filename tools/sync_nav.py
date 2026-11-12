"""
Fuente única del MARCO (estilo Atlas II) de TODAS las páginas: hoja con orla, cabecera con su cajón
móvil y pie. Desde F2 de la migración (12-11-2026).

Qué hace en cada *.html de la raíz (idempotente: re-ejecutar no cambia nada):
  - <head>: asegura, en este orden, atlas/atlas.css?v=  ·  [capa EXTRA_CSS]?v=  ·  fuente IM Fell English
    ·  atlas/atlas2-marco.css?v=  (la última: el marco gana a index.css/atlas.css solo en lo suyo; ver la
    cabecera de atlas/atlas2-marco.css, «CONVIVENCIA»).
    Páginas con INTERIOR Atlas II (desde F3: las que enlazan atlas/atlas2.css, hoy las 10 que genera
    build_atlas.py con el interior nuevo): NO se les añade atlas.css; el orden es fuente IM Fell English ·
    atlas2-marco.css?v= · atlas2.css?v= (el interior, después del marco). Las demás quedan igual que en F2.
  - Sustituye el <header id="navbar">…</header> por la cabecera Atlas II (ES o EN). El cajón móvil
    (#atlas-drawer) va DENTRO de la cabecera; el cajón viejo <div class="ad" id="atlas-drawer"> se quita.
  - Quita el antiguo <div class="mobile-menu-overlay">.
  - Sustituye el primer <footer>…</footer> por el pie Atlas II (las páginas sin pie lo reciben si están en
    WITH_FOOTER).
  - Envuelve cabecera · contenido · pie en <div class="hoja" data-marco><div class="hoja-in"> … </div></div>
    (de justo antes de <header id="navbar"> a justo después del pie). El interior no se toca.
  - Cambia <script src="mobile-menu.js"> / atlas/atlas.js / atlas/atlas2.js por UN <script src="atlas/atlas2.js?v=...">.

La sección actual (aria-current) se escribe aquí, por el nombre del fichero (SECTIONS), no en JavaScript.
El conmutador ES/EN apunta a la gemela de cada página (twin_of); si la gemela no existe, se avisa.
Menú simple (decisión D7 de Nino): la cabecera ya no lleva «Lo último», así que una observación nueva
ya no reescribe todas las páginas. Numeración D2: I Herramientas · II Observaciones · III Bitácora · IV Programas.

Para cambiar el menú o el pie: edita las plantillas de aquí y ejecuta, desde la raíz del repo:
    python tools/sync_nav.py
Orden de la cadena: build_atlas.py → (build_workflow_en.py) → sync_nav.py → seo_inject.py
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "20261112a"
TWIN_OVERRIDES = {"index.html": "en.html", "en.html": "index.html"}
SKIP = {"pi-workflow.html", "pi-workflow-en.html"}          # redirecciones sin cabecera
SKIP_PREFIX = ("borrador-",)                                 # borradores de diseño
EXTRA_CSS = {  # capa de estilo propia de algunas páginas, enlazada justo después de atlas.css
    "cabraspace-imaging-workflow": "atlas/tools.css", "autoghs": "atlas/tools.css", "pixelmath": "atlas/tools.css",
    "contaminacion-mapa": "atlas/tools.css",
    "astroforecast": "atlas/astroforecast.css",
}
# no tenían pie; lo reciben (el marco de F2 lo lleva en todas las páginas)
WITH_FOOTER = {"astroforecast.html", "astroforecast-en.html", "contaminacion-mapa.html", "contaminacion-mapa-en.html"}

MARKER = "<!-- NAV-AUTO: cabecera, cajón y pie generados por tools/sync_nav.py; editar ahí y re-ejecutar -->"
FONT_HREF = "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap"   # orla y cita del pie

# Section of each page, from its file name (ES name; the -en twin follows). The first match wins.
# cielo-* are observations too (Atlas I missed them: atlas/atlas.js:8).
SECTIONS = [
    ("herr", ("herramientas", "cabraspace-imaging-workflow", "pi-workflow", "astroforecast", "autoghs",
              "contaminacion-mapa", "pixelmath")),
    ("obs", ("observaciones", "eclipse-", "transito-", "cielo-")),
    ("prog", ("programas", "cabrascripts")),
    ("bit", ("bitacora", "novedades", "equipamiento", "cursos-youtube", "contaminacion.html", "divulgacion-")),
]
SECTION_INDEX = {"herr": "herramientas.html", "obs": "observaciones.html", "prog": "programas.html", "bit": "bitacora.html"}

ICON = {
    "grid": '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="3.5"></rect><rect x="13.5" y="3.5" width="7" height="7" rx="3.5"></rect><rect x="3.5" y="13.5" width="7" height="7" rx="3.5"></rect><rect x="13.5" y="13.5" width="7" height="7" rx="3.5"></rect></svg>',
    "moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>',
    "menu": '<svg class="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>'
            '<svg class="i-cerrar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
}
# filtro de las fotos en modo noche (atlas2-marco.css §6): luminancia -> solo canal rojo
NIGHT_FILTER = ('<svg class="cab-filtros" width="0" height="0" aria-hidden="true" focusable="false">'
                '<filter id="cb-noche" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" '
                'values="0.17 0.57 0.06 0 0  0.008 0.028 0.003 0 0  0 0 0 0 0  0 0 0 1 0"></feColorMatrix></filter></svg>')

# Everything that differs between languages. Links are ES file names; EN twins are derived.
TEXT = {
    "es": {
        "home": "index.html", "obs": "Observaciones", "prog": "Programas", "bit": "Bitácora",
        "herr": "Herramientas web", "night": "Modo noche", "open": "Abrir menú", "close": "Cerrar menú",
        "home_label": "CabraSpace, inicio", "main_nav": "Principal", "drawer_nav": "Secciones", "foot_nav": "Pie de página",
        "lang_nav": "Idioma",
        # cajón: I Herramientas · II Observaciones · III Bitácora · IV Programas (D2)
        "drawer_sub": {"herr": "Úsalas ahora · sin instalar", "obs": "Fotografía · Medidas", "bit": "Novedades",
                       "prog": "Para instalar"},
        "youtube": "YouTube · @CabraSpace", "contact": "Contacto",
    },
    "en": {
        "home": "en.html", "obs": "Observations", "prog": "Software", "bit": "Logbook",
        "herr": "Web tools", "night": "Night mode", "open": "Open menu", "close": "Close menu",
        "home_label": "CabraSpace, home", "main_nav": "Main", "drawer_nav": "Sections", "foot_nav": "Footer",
        "lang_nav": "Language",
        "drawer_sub": {"herr": "Use them now · nothing to install", "obs": "Photography · Measurements", "bit": "News",
                       "prog": "Desktop software"},
        "youtube": "YouTube · @CabraSpace", "contact": "Contact",
    },
}
NUMBERED = [("I.", "herr"), ("II.", "obs"), ("III.", "bit"), ("IV.", "prog")]          # D2


def lang_of(f):
    return "en" if (f == "en.html" or f.endswith("-en.html")) else "es"


def twin_of(f):
    if f in TWIN_OVERRIDES:
        return TWIN_OVERRIDES[f]
    if f.endswith("-en.html"):
        return f[:-len("-en.html")] + ".html"
    return f[:-len(".html")] + "-en.html"


def L(href, lang):
    """Localise an ES link (keeps #anchors)."""
    if lang == "es" or href.startswith(("http", "mailto:", "#")):
        return href
    page, _, anchor = href.partition("#")
    page = twin_of(page) if page else page
    return page + ("#" + anchor if anchor else "")


def es_name(fname):
    return fname if lang_of(fname) == "es" else twin_of(fname)


def section_of(fname):
    f = es_name(fname)
    for key, prefixes in SECTIONS:
        for p in prefixes:
            if (p.endswith(".html") and f == p) or (not p.endswith(".html") and f.startswith(p)):
                return key
    return None


def current(fname, key):
    """aria-current for a link to section `key` from page `fname`: page (the index), true (a subpage) or nothing."""
    sec = section_of(fname)
    if sec != key:
        return ""
    return ' aria-current="page"' if es_name(fname) == SECTION_INDEX[key] else ' aria-current="true"'


def lang_links(fname):
    lang = lang_of(fname)
    es_file = fname if lang == "es" else twin_of(fname)
    en_file = fname if lang == "en" else twin_of(fname)
    for f in (es_file, en_file):
        if not os.path.exists(os.path.join(ROOT, f)):
            print(f"  AVISO: {fname}: su gemela {f} no existe; el conmutador ES/EN apuntará a un 404")
    on = ' aria-current="true"'
    return (f'<span class="cab-lang" role="group" aria-label="{TEXT[lang]["lang_nav"]}">'
            f'<a href="{es_file}" lang="es" hreflang="es"{on if lang == "es" else ""}>ES</a><span aria-hidden="true">·</span>'
            f'<a href="{en_file}" lang="en" hreflang="en"{on if lang == "en" else ""}>EN</a></span>')


def header(fname):
    lang = lang_of(fname)
    t = TEXT[lang]
    ln = lang_links(fname)
    nav = "".join(f'<a href="{L(SECTION_INDEX[k], lang)}" class="cab-l"{current(fname, k)}>{t[k]}</a>'
                  for k in ("obs", "prog", "bit"))                                       # D7: menú simple
    drawer = "".join(f'<a href="{L(SECTION_INDEX[k], lang)}" class="cab-cl"{current(fname, k)}><i>{n}</i>'
                     f'<b>{t[k]}</b><small>{t["drawer_sub"][k]}</small></a>' for n, k in NUMBERED)
    return (
        f'<header id="navbar" class="cab">\n    {MARKER}\n'
        f'    {NIGHT_FILTER}\n'
        f'    <div class="cab-bar">\n'
        f'      <a href="{t["home"]}" class="cab-logo" aria-label="{t["home_label"]}"><img src="atlas/img/logo-gold.png" alt="" width="30" height="36"><span>CabraSpace</span></a>\n'
        f'      <nav class="cab-nav" aria-label="{t["main_nav"]}">{nav}</nav>\n'
        f'      <div class="cab-r">\n'
        f'        <a href="{L("herramientas.html", lang)}" class="cab-hw" aria-label="{t["herr"]}"{current(fname, "herr")}>{ICON["grid"]}<span>{t["herr"]}</span></a>\n'
        f'        <button class="ic cab-noche" type="button" aria-label="{t["night"]}" aria-pressed="false">{ICON["moon"]}</button>\n'
        f'        {ln}\n'
        f'        <button class="ic cab-burger" type="button" aria-label="{t["open"]}" data-open="{t["open"]}" data-close="{t["close"]}" aria-controls="atlas-drawer" aria-expanded="false">{ICON["menu"]}</button>\n'
        f'      </div>\n'
        f'    </div>\n'
        f'    <div class="cab-cajon" id="atlas-drawer" hidden>\n'
        f'      <nav aria-label="{t["drawer_nav"]}">{drawer}</nav>\n'
        f'      <div class="cab-cajon-pie">{ln}</div>\n'
        f'    </div>\n'
        f'    <div class="filete" aria-hidden="true"></div>\n'
        f'  </header>')


# Latin sign-off at the foot of each page, the same in ES and EN, with its translation and source in the
# page's language (Nino, 25-09-2026). Page -> (latin, {lang: (translation, source)}).
# Translations are quoted verbatim from published editions (checked 25-09-2026 on Bible Gateway,
# Wikisource, theoi.com and Project Gutenberg); the source line names the translator.
SIGNS = {
    "index.html": ("Et lux in tenebris lucet, et tenebrae eam non comprehenderunt.", {
        "es": ("Y la luz en las tinieblas resplandece; mas las tinieblas no la comprendieron.",
               "Evangelio de Juan 1, 5 · Reina-Valera, 1909"),
        "en": ("And the light shineth in darkness; and the darkness comprehended it not.",
               "Gospel of John 1:5 · King James Version, 1611")}),
    "programas.html": ("Os homini sublime dedit caelumque videre iussit et erectos ad sidera tollere vultus.", {
        "es": ("Un rostro sublime al hombre dio y el cielo ver le ordenó y erguido hacia las estrellas "
               "levantar su semblante.",
               "Ovidio · Metamorfosis I, 85-86 · trad. Ana Pérez Vega"),
        "en": ("Man was given a lofty countenance and was commanded to behold the skies; "
               "and with an upright face may view the stars.",
               "Ovid · Metamorphoses I, 85–86 · tr. Brookes More, 1922")}),
    "bitacora.html": ("Sic itur ad astra.", {
        "es": ("¡Sigue! ¡ése es de los astros el camino!",
               "Virgilio · Eneida IX, 641 · trad. Miguel Antonio Caro"),
        "en": ("This is the Way to Heav'n.", "Virgil · Aeneid IX, 641 · tr. John Dryden, 1697")}),
}
SIGN_DEFAULT = ("Caelum videre.", {
    "es": ("Contemplar el cielo.", "Ovidio · Metamorfosis I, 85 · trad. Francisco Crivell, 1805"),
    "en": ("To behold the skies.", "Ovid · Metamorphoses I, 85 · tr. Brookes More, 1922")})


def footer(fname):
    lang = lang_of(fname)
    t = TEXT[lang]
    sign, tr = SIGNS.get(es_name(fname), SIGN_DEFAULT)
    trans, source = tr[lang]
    links = "".join(f'<a href="{L(SECTION_INDEX[k], lang)}"{current(fname, k)}>{t[k]}</a>' for _, k in NUMBERED)   # orden D2
    return (
        f'<footer class="pie">\n'
        f'    <div class="filete" aria-hidden="true"></div>\n'
        f'    <div class="pie-in">\n'
        f'      <div class="pie-g">\n'
        f'        <figure><blockquote class="pie-cita" lang="la">{sign}</blockquote>'
        f'<figcaption><p class="pie-tr">{trans}</p><span class="caps pie-src">{source}</span></figcaption></figure>\n'
        f'        <div class="pie-enl"><a class="btn-linea" href="https://www.youtube.com/@CabraSpace" target="_blank" rel="noopener noreferrer">{t["youtube"]}</a>'
        f'<a class="btn-linea" href="mailto:info@cabraspace.com">{t["contact"]}</a></div>\n'
        f'      </div>\n'
        f'      <div class="pie-base"><span class="pie-marca"><img src="atlas/img/logo-gold.png" alt="" width="22" height="26"><span class="caps">CabraSpace · MMXXVI</span></span>'
        f'<nav class="pie-nav" aria-label="{t["foot_nav"]}">{links}</nav></div>\n'
        f'    </div>\n'
        f'  </footer>')


CSS_LINK = f'<link rel="stylesheet" href="atlas/atlas.css?v={VERSION}">'
FONT_LINK = f'<link rel="stylesheet" href="{FONT_HREF}">'
MARCO_LINK = f'<link rel="stylesheet" href="atlas/atlas2-marco.css?v={VERSION}">'
JS_TAG = f'<script src="atlas/atlas2.js?v={VERSION}"></script>'
HOJA_OPEN = '<div class="hoja" data-marco><div class="hoja-in">'
HOJA_CLOSE = '</div></div><!-- /hoja -->'
header_re = re.compile(r'<header id="navbar"[^>]*>.*?</header>', re.S)
drawer_re = re.compile(r'\s*<div class="ad" id="atlas-drawer" hidden>.*?\n  </div></div>', re.S)   # cajón de Atlas I
overlay_re = re.compile(r'\s*<div class="mobile-menu-overlay"[^>]*>\s*</div>', re.S)
footer_re = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
css_re = re.compile(r'<link rel="stylesheet" href="atlas/atlas\.css[^"]*">')
A2_LINK = f'<link rel="stylesheet" href="atlas/atlas2.css?v={VERSION}">'
a2_re = re.compile(r'<link rel="stylesheet" href="atlas/atlas2\.css[^"]*">')       # interior Atlas II (F3)
marco_re = re.compile(r'[ \t]*<link rel="stylesheet" href="(?:atlas/atlas2-marco\.css[^"]*|' + re.escape(FONT_HREF) + r')">[ \t]*\r?\n?')
js_re = re.compile(r'<script src="(?:mobile-menu\.js|atlas/atlas2?\.js)[^"]*"></script>')
hoja_open_re = re.compile(re.escape(HOJA_OPEN) + r'\s*')
hoja_close_re = re.compile(r'\s*' + re.escape(HOJA_CLOSE))


def process(fname, txt):
    if not header_re.search(txt):
        return None
    # previous frame wrapper (re-run)
    txt = hoja_open_re.sub("", txt)
    txt = hoja_close_re.sub("", txt)
    if a2_re.search(txt):
        # page with the Atlas II interior (F3): font, marco, atlas2.css (the interior, after the marco); no atlas.css
        txt = a2_re.sub(A2_LINK, txt)
        txt = marco_re.sub("", txt)
        txt = txt.replace(A2_LINK, FONT_LINK + "\n  " + MARCO_LINK + "\n  " + A2_LINK, 1)
    else:
        # stylesheets: atlas.css, [extra layer], font, marco (last)
        if css_re.search(txt):
            txt = css_re.sub(CSS_LINK, txt)
        elif "</head>" in txt:
            txt = txt.replace("</head>", f"  {CSS_LINK}\n</head>", 1)
        txt = marco_re.sub("", txt)
        base = fname[:-len("-en.html")] if fname.endswith("-en.html") else fname[:-len(".html")]
        extra = EXTRA_CSS.get(base)
        after = CSS_LINK
        if extra:
            link = f'<link rel="stylesheet" href="{extra}?v={VERSION}">'
            txt = re.sub(r'\s*<link rel="stylesheet" href="' + re.escape(extra) + r'[^"]*">', "", txt)
            txt = txt.replace(CSS_LINK, CSS_LINK + "\n  " + link, 1)
            after = link
        txt = txt.replace(after, after + "\n  " + FONT_LINK + "\n  " + MARCO_LINK, 1)
    # header (with its drawer inside)
    txt = drawer_re.sub("", txt)
    txt = overlay_re.sub("", txt)
    txt = header_re.sub(lambda m: header(fname), txt, count=1)
    # footer
    if footer_re.search(txt):
        txt = footer_re.sub(lambda m: footer(fname), txt, count=1)
    elif fname in WITH_FOOTER:
        txt = txt.replace("</body>", f"  {footer(fname)}\n</body>", 1)
    # sheet: from the header to the end of the footer (or </body> if a page has no footer)
    h = txt.index('<header id="navbar"')
    txt = txt[:h] + HOJA_OPEN + "\n  " + txt[h:]
    m = footer_re.search(txt, h)
    end = m.end() if m else txt.rindex("</body>")
    txt = txt[:end] + "\n  " + HOJA_CLOSE + txt[end:] if m else txt[:end] + HOJA_CLOSE + "\n" + txt[end:]
    # script
    txt = re.sub(r'[ \t]*' + js_re.pattern + r'[ \t]*\r?\n?', "", txt)
    txt = txt.replace("</body>", f"  {JS_TAG}\n</body>", 1)
    return txt


def main():
    changed = skipped = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "*.html"))):
        fname = os.path.basename(path)
        if fname in SKIP or fname.startswith(SKIP_PREFIX):
            continue
        txt = open(path, encoding="utf-8", errors="replace").read()
        new = process(fname, txt)
        if new is None:
            print(f"  (sin <header id=navbar>, omitido) {fname}")
            skipped += 1
            continue
        if new != txt:
            open(path, "w", encoding="utf-8", newline="").write(new)
            changed += 1
    print(f"Marco sincronizado: {changed} páginas actualizadas, {skipped} omitidas.")


if __name__ == "__main__":
    main()
