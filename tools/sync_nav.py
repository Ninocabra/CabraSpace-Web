"""
Fuente única de la cabecera, el cajón móvil y el pie (estilo Atlas) de TODAS las páginas.

Qué hace en cada *.html de la raíz (idempotente):
  - <head>: asegura <link rel="stylesheet" href="atlas/atlas.css?v=..."> (después de index.css).
  - Sustituye el <header id="navbar">…</header> por la cabecera Atlas (ES o EN).
  - Sustituye/inserta el cajón móvil <div class="ad" id="atlas-drawer">…</div> justo después.
  - Quita el antiguo <div class="mobile-menu-overlay">.
  - Sustituye el primer <footer>…</footer> por el pie Atlas (las páginas sin pie no lo reciben,
    salvo las de WITH_FOOTER).
  - Cambia <script src="mobile-menu.js"> por <script src="atlas/atlas.js?v=...">.

La sección activa la marca atlas/atlas.js por la URL, así el bloque es idéntico en todas las
páginas salvo el conmutador de idioma (que apunta al gemelo de cada página).

Para cambiar el menú o el pie: edita las plantillas de aquí y ejecuta, desde la raíz del repo:
    python tools/sync_nav.py
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "20260925f"
TWIN_OVERRIDES = {"index.html": "en.html", "en.html": "index.html"}
SKIP = {"pi-workflow.html", "pi-workflow-en.html"}          # redirecciones sin cabecera
SKIP_PREFIX = ("borrador-",)                                 # borradores de diseño
EXTRA_CSS = {  # capa de estilo propia de algunas páginas, enlazada justo después de atlas.css
    "cabraspace-imaging-workflow": "atlas/tools.css", "autoghs": "atlas/tools.css", "pixelmath": "atlas/tools.css",
    "contaminacion-mapa": "atlas/tools.css",
    "astroforecast": "atlas/astroforecast.css",
}
WITH_FOOTER = {"astroforecast.html", "astroforecast-en.html"}  # no tenían pie; lo reciben

MARKER = "<!-- NAV-AUTO: cabecera, cajón y pie generados por tools/sync_nav.py; editar ahí y re-ejecutar -->"

ICON = {
    "chev": '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
    "grid": '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="3.5"></rect><rect x="13.5" y="3.5" width="7" height="7" rx="3.5"></rect><rect x="3.5" y="13.5" width="7" height="7" rx="3.5"></rect><rect x="13.5" y="13.5" width="7" height="7" rx="3.5"></rect></svg>',
    "moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>',
    "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
    "close": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
    "arrow": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
    "web": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"></circle></svg>',
    "cloud": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H8a5 5 0 1 1 1.3-9.8A6 6 0 0 1 20 12a3.5 3.5 0 0 1-2.5 7z"></path></svg>',
    "ghs": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16h16"></path><path d="M7 17c5 0 5-10 12-10"></path></svg>',
    "globe": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>',
    "pm": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 5H7l5 7-5 7h10"></path></svg>',
    "planes": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><path d="M2 20 22 4"></path></svg>',
}

# Everything that differs between languages. Links are ES file names; EN twins are derived.
TEXT = {
    "es": {
        "home": "index.html", "obs": "Observaciones", "prog": "Programas", "bit": "Bitácora",
        "herr": "Herramientas web", "night": "Modo noche", "open": "Abrir menú", "close": "Cerrar menú",
        "home_label": "CabraSpace, inicio", "main_nav": "Principal", "foot_nav": "Pie de página",
        "foto": "Fotografía", "med": "Medidas", "latest": "Lo último", "all_obs": "Todas las observaciones",
        "items_foto": [("observaciones.html#cielo-profundo", "Cielo profundo", "Galaxias y nebulosas"),
                       ("eclipse-2026.html", "Eclipses", "12 · VIII · 2026, en vídeo")],
        "items_med": [("observaciones.html#exoplanetas", "Exoplanetas", "Curvas de luz de tránsitos")],
        "tools_head": "Se abren en el navegador · sin instalar", "open_tool": "Abrir", "soon": "Próximamente",
        "tools": [("cabraspace-imaging-workflow.html", "web", "CabraSpace Web", "Procesado en el navegador · beta"),
                  ("astroforecast.html", "cloud", "Astro Forecast", "La noche en AstroCamp"),
                  ("autoghs.html", "ghs", "AutoGHS", "Estirado GHS automático"),
                  ("contaminacion-mapa.html", "globe", "Contaminación", "Brillo del cielo por zonas"),
                  ("pixelmath.html", "pm", "PixelMath-teca", "Fórmulas para copiar")],
        "planes": ("CabraPlanes", "Próximamente"),
        "install_q": "¿Algo para instalar en PixInsight?",
        "drawer_tools": "Úsalas ahora · sin instalar", "all_tools": "Todas las herramientas",
        "drawer_sub": ("Fotografía · Medidas", "Para instalar", "Novedades"),
        "contact": "Contacto",
        "foot_links": [("observaciones.html", "Observaciones"), ("herramientas.html", "Herramientas web"),
                       ("programas.html", "Programas"), ("bitacora.html", "Bitácora")],
    },
    "en": {
        "home": "en.html", "obs": "Observations", "prog": "Software", "bit": "Logbook",
        "herr": "Web tools", "night": "Night mode", "open": "Open menu", "close": "Close menu",
        "home_label": "CabraSpace, home", "main_nav": "Main", "foot_nav": "Footer",
        "foto": "Photography", "med": "Measurements", "latest": "Latest", "all_obs": "All observations",
        "items_foto": [("observaciones.html#cielo-profundo", "Deep sky", "Galaxies and nebulae"),
                       ("eclipse-2026.html", "Eclipses", "12 Aug 2026, on video")],
        "items_med": [("observaciones.html#exoplanetas", "Exoplanets", "Transit light curves")],
        "tools_head": "Open in your browser · nothing to install", "open_tool": "Open", "soon": "Coming soon",
        "tools": [("cabraspace-imaging-workflow.html", "web", "CabraSpace Web", "Processing in the browser · beta"),
                  ("astroforecast.html", "cloud", "Astro Forecast", "Tonight at AstroCamp"),
                  ("autoghs.html", "ghs", "AutoGHS", "Automatic GHS stretch"),
                  ("contaminacion-mapa.html", "globe", "Light pollution", "Sky brightness map"),
                  ("pixelmath.html", "pm", "PixelMath-teca", "Formulas ready to copy")],
        "planes": ("CabraPlanes", "Coming soon"),
        "install_q": "Looking for something to install in PixInsight?",
        "drawer_tools": "Use them now · nothing to install", "all_tools": "All web tools",
        "drawer_sub": ("Photography · Measurements", "Desktop software", "News"),
        "contact": "Contact",
        "foot_links": [("observaciones.html", "Observations"), ("herramientas.html", "Web tools"),
                       ("programas.html", "Software"), ("bitacora.html", "Logbook")],
    },
}


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


def latest_obs(lang):
    """Most recent observation in obs/observaciones.json (same data as tools/build_atlas.py)."""
    import json
    data = json.load(open(os.path.join(ROOT, "obs", "observaciones.json"), encoding="utf-8"))
    chrono = sorted(data, key=lambda o: o.get("date_iso") or "")
    o = chrono[-1]
    lam = ROMAN[len(chrono)]
    page = o.get("page") or {"transit": f"transito-{o['slug']}.html", "deep-sky": f"cielo-{o['slug']}.html"}.get(o["kind"], o["slug"] + ".html")
    y, m, d = o["date_iso"][:10].split("-")
    em = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    date = f"{int(d)} · {ROMAN[int(m)]}" if lang == "es" else f"{int(d)} {em[int(m) - 1]}"
    return {"href": page, "title": o.get("title_html", {}).get(lang, o["slug"]), "img": o.get("thumb"),
            "alt": o.get("title", {}).get(lang, o["slug"]), "fit": o["kind"] == "transit",
            "meta": (("Lám. " if lang == "es" else "Pl. ") + lam, date)}


ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV",
         "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"]


def header(fname):
    lang = lang_of(fname)
    t = TEXT[lang]
    lo = latest_obs(lang)
    es_file = fname if lang == "es" else twin_of(fname)
    en_file = fname if lang == "en" else twin_of(fname)
    mi = lambda items: "".join(f'<a href="{L(h, lang)}" class="mi"><b>{a}</b><span>{b}</span></a>' for h, a, b in items)
    tools = "".join(
        f'<a href="{L(h, lang)}" class="ti"><span class="med">{ICON[i]}</span><span><b>{n}</b><small>{d}</small></span>'
        f'<span class="go">{t["open_tool"]}</span></a>' for h, i, n, d in t["tools"])
    tools += (f'<span class="ti" style="opacity: .55"><span class="med" style="border-style: dashed">{ICON["planes"]}</span>'
              f'<span><b>{t["planes"][0]}</b><small>{t["planes"][1]}</small></span></span>')
    obs_panel = (
        '<div class="mega mega-obs"><div class="card" style="padding: 40px; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px">'
        f'<div style="grid-column: span 3; display: flex; flex-direction: column; gap: 4px"><span class="caps" style="color: var(--gold); padding: 0 18px 10px">{t["foto"]}</span>{mi(t["items_foto"])}</div>'
        f'<div style="grid-column: span 3; display: flex; flex-direction: column; gap: 4px"><span class="caps" style="color: var(--gold); padding: 0 18px 10px">{t["med"]}</span>{mi(t["items_med"])}</div>'
        f'<div style="grid-column: 7 / span 6; display: flex; flex-direction: column; gap: 14px; padding-left: 32px; border-left: 1px solid var(--line)">'
        f'<span class="caps" style="color: var(--t3)">{t["latest"]}</span>'
        f'<a href="{L(lo["href"], lang)}" class="zbox" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: center; color: var(--tx)">'
        f'<span class="plate" style="display: block; height: 190px; background: var(--bg)"><span class="plate-in" style="display: block; background: #1b140e"><img class="zoom{" fitc" if lo["fit"] else ""}" src="{lo["img"]}" alt="{lo["alt"]}" loading="lazy"></span></span>'
        f'<span style="display: flex; flex-direction: column; gap: 10px"><span class="cap" style="padding: 0"><span class="caps">{lo["meta"][0]}</span><span class="bd">{lo["meta"][1]}</span></span>'
        f'<span class="bd" style="font-size: 28px; line-height: 1.1">{lo["title"]}</span></span></a>'
        f'<a class="lnk" href="{L("observaciones.html", lang)}" style="margin-top: 6px">{t["all_obs"]}{ICON["arrow"]}</a></div></div></div>')
    herr_panel = (
        '<div class="mega mega-herr"><div class="card gold" style="padding: 28px 24px 22px">'
        f'<span class="caps" style="color: var(--gold); padding: 0 16px 12px">{t["tools_head"]}</span>'
        f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px">{tools}</div>'
        f'<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding: 16px 16px 0; border-top: 1px dotted rgba(199,191,169,.32)">'
        f'<span class="bd" style="font-size: 16px; font-style: italic; color: var(--t3)">{t["install_q"]}</span>'
        f'<a class="lnk" href="{L("programas.html", lang)}">{t["prog"]}</a></div></div></div>')
    return (
        f'<header id="navbar" class="ah">\n    {MARKER}\n'
        f'    <div class="ah-bar">\n'
        f'      <a href="{t["home"]}" class="ah-logo" aria-label="{t["home_label"]}"><img src="atlas/img/logo-gold.png" alt=""><span>CabraSpace</span></a>\n'
        f'      <nav class="ah-nav" aria-label="{t["main_nav"]}">\n'
        f'        <div class="mt"><a href="{L("observaciones.html", lang)}" class="nl" data-sec="obs">{t["obs"]}{ICON["chev"]}</a>{obs_panel}</div>\n'
        f'        <a href="{L("programas.html", lang)}" class="nl" data-sec="prog">{t["prog"]}</a>\n'
        f'        <a href="{L("bitacora.html", lang)}" class="nl" data-sec="bit">{t["bit"]}</a>\n'
        f'      </nav>\n'
        f'      <div class="ah-right">\n'
        f'        <div class="mt"><a href="{L("herramientas.html", lang)}" class="hw" data-sec="herr">{ICON["grid"]}<span class="hwl">{t["herr"]}</span></a>{herr_panel}</div>\n'
        f'        <button class="ic ah-night" type="button" aria-label="{t["night"]}" aria-pressed="false">{ICON["moon"]}</button>\n'
        f'        <span class="caps ah-lang"><a href="{es_file}" lang="es"{" class=\"on\"" if lang == "es" else ""}>ES</a> · <a href="{en_file}" lang="en"{" class=\"on\"" if lang == "en" else ""}>EN</a></span>\n'
        f'        <button class="ic ah-burger" type="button" aria-label="{t["open"]}" aria-controls="atlas-drawer" aria-expanded="false">{ICON["menu"]}</button>\n'
        f'      </div>\n'
        f'    </div>\n'
        f'    <div class="dbl" aria-hidden="true"></div>\n'
        f'  </header>')


def drawer(fname):
    lang = lang_of(fname)
    t = TEXT[lang]
    es_file = fname if lang == "es" else twin_of(fname)
    en_file = fname if lang == "en" else twin_of(fname)
    tiles = "".join(f'<a href="{L(h, lang)}" class="tile">{ICON[i]}{n}</a>' for h, i, n, _ in t["tools"][:4])
    sub = t["drawer_sub"]
    return (
        f'<div class="ad" id="atlas-drawer" hidden><div class="ad-in">\n'
        f'    <div class="ad-top"><a href="{t["home"]}"><img src="atlas/img/logo-gold.png" alt=""><span>CabraSpace</span></a>'
        f'<button class="ic ad-close" type="button" aria-label="{t["close"]}">{ICON["close"]}</button></div>\n'
        f'    <div class="ad-sec"><span class="caps" style="font-size: 11.5px; color: var(--gold)">{t["drawer_tools"]}</span>'
        f'<div class="ad-tiles">{tiles}</div><a class="lnk" href="{L("herramientas.html", lang)}" style="font-size: 14px">{t["all_tools"]}</a></div>\n'
        f'    <nav class="ad-sec" aria-label="{t["main_nav"]}" style="padding-top: 8px; gap: 0">'
        f'<a href="{L("observaciones.html", lang)}" class="acc"><i>I.</i><b>{t["obs"]}</b><small>{sub[0]}</small></a>'
        f'<a href="{L("programas.html", lang)}" class="acc"><i>II.</i><b>{t["prog"]}</b><small>{sub[1]}</small></a>'
        f'<a href="{L("bitacora.html", lang)}" class="acc sub"><i>III.</i><b>{t["bit"]}</b><small>{sub[2]}</small></a></nav>\n'
        f'    <div class="ad-foot"><button class="ic ah-night" type="button" aria-label="{t["night"]}" aria-pressed="false">{ICON["moon"]}</button>'
        f'<span class="caps ah-lang"><a href="{es_file}" lang="es"{" class=\"on\"" if lang == "es" else ""}>ES</a> · <a href="{en_file}" lang="en"{" class=\"on\"" if lang == "en" else ""}>EN</a></span></div>\n'
        f'  </div></div>')


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
    sign, tr = SIGNS.get(fname if lang == "es" else twin_of(fname), SIGN_DEFAULT)
    trans, source = tr[lang]
    long_ = " long" if len(sign) > 40 else ""
    links = "".join(f'<a class="nl" href="{L(h, lang)}">{n}</a>' for h, n in t["foot_links"])
    return (
        f'<footer class="af">\n'
        f'    <figure class="af-epi"><blockquote class="af-sign{long_}" lang="la">{sign}</blockquote>'
        f'<figcaption><span class="af-tr">{trans}</span><span class="caps af-src">{source}</span></figcaption></figure>\n'
        f'    <div class="af-links"><a class="ghost" href="https://www.youtube.com/@CabraSpace" target="_blank" rel="noopener noreferrer">YouTube</a>'
        f'<a class="ghost" href="mailto:info@cabraspace.com">{t["contact"]}</a></div>\n'
        f'    <div class="dbl" aria-hidden="true"></div>\n'
        f'    <div class="af-bottom"><span><img src="atlas/img/logo-gold.png" alt=""><span class="caps" style="font-size: 11.5px">CabraSpace · MMXXVI</span></span>'
        f'<nav aria-label="{t["foot_nav"]}">{links}</nav></div>\n'
        f'  </footer>')


CSS_LINK = f'<link rel="stylesheet" href="atlas/atlas.css?v={VERSION}">'
JS_TAG = f'<script src="atlas/atlas.js?v={VERSION}"></script>'
header_re = re.compile(r'<header id="navbar"[^>]*>.*?</header>', re.S)
drawer_re = re.compile(r'\s*<div class="ad" id="atlas-drawer" hidden>.*?\n  </div></div>', re.S)
overlay_re = re.compile(r'\s*<div class="mobile-menu-overlay"[^>]*>\s*</div>', re.S)
footer_re = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
css_re = re.compile(r'<link rel="stylesheet" href="atlas/atlas\.css[^"]*">')
js_re = re.compile(r'<script src="(?:mobile-menu\.js|atlas/atlas\.js)[^"]*"></script>')


def process(fname, txt):
    if not header_re.search(txt):
        return None
    # stylesheet after index.css (or before </head>)
    if css_re.search(txt):
        txt = css_re.sub(CSS_LINK, txt)
    elif "</head>" in txt:
        txt = txt.replace("</head>", f"  {CSS_LINK}\n</head>", 1)
    base = fname[:-len("-en.html")] if fname.endswith("-en.html") else fname[:-len(".html")]
    extra = EXTRA_CSS.get(base)
    if extra:
        link = f'<link rel="stylesheet" href="{extra}?v={VERSION}">'
        txt = re.sub(r'\s*<link rel="stylesheet" href="' + re.escape(extra) + r'[^"]*">', "", txt)
        txt = txt.replace(CSS_LINK, CSS_LINK + "\n  " + link, 1)
    # header + drawer
    txt = drawer_re.sub("", txt)
    txt = overlay_re.sub("", txt)
    txt = header_re.sub(lambda m: header(fname) + "\n  " + drawer(fname), txt, count=1)
    # footer
    if footer_re.search(txt):
        txt = footer_re.sub(lambda m: footer(fname), txt, count=1)
    elif fname in WITH_FOOTER:
        txt = txt.replace("</body>", f"  {footer(fname)}\n</body>", 1) if "<footer" not in txt else txt
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
    print(f"Cabecera/pie sincronizados: {changed} páginas actualizadas, {skipped} omitidas.")


if __name__ == "__main__":
    main()
