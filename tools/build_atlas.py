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
"""
import html
import json
import os

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

# Constellation of Capricornus for the home page (star positions from the Atlas style study).
STARS = [(285, 30, 2.6), (277, 58, 3), (206, 184, 2), (191, 203, 2), (93, 149, 2.5), (62, 114, 1.8), (35, 73, 3.3), (54, 80, 2.5), (105, 82, 1.9), (150, 86, 2.1)]
GREEK = [(293, 26, "α"), (286, 64, "β"), (21, 67, "δ"), (56, 70, "γ"), (87, 167, "ζ"), (199, 215, "ω")]
LINES = ["M285 30 L277 58", "M277 58 L150 86 L105 82 L54 80 L35 73", "M277 58 L206 184 L191 203 L93 149 L62 114 L35 73"]


def capricornus(lang):
    o = ['<svg class="carta" width="430" height="290" viewBox="-20 -10 370 250" role="img" aria-label="'
         + esc(T("Carta de la constelación de Capricornio", "Chart of the constellation Capricornus")(lang)) + '">']
    for x in (40, 165, 290):
        o.append(f'<path d="M{x} -10 L{x} 240" stroke="rgba(229,181,63,0.10)" stroke-width="0.6"></path>')
    for y in (40, 140):
        o.append(f'<path d="M-20 {y} L350 {y}" stroke="rgba(229,181,63,0.10)" stroke-width="0.6"></path>')
    for x, t in ((290, "XX h"), (165, "XXI h"), (40, "XXII h")):
        o.append(f'<text x="{x + 4}" y="236" font-family="Bodoni Moda, serif" font-style="italic" font-size="9" fill="rgba(229,181,63,0.45)">{t}</text>')
    for y, t in ((40, "−15°"), (140, "−25°")):
        o.append(f'<text x="-16" y="{y - 4}" font-family="Bodoni Moda, serif" font-style="italic" font-size="9" fill="rgba(229,181,63,0.45)">{t}</text>')
    o.append('<path d="M340 128 Q175 92 -18 22" fill="none" stroke="rgba(224,96,63,0.45)" stroke-width="1" stroke-dasharray="5 5"></path>')
    o.append('<text x="262" y="140" font-family="Bodoni Moda, serif" font-style="italic" font-size="11" fill="rgba(224,96,63,0.5)">'
             + T("eclíptica", "ecliptic")(lang) + '</text>')
    for d in LINES:
        o.append(f'<path d="{d}" fill="none" stroke="rgba(229,181,63,0.5)" stroke-width="1"></path>')
    for x, y, r in STARS:
        o.append(f'<circle cx="{x}" cy="{y}" r="{r + 3}" fill="#110d09"></circle><circle cx="{x}" cy="{y}" r="{r * 0.85:.2f}" fill="rgba(248,241,226,0.85)"></circle>')
    for x, y, t in GREEK:
        o.append(f'<text x="{x}" y="{y}" font-family="Bodoni Moda, serif" font-style="italic" font-size="12" fill="rgba(199,191,169,0.7)">{t}</text>')
    o.append("</svg>")
    return "".join(o)


# ---------------------------------------------------------------- shared text
TOOLS = [  # href, icon, name, short, long, tag
    ("cabraspace-imaging-workflow.html", "web", "CabraSpace Web",
     T("Procesa tu imagen en el navegador.", "Process your image in the browser."),
     T("Procesa tus imágenes en el navegador: estirado, máscaras, anotación y separación de estrellas.",
       "Process your images in the browser: stretching, masks, annotation and star separation."),
     T("Beta", "Beta")),
    ("astroforecast.html", "cloud", "Astro Forecast",
     T("Cómo será la noche en AstroCamp.", "Tonight at AstroCamp."),
     T("Probabilidad de abrir, consejos de adquisición y sensores en vivo para AstroCamp, en Nerpio.",
       "Chance of opening, acquisition advice and live sensors for AstroCamp, in Nerpio (Spain)."),
     T("Planificación", "Planning")),
    ("autoghs.html", "ghs", "AutoGHS",
     T("Estirado GHS automático.", "Automatic GHS stretch."),
     T("Estirado automático con Generalised Hyperbolic Stretch, directamente en la web.",
       "Automatic Generalised Hyperbolic Stretch, right in your browser."),
     T("Procesado", "Processing")),
    ("contaminacion-mapa.html", "globe", T("Contaminación lumínica", "Light pollution"),
     T("El brillo del cielo en tu zona.", "Sky brightness near you."),
     T("El mapa interactivo para elegir dónde montar.", "The interactive map to choose where to set up."),
     T("Planificación", "Planning")),
    ("pixelmath.html", "pm", "PixelMath-teca",
     T("Fórmulas listas para copiar.", "Formulas ready to copy."),
     T("Más de 100 fórmulas PixelMath agrupadas, con un simulador en tiempo real para SHO y RGB.",
       "Over 100 grouped PixelMath formulas, with a live simulator for SHO and RGB."),
     T("Consulta", "Reference")),
]

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
def page(lang, base, title, desc, body, og_image=None, extra_head="", extra_js=""):
    og = f'\n  <meta name="cabra:og-image" content="{SITE}/{og_image}">' if og_image else ""
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <link rel="icon" href="favicon_cabra.png" type="image/png">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">{og}
  <!-- ATLAS-PAGE: generada por tools/build_atlas.py; editar ahí y re-ejecutar -->
  <link rel="stylesheet" href="index.css?v=1.3">
  <link rel="stylesheet" href="atlas/atlas.css">{extra_head}
</head>
<body>
  <script>
    if (localStorage.getItem('night-vision') === 'enabled') {{ document.body.classList.add('night-vision'); }}
  </script>
  <header id="navbar"></header>
  <main class="a3 page">
    <div class="grain" aria-hidden="true"></div>
{body}
  </main>
  <footer></footer>
{extra_js}
</body>
</html>
"""


def kicker(text):
    return (f'<div style="display: flex; align-items: center; gap: 14px"><span style="width: 32px; height: 1px; background: var(--gold)"></span>'
            f'<span class="caps" style="color: var(--gold)">{text}</span></div>')


def sec_head(num, label, title_html, right_html=""):
    return (f'<div class="jb" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 32px">'
            f'<div style="display: flex; flex-direction: column; gap: 18px">'
            f'<div style="display: flex; align-items: center; gap: 14px"><span class="bd" style="font-size: 20px; font-style: italic; color: var(--gold)">{num}</span>'
            f'<span class="caps" style="color: var(--t2)">{label}</span></div>'
            f'<h2 class="bd" style="font-size: clamp(34px, 4vw, 58px); font-weight: 400; line-height: 1.04; letter-spacing: -0.02em">{title_html}</h2></div>'
            f'{right_html}</div>')


def page_title(lang, num, label, title_html, lead):
    return (f'<section style="position: relative; padding: clamp(40px, 6vw, 88px) var(--gx) clamp(32px, 5vw, 64px); display: flex; flex-direction: column; gap: 22px">'
            f'<div class="glow" aria-hidden="true"></div><div class="ret" aria-hidden="true"></div>'
            f'<div style="position: relative; display: flex; align-items: center; gap: 14px"><span class="bd" style="font-size: 20px; font-style: italic; color: var(--gold)">{num}</span>'
            f'<span class="caps" style="color: var(--t2)">{label}</span></div>'
            f'<h1 class="bd" style="position: relative; font-size: clamp(46px, 6.7vw, 96px); font-weight: 400; line-height: 0.98; letter-spacing: -0.02em">{title_html}</h1>'
            + (f'<p style="position: relative; max-width: 620px; font-size: 19px; line-height: 1.7; color: var(--t2)">{lead}</p>' if lead else "")
            + '</section>')


def plate_img(src, alt, height, fit=False, extra=""):
    cls = "zoom fitc" if fit else "zoom"
    bg = ' style="background: #1b140e"' if fit else ""
    return (f'<div class="plate" style="height: {height}px"><div class="plate-in"{bg}>'
            f'<img class="{cls}" src="{src}" alt="{esc(alt)}" loading="lazy">{extra}</div></div>')


def plate_ph(text, height):
    return f'<div class="plate" style="height: {height}px"><div class="plate-in"><div class="ph">{text}</div></div></div>'


# ---------------------------------------------------------------- observations
def load_obs():
    p = os.path.join(ROOT, "obs", "observaciones.json")
    data = json.load(open(p, encoding="utf-8"))
    data.sort(key=lambda o: o.get("date_iso") or "", reverse=True)
    # plate numbers (Lám. I, II…) in chronological order, stable over time
    for i, o in enumerate(sorted(data, key=lambda o: o.get("date_iso") or "")):
        o["_lam"] = roman(i + 1)
    return data


def obs_page(o):
    return o.get("page") or {"transit": f"transito-{o['slug']}.html", "deep-sky": f"cielo-{o['slug']}.html",
                              "eclipse": f"{o['slug']}.html"}[o["kind"]]


def obs_title(o, lang):
    t = o.get("title", {})
    return t.get(lang) or t.get("es") or o.get("object", o["slug"])


def obs_thumb(o):
    return o.get("thumb")


def obs_card(o, lang, height=300):
    lam = T(f"Lám. {o['_lam']}", f"Pl. {o['_lam']}")(lang)
    kind = tr(KIND[o["kind"]], lang)
    thumb = obs_thumb(o)
    fit = o["kind"] == "transit"
    media = plate_img(thumb, obs_title(o, lang), height, fit=fit) if thumb else plate_ph(esc(obs_title(o, lang)), height)
    return (f'<a href="{fname(obs_page(o), lang)}" class="zbox obs-card" data-fam="{FAMILY[o["kind"]]}" data-kind="{o["kind"]}" '
            f'style="display: flex; flex-direction: column; gap: 16px; color: var(--tx)">{media}'
            f'<div class="cap"><span class="caps">{lam}</span><span class="bd">{kind} · {short_date(o.get("date_iso"), lang)}</span></div>'
            f'<span class="bd" style="font-size: 27px; line-height: 1.15">{obs_title(o, lang)}'
            + (f' <span class="tg" style="vertical-align: middle; margin-left: 6px">{T("parcial", "partial")(lang)}</span>' if o.get("status") == "parcial" else "")
            + '</span></a>')


# ---------------------------------------------------------------- pages
def build_home(lang, obs):
    tools = "".join(
        f'<a class="card" href="{fname(h, lang)}" style="padding: 28px; min-height: 270px; background: var(--bg)">'
        f'<div style="display: flex; align-items: center; justify-content: space-between"><span class="med">{ICON[i]}</span>'
        + (f'<span class="tg g">{tr(tag, lang)}</span>' if h.startswith("cabraspace") else "") + '</div>'
        f'<span class="bd" style="margin-top: 26px; font-size: 24px; font-weight: 500; line-height: 1.12">{tr(n, lang)}</span>'
        f'<span style="margin-top: 10px; font-size: 15px; line-height: 1.6; color: var(--t2)">{tr(s, lang)}</span>'
        f'<span class="go" style="margin-top: auto; padding-top: 20px">{T("Abrir", "Open")(lang)}{ARROW}</span></a>'
        for h, i, n, s, _, tag in TOOLS)
    # newest of each kind first, so the home shows the variety of the work
    picks = []
    for k in ("transit", "eclipse", "deep-sky"):
        x = next((o for o in obs if o["kind"] == k), None)
        if x:
            picks.append(x)
    picks += [o for o in obs if o not in picks]
    latest = "".join(obs_card(o, lang) for o in picks[:3])
    eclipse = next((o for o in obs if o["kind"] == "eclipse"), None)
    news = (f'<a class="ann" href="{fname(obs_page(eclipse), lang)}" style="display: flex; align-items: center; gap: 16px; margin-top: 44px; padding: 16px 22px 16px 18px; max-width: 540px; box-sizing: border-box">'
            f'<span class="bd" style="flex-shrink: 0; font-size: 15px; font-style: italic; color: var(--gold2)">{T("Nuevo", "New")(lang)}</span>'
            f'<span style="width: 1px; height: 30px; background: var(--line); flex-shrink: 0"></span>'
            f'<span style="font-size: 15px; line-height: 1.5; color: var(--t2)">{T("Eclipse solar del 12 · VIII: el paso de la Luna, en vídeo.", "Solar eclipse of 12 August: the Moon crossing the Sun, on video.")(lang)}</span>'
            f'<span style="flex-shrink: 0; color: var(--gold)">{ARROW}</span></a>') if eclipse else ""
    cards = [
        ("observaciones.html", "obs", T("Observaciones", "Observations"), "Nº I", "",
         T("Fotografía y medidas: cielo profundo, tránsitos de exoplanetas y el eclipse.", "Photography and measurements: deep sky, exoplanet transits and the eclipse.")),
        ("herramientas.html", "web", T('Herramientas <em class="gi">web</em>', 'Web <em class="gi">tools</em>'), "Nº II", T("Sin instalar", "No installation"),
         T("CabraSpace Web, Astro Forecast, AutoGHS, contaminación lumínica y PixelMath-teca.", "CabraSpace Web, Astro Forecast, AutoGHS, light pollution and PixelMath-teca.")),
        ("programas.html", "down", T("Programas", "Software"), "Nº III", "",
         T("Para instalar en PixInsight: PI Workflow.", "For PixInsight: PI Workflow.")),
    ]
    index = "".join(
        f'<a class="card{" gold" if tag else ""}" href="{fname(h, lang)}" style="padding: 30px; min-height: 250px">'
        f'<span style="display: flex; justify-content: space-between; align-items: center"><span class="med">{ICON[ic]}</span>'
        f'<span style="display: flex; gap: 12px; align-items: center">' + (f'<span class="tg g">{tr(tag, lang)}</span>' if tag else "")
        + f'<span class="no">{no}</span></span></span>'
        f'<span class="bd" style="margin-top: 24px; font-size: 30px; font-weight: 500">{tr(t, lang)}</span>'
        f'<span style="margin-top: 8px; font-size: 15.5px; line-height: 1.6; color: var(--t2)">{tr(d, lang)}</span></a>'
        for h, ic, t, no, tag, d in cards)
    body = f"""
    <section class="g12" style="position: relative; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; align-items: center; padding: clamp(40px, 6vw, 88px) var(--gx) clamp(40px, 5vw, 72px)">
      <div class="glow" aria-hidden="true"></div><div class="ret" aria-hidden="true"></div>
      <div class="c7" style="position: relative; grid-column: span 7; display: flex; flex-direction: column; align-items: flex-start">
        {kicker(T("Fotografía · Medidas · Herramientas", "Photography · Measurements · Tools")(lang))}
        <h1 class="bd" style="margin-top: 34px; font-size: clamp(46px, 7.2vw, 104px); font-weight: 400; line-height: 0.96; letter-spacing: -0.02em">{T('Fotografía y <em class="gi">medidas</em> del cielo', 'Photographing and <em class="gi">measuring</em> the sky')(lang)}</h1>
        <p style="margin-top: 32px; max-width: 540px; font-size: 19px; line-height: 1.7; color: var(--t2)">{T("Cielo profundo, el eclipse y curvas de luz de exoplanetas desde el observatorio de Nerpio. Y las herramientas con que lo hago, abiertas a todos.", "Deep sky, the eclipse and exoplanet light curves from the Nerpio observatory. And the tools I use to do it, open to everyone.")(lang)}</p>
        {news}
      </div>
      <figure class="c5" style="position: relative; grid-column: 8 / span 5; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 18px">
        {capricornus(lang)}
        <figcaption class="cap"><span class="caps">{T("Carta I", "Chart I")(lang)}</span><span class="bd">{T("Capricornus, la cabra del cielo", "Capricornus, the sky goat")(lang)}</span></figcaption>
      </figure>
    </section>

    <section class="g3" style="padding: 0 var(--gx) clamp(56px, 8vw, 112px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">
      {index}
    </section>

    <section style="display: flex; flex-direction: column; gap: 44px; margin: 0 var(--gb); padding: clamp(40px, 6vw, 80px) var(--gb) 64px; border-radius: 36px; background: var(--s1); border: 1px solid var(--line)">
      {sec_head("I.", T("Herramientas web", "Web tools")(lang), T('Úsalas <em class="gi">ahora</em>', 'Use them <em class="gi">now</em>')(lang),
                f'<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 12px; margin-bottom: 8px"><span style="font-size: 15px; color: var(--t3)">{T("Se abren en el navegador, sin instalar nada", "Open in your browser, nothing to install")(lang)}</span><a class="lnk" href="{fname("herramientas.html", lang)}">{T("Todas las herramientas", "All web tools")(lang)}{ARROW}</a></div>')}
      <div class="g5" style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px">{tools}</div>
    </section>

    <section style="display: flex; flex-direction: column; gap: 56px; padding: clamp(64px, 9vw, 128px) var(--gx) clamp(56px, 8vw, 112px)">
      {sec_head("II.", T("Observaciones", "Observations")(lang), T('Lo último en <em class="gi">el cuaderno</em>', 'Latest in <em class="gi">the notebook</em>')(lang),
                f'<a class="lnk" href="{fname("observaciones.html", lang)}" style="margin-bottom: 8px">{T("Ver todas", "See all")(lang)}{ARROW}</a>')}
      <div class="g3" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px">{latest}</div>
    </section>

    <section class="g12" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 0 var(--gx) 120px">
      <div class="c7" style="grid-column: span 7; display: flex; flex-direction: column; gap: 24px">
        <div class="jb" style="display: flex; align-items: center; justify-content: space-between"><div style="display: flex; align-items: center; gap: 14px"><span class="bd" style="font-size: 20px; font-style: italic; color: var(--gold)">III.</span><span class="caps" style="color: var(--t2)">{T("Programas para instalar", "Software to install")(lang)}</span></div>
        <a class="lnk" href="{fname("programas.html", lang)}">{T("Ver programas", "View software")(lang)}{ARROW}</a></div>
        <a class="card frow" href="{fname("programas.html", lang)}" style="flex-direction: row; align-items: center; gap: 18px; padding: 24px"><span class="med">{ICON["down"]}</span><span style="display: flex; flex-direction: column; gap: 4px"><span class="bd" style="font-size: 24px; font-weight: 500">PI Workflow</span><span style="font-size: 14.5px; color: var(--t3)">{T("Script para PixInsight · Windows y macOS", "PixInsight script · Windows and macOS")(lang)}</span></span></a>
      </div>
      <div class="c4" style="grid-column: 9 / span 4; display: flex; flex-direction: column">
        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--line)"><span class="caps" style="color: var(--t3)">{T("Bitácora", "Logbook")(lang)}</span><a class="lnk" href="{fname("bitacora.html", lang)}" style="font-size: 14px">{T("Todo", "All")(lang)}</a></div>
        <div id="home-log" data-lang="{lang}"></div>
      </div>
    </section>"""
    js = f"""  <script>
  (function () {{
    var box = document.getElementById('home-log'); if (!box) return;
    var en = box.getAttribute('data-lang') === 'en';
    var M = en ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    function d(s) {{ var p = (s || '').split('-'); return p.length < 3 ? '' : (en ? (+p[2]) + ' ' + M[+p[1] - 1] : (+p[2]) + ' · ' + M[+p[1] - 1]); }}
    function esc(s) {{ var e = document.createElement('span'); e.textContent = s || ''; return e.innerHTML; }}
    fetch('latest.json').then(function (r) {{ return r.json(); }}).then(function (j) {{
      var all = (j.software || []).concat(j.hardware || []).sort(function (a, b) {{ return (b.date || '').localeCompare(a.date || ''); }}).slice(0, 3);
      box.innerHTML = all.map(function (x) {{
        return '<a class="row" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer" style="grid-template-columns: 64px minmax(0, 1fr); padding: 14px 4px">'
          + '<span class="bd rd" style="font-size: 15px">' + d(x.date) + '</span><span class="rt" style="font-size: 15px; line-height: 1.45; color: var(--t2)">'
          + esc(en ? x.title_en : x.title_es) + '</span></a>';
      }}).join('');
    }}).catch(function () {{ box.innerHTML = ''; }});
  }})();
  </script>"""
    title = T("CabraSpace · Fotografía y medidas del cielo", "CabraSpace · Photographing and measuring the sky")(lang)
    desc = T("Astrofotografía de cielo profundo, tránsitos de exoplanetas y el eclipse de 2026 desde Nerpio, y herramientas web gratuitas para procesar y planificar.",
             "Deep-sky astrophotography, exoplanet transits and the 2026 eclipse from Nerpio, plus free web tools to process and plan.")(lang)
    return page(lang, "index.html", title, desc, body, extra_js=js)


def build_observaciones(lang, obs):
    kinds = [k for k in ("deep-sky", "eclipse", "transit") if any(o["kind"] == k for o in obs)]
    chips = [f'<button type="button" class="chip on" data-f="all">{T("Todo", "All")(lang)}</button>']
    for fam, label in (("foto", T("Fotografía", "Photography")), ("med", T("Medidas", "Measurements"))):
        ks = [k for k in kinds if FAMILY[k] == fam]
        if not ks:
            continue
        chips.append('<span style="width: 1px; height: 28px; background: var(--line); margin: 0 6px"></span>')
        chips.append(f'<span class="bd" style="font-size: 17px; font-style: italic; color: var(--t3)">{label(lang)}</span>')
        for k in ks:
            chips.append(f'<button type="button" class="chip" data-f="{k}" data-anchor="{ANCHOR[k]}">{tr(KIND[k], lang)}</button>')
    eclipse = next((o for o in obs if o["kind"] == "eclipse"), None)
    feature = ""
    if eclipse:
        poster = eclipse.get("poster")
        media = (f'<img class="zoom" src="{poster}" alt="{esc(obs_title(eclipse, lang))}" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #0d0a07">'
                 if poster else f'<div class="ph">{esc(obs_title(eclipse, lang))}</div>')
        feature = f"""
    <section id="serie" style="padding: 0 var(--gx) clamp(48px, 7vw, 96px)">
      <a href="{fname(obs_page(eclipse), lang)}" class="card gold g12 zbox" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 16px; border-radius: 36px">
        <div class="c7" style="grid-column: span 7; height: 440px; position: relative; border-radius: 24px; overflow: hidden">{media}<span class="play">{ICON["play"]}</span></div>
        <div class="c5" style="grid-column: span 5; padding: 40px 32px 40px 8px; display: flex; flex-direction: column; justify-content: center; gap: 20px">
          <span style="display: flex; gap: 12px; align-items: center"><span class="tg g">{T("Serie", "Series")(lang)}</span><span class="no">{T("Vídeo", "Video")(lang)}</span></span>
          <span class="bd" style="font-size: clamp(34px, 3.6vw, 52px); font-weight: 400; line-height: 1.04; letter-spacing: -0.02em">{T('Eclipse solar, <em class="gi">doce de agosto</em>', 'Solar eclipse, <em class="gi">twelfth of August</em>')(lang)}</span>
          <span style="font-size: 17px; line-height: 1.7; color: var(--t2)">{T("El eclipse del 12 de agosto de 2026 en vídeo, con la Vaonis Vespera Pro.", "The eclipse of 12 August 2026 on video, with the Vaonis Vespera Pro.")(lang)}</span>
          <span class="go" style="font-size: 15.5px; color: var(--gold2)">{T("Ver la serie", "Watch the series")(lang)}{ARROW}</span>
        </div>
      </a>
    </section>"""
    grid = "\n".join(obs_card(o, lang, 310) for o in obs if o["kind"] != "eclipse")
    body = page_title(lang, "Nº I", T("Fotografía y medidas", "Photography and measurements")(lang),
                      T('El <em class="gi">cuaderno</em> de observación', 'The observing <em class="gi">notebook</em>')(lang),
                      T("Lo que hago desde el observatorio de Nerpio: imágenes de cielo profundo, curvas de luz de tránsitos de exoplanetas y el eclipse de 2026.",
                        "What I do from the Nerpio observatory: deep-sky images, exoplanet transit light curves and the 2026 eclipse.")(lang))
    body = body.replace("</section>", f'<div style="position: relative; display: flex; align-items: center; gap: 12px; margin-top: 18px; flex-wrap: wrap">{"".join(chips)}</div></section>', 1)
    body += feature
    body += f"""
    <section class="g3" style="padding: 0 var(--gx) clamp(72px, 9vw, 128px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 64px 32px">
{grid}
    </section>"""
    js = """  <script>
  (function () {
    var chips = document.querySelectorAll('[data-f]');
    function apply(f) {
      chips.forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-f') === f); });
      document.querySelectorAll('.obs-card').forEach(function (i) {
        i.style.display = (f === 'all' || i.getAttribute('data-kind') === f) ? '' : 'none';
      });
      var s = document.getElementById('serie'); if (s) s.style.display = (f === 'all' || f === 'eclipse') ? '' : 'none';
    }
    chips.forEach(function (c) { c.addEventListener('click', function () {
      var f = c.getAttribute('data-f'); apply(f);
      history.replaceState(null, '', f === 'all' ? location.pathname : '#' + c.getAttribute('data-anchor'));
    }); });
    function fromHash() {
      var h = location.hash.slice(1); if (!h) return;
      var c = document.querySelector('[data-anchor="' + h + '"]'); if (c) apply(c.getAttribute('data-f'));
    }
    window.addEventListener('hashchange', fromHash); fromHash();
  })();
  </script>"""
    first_img = next((obs_thumb(o) for o in obs if obs_thumb(o) and o["kind"] == "deep-sky"), None)
    return page(lang, "observaciones.html", T("Observaciones · CabraSpace", "Observations · CabraSpace")(lang),
                T("Imágenes de cielo profundo, tránsitos de exoplanetas y el eclipse de 2026 desde el observatorio de Nerpio.",
                  "Deep-sky images, exoplanet transits and the 2026 eclipse from the Nerpio observatory.")(lang),
                body, og_image=first_img, extra_js=js)


def build_herramientas(lang):
    feat = TOOLS[0]
    rest = "".join(
        f'<a class="card" href="{fname(h, lang)}" style="padding: 34px; min-height: 280px">'
        f'<div style="display: flex; align-items: center; justify-content: space-between"><span class="med">{ICON[i]}</span>'
        f'<span style="display: flex; align-items: center; gap: 14px"><span class="tg">{tr(tag, lang)}</span><span class="no">Nº {roman(k + 2)}</span></span></div>'
        f'<span class="bd" style="margin-top: 30px; font-size: 30px; font-weight: 500; line-height: 1.12">{tr(n, lang)}</span>'
        f'<span style="margin-top: 12px; font-size: 16px; line-height: 1.65; color: var(--t2)">{tr(lng, lang)}</span>'
        f'<span class="go" style="margin-top: auto; padding-top: 24px">{T("Abrir", "Open")(lang)}{ARROW}</span></a>'
        for k, (h, i, n, s, lng, tag) in enumerate(TOOLS[1:]))
    body = page_title(lang, "Nº II", T("Úsalas ahora · sin instalar nada", "Use them now · nothing to install")(lang),
                      T('Herramientas <em class="gi">web</em>', 'Web <em class="gi">tools</em>')(lang),
                      T("Se abren en el navegador. No hace falta instalar nada ni crear cuenta.",
                        "They open in your browser. Nothing to install, no account needed.")(lang))
    body += f"""
    <section style="padding: 0 var(--gx) 40px">
      <div class="card gold g12" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 16px; border-radius: 36px">
        <a href="{fname(feat[0], lang)}" class="c7 zbox" style="grid-column: span 7; height: 460px; position: relative; border-radius: 24px; overflow: hidden; display: block"><img class="zoom" src="atlas/img/cabraspace-web.jpg" alt="{T("La herramienta CabraSpace Web", "The CabraSpace Web tool")(lang)}" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: left top"></a>
        <div class="c5" style="grid-column: span 5; padding: 44px 36px 44px 8px; display: flex; flex-direction: column; justify-content: center; gap: 20px">
          <span style="display: flex; gap: 14px; align-items: center"><span class="tg g">Beta</span><span class="no">{T("Nº I · la principal", "Nº I · Flagship")(lang)}</span></span>
          <span class="bd" style="font-size: clamp(38px, 3.8vw, 54px); font-weight: 400; line-height: 1.02; letter-spacing: -0.02em">CabraSpace <em class="gi">Web</em></span>
          <span style="font-size: 17px; line-height: 1.7; color: var(--t2)">{tr(feat[4], lang)}</span>
          <span style="display: flex; gap: 16px; align-items: center; margin-top: 10px; flex-wrap: wrap"><a class="btn" href="{fname(feat[0], lang)}">{T("Abrir CabraSpace Web", "Open CabraSpace Web")(lang)}{ARROW}</a></span>
        </div>
      </div>
    </section>
    <section class="g2" style="padding: 0 var(--gx) 56px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px">
      {rest}
    </section>
    <section style="padding: 0 var(--gx) 64px">
      <div class="card dash frow" style="flex-direction: row; align-items: center; gap: 24px; padding: 28px 32px">
        <span class="med" style="border-style: dashed; color: var(--t3); border-color: var(--line)">{ICON["planes"]}</span>
        <span style="display: flex; flex-direction: column; gap: 6px; flex-grow: 1"><span style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap"><span class="bd" style="font-size: 26px; font-weight: 500">CabraPlanes</span><span class="tg">{T("Próximamente", "Coming soon")(lang)}</span></span>
        <span style="font-size: 15.5px; color: var(--t3)">{T("Qué aviones cruzarán el Sol o la Luna desde donde estás.", "Which aircraft will transit the Sun or the Moon from your location.")(lang)}</span></span>
      </div>
    </section>
    <section style="margin: 0 var(--gx) 120px">
      <div class="dbl" aria-hidden="true"></div>
      <div class="jb" style="display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-top: 28px">
        <span class="bd" style="font-size: 22px; font-style: italic; color: var(--t2)">{T("¿Necesitas algo que corra dentro de PixInsight?", "Need something that runs inside PixInsight?")(lang)}</span>
        <a class="ghost" href="{fname("programas.html", lang)}">{T("Programas para instalar", "Software to install")(lang)}</a>
      </div>
    </section>"""
    return page(lang, "herramientas.html", T("Herramientas web · CabraSpace", "Web tools · CabraSpace")(lang),
                T("Herramientas gratuitas en el navegador para astrofotografía: CabraSpace Web, Astro Forecast, AutoGHS, mapa de contaminación lumínica y PixelMath-teca.",
                  "Free in-browser astrophotography tools: CabraSpace Web, Astro Forecast, AutoGHS, light pollution map and PixelMath-teca.")(lang), body)


WORKSHOP = [
    ("CabraSolar", T("Apilado, deconvolución y realce del Sol en H-alfa.", "Stacking, deconvolution and sharpening of the Sun in H-alpha.")),
    ("CabraEclipse", T("Procesado de eclipses totales al estilo Druckmüller.", "Total-eclipse processing, Druckmüller style.")),
    ("CabraTransit", T("Fotometría de tránsitos de exoplanetas, del FITS a la curva de luz.", "Exoplanet transit photometry, from FITS to light curve.")),
]


def build_programas(lang):
    ws = "".join(f'<div class="card dash" style="padding: 28px; gap: 10px"><span class="bd" style="font-size: 26px; font-weight: 500">{n}</span>'
                 f'<span style="font-size: 15px; line-height: 1.6; color: var(--t3)">{d(lang)}</span></div>' for n, d in WORKSHOP)
    body = page_title(lang, "Nº III", T("Para instalar en tu equipo", "To install on your computer")(lang),
                      T('<em class="gi">Programas</em>', '<em class="gi">Software</em>')(lang),
                      T("Scripts que se descargan, cada uno con su instalación paso a paso y su historial de cambios.",
                        "Downloadable scripts, each with step-by-step installation and a changelog.")(lang))
    body += f"""
    <section style="padding: 0 var(--gx)">
      <div class="card g12" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 16px; border-radius: 36px">
        <div class="c6 zbox" style="grid-column: span 6; height: 440px; position: relative; border-radius: 24px; overflow: hidden"><img class="zoom" src="atlas/img/piw-ui.jpg" alt="{T("PI Workflow en PixInsight, pestaña de preprocesado", "PI Workflow in PixInsight, pre-processing tab")(lang)}" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 20%"></div>
        <div class="c6" style="grid-column: span 6; padding: 36px 36px 36px 8px; display: flex; flex-direction: column; gap: 16px">
          <span style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap"><span class="tg g">{T("Script de PixInsight", "PixInsight script")(lang)}</span><span class="tg">Windows · macOS</span><span class="no" style="margin-left: auto">Nº I</span></span>
          <span class="bd" style="font-size: clamp(38px, 3.5vw, 50px); font-weight: 400; line-height: 1.02; letter-spacing: -0.02em">PI <em class="gi">Workflow</em></span>
          <span style="font-size: 16.5px; line-height: 1.7; color: var(--t2)">{T("Flujo de procesado unificado dentro de PixInsight: preprocesado, estirado, postprocesado y combinación de canales en una sola ventana.", "A unified processing workflow inside PixInsight: pre-processing, stretching, post-processing and channel combination in a single window.")(lang)}</span>
          <div>
            <div class="kv"><span>{T("Requiere", "Requires")(lang)}</span><span>PixInsight 1.9.4+</span></div>
            <div class="kv"><span>{T("Instalación", "Install")(lang)}</span><span>{T("Repositorio de actualizaciones", "Update repository")(lang)}</span></div>
            <div class="kv"><span>{T("Código", "Source")(lang)}</span><span><a href="https://github.com/Ninocabra/PI-Workflow" target="_blank" rel="noopener noreferrer">GitHub · PI-Workflow</a></span></div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px" id="changelog" data-lang="{lang}"></div>
          <span style="display: flex; gap: 14px; align-items: center; margin-top: auto; padding-top: 10px; flex-wrap: wrap"><a class="btn" href="{fname("cabrascripts.html", lang)}#pi-workflow">{T("Cómo instalarlo", "How to install")(lang)}{ARROW}</a><a class="lnk" href="https://github.com/Ninocabra/PI-Workflow/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">{T("Historial de cambios", "Changelog")(lang)}</a></span>
        </div>
      </div>
    </section>
    <section style="display: flex; flex-direction: column; gap: 28px; padding: clamp(64px, 8vw, 104px) var(--gx) 120px">
      {sec_head('<span style="color: var(--ver)">·</span>', T("En el taller", "In the workshop")(lang), T('Aún <em class="gi">sin publicar</em>', 'Not <em class="gi">released yet</em>')(lang),
                f'<span class="bd" style="font-size: 16px; font-style: italic; color: var(--t3); margin-bottom: 8px">{T("Programas en los que trabajo; saldrán cuando estén listos.", "Programs I am working on; they will be released when ready.")(lang)}</span>')}
      <div class="g3" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">{ws}</div>
    </section>"""
    js = """  <script>
  (function () {
    var box = document.getElementById('changelog'); if (!box) return;
    var en = box.getAttribute('data-lang') === 'en';
    var url = 'https://raw.githubusercontent.com/Ninocabra/PI-Workflow/main/' + (en ? 'CHANGELOG.md' : 'CHANGELOG.es.md');
    fetch(url).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
      var heads = t.split('\\n').filter(function (l) { return /^##\\s+/.test(l); }).slice(0, 3);
      if (!heads.length) return;
      var e = document.createElement('span'); e.className = 'caps'; e.style.cssText = 'color: var(--t3); padding: 8px 2px'; e.textContent = en ? 'Latest versions' : 'Últimas versiones'; box.appendChild(e);
      heads.forEach(function (h) {
        var s = document.createElement('span'); s.className = 'kv'; var a = document.createElement('span'); var b = document.createElement('span');
        var txt = h.replace(/^##\\s+/, '').replace(/[\\[\\]]/g, ''); var m = txt.match(/^(\\S+)\\s*[-–—]?\\s*(.*)$/);
        a.textContent = m ? m[1] : txt; b.textContent = m ? m[2] : ''; s.appendChild(a); s.appendChild(b); box.appendChild(s);
      });
    }).catch(function () {});
  })();
  </script>"""
    return page(lang, "programas.html", T("Programas · CabraSpace", "Software · CabraSpace")(lang),
                T("PI Workflow, flujo de procesado unificado para PixInsight, y los programas en preparación de CabraSpace.",
                  "PI Workflow, a unified processing workflow for PixInsight, and the CabraSpace programs in the works.")(lang),
                body, extra_js=js)


def build_bitacora(lang):
    kinds = [("all", T("Todo", "All")), ("hw", T("Equipo", "Equipment")), ("sw", T("Software", "Software")), ("yt", T("Cursos", "Courses"))]
    fb = "".join(f'<button type="button" class="fb{" on" if k == "all" else ""}" data-k="{k}">{l(lang)}<small data-n="{k}"></small></button>' for k, l in kinds)
    more = [("equipamiento.html", T("Catálogo de equipo", "Equipment catalogue")), ("novedades.html", T("Novedades de software", "Software news")),
            ("cursos-youtube.html", T("Cursos de YouTube", "YouTube courses")), ("contaminacion.html", T("Contaminación lumínica: vídeos y guías", "Light pollution: videos and guides")),
            ("divulgacion-coffeebreak.html", T("Archivo: Coffee Break, señal y ruido", "Archive: Coffee Break podcast"))]
    more_html = "".join(f'<a class="row" href="{fname(h, lang)}" style="grid-template-columns: minmax(0, 1fr) auto; padding: 14px 6px"><span class="rt" style="font-size: 15px">{l(lang)}</span><span class="rd">{ARROW}</span></a>' for h, l in more)
    body = f"""
    <section class="jb" style="padding: clamp(40px, 6vw, 80px) var(--gx) 48px; display: flex; align-items: flex-end; justify-content: space-between; gap: 48px">
      <div style="display: flex; flex-direction: column; gap: 20px">
        <div style="display: flex; align-items: center; gap: 14px"><span class="bd" style="font-size: 20px; font-style: italic; color: var(--gold)">Nº IV</span><span class="caps" style="color: var(--t2)">{T("Registro", "Record")(lang)}</span></div>
        <h1 class="bd" style="font-size: clamp(46px, 5vw, 72px); font-weight: 400; line-height: 1; letter-spacing: -0.02em; color: var(--t2)">{T('Bitá<em class="gi">cora</em>', 'Log<em class="gi">book</em>')(lang)}</h1>
      </div>
      <p style="margin-bottom: 8px; max-width: 460px; font-size: 16.5px; line-height: 1.7; color: var(--t3)">{T("Novedades de equipo y de software y cursos, recopilados cada día. Se consulta, no se anuncia.", "Equipment and software news and courses, collected every day. For browsing, not announcing.")(lang)}</p>
    </section>
    <section class="g12" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 0 var(--gx) 120px">
      <aside class="c3" aria-label="{T("Filtros", "Filters")(lang)}" style="grid-column: span 3; display: flex; flex-direction: column; gap: 6px">
        {fb}
        <div style="margin-top: 28px; display: flex; flex-direction: column"><span class="caps" style="color: var(--t3); padding: 0 6px 8px">{T("Catálogos completos", "Full catalogues")(lang)}</span>{more_html}</div>
      </aside>
      <div class="c8" style="grid-column: 5 / span 8; display: flex; flex-direction: column">
        <h2 class="bd" id="bh" style="padding: 0 8px 14px; font-size: 22px; font-weight: 400; font-style: italic; color: var(--t2); border-bottom: 1px solid var(--line)">{T("Todo, lo más reciente primero", "Everything, newest first")(lang)}</h2>
        <div id="log" data-lang="{lang}"><p style="padding: 24px 8px; color: var(--t3)">{T("Cargando…", "Loading…")(lang)}</p></div>
        <div style="display: flex; justify-content: center; padding-top: 36px"><button type="button" class="ghost" id="more" style="background: transparent; cursor: pointer">{T("Cargar más", "Load more")(lang)}</button></div>
      </div>
    </section>"""
    js = """  <script>
  (function () {
    var box = document.getElementById('log'); if (!box) return;
    var en = box.getAttribute('data-lang') === 'en';
    var M = en ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    var LBL = en ? { all: 'Everything, newest first', hw: 'Equipment', sw: 'Software', yt: 'Courses' } : { all: 'Todo, lo más reciente primero', hw: 'Equipo', sw: 'Software', yt: 'Cursos' };
    var TAG = en ? { hw: 'Equipment', sw: 'Software', yt: 'Course' } : { hw: 'Equipo', sw: 'Software', yt: 'Curso' };
    function d(s) { var p = (s || '').split('-'); return p.length < 3 ? '' : (en ? (+p[2]) + ' ' + M[+p[1] - 1] : (+p[2]) + ' · ' + M[+p[1] - 1]); }
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
      var list = rows.filter(function (r) { return k === 'all' || r.k === k; });
      box.innerHTML = list.slice(0, shown).map(function (r) {
        return '<a class="row" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer" style="grid-template-columns: 84px minmax(0, 1fr) auto">'
          + '<span class="bd rd" style="font-size: 16px; padding-top: 1px">' + (r.date ? d(r.date) : '—') + '</span>'
          + '<span style="display: flex; flex-direction: column; gap: 4px"><span class="rt" style="font-size: 17px; line-height: 1.5">' + esc(r.t) + '</span>'
          + '<span class="bd" style="font-size: 14.5px; font-style: italic; color: var(--t3)">' + esc(r.src || '') + (r.rel ? ' · ' + esc(r.rel) : '') + '</span></span>'
          + '<span class="tg" style="align-self: center">' + TAG[r.k] + '</span></a>';
      }).join('') || '<p style="padding: 24px 8px; color: var(--t3)">—</p>';
      document.getElementById('more').style.display = list.length > shown ? '' : 'none';
    }
    document.querySelectorAll('[data-k]').forEach(function (b) { b.addEventListener('click', function () {
      k = b.getAttribute('data-k'); shown = 25;
      document.querySelectorAll('[data-k]').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.getElementById('bh').textContent = LBL[k]; render();
    }); });
    document.getElementById('more').addEventListener('click', function () { shown += 25; render(); });
  })();
  </script>"""
    return page(lang, "bitacora.html", T("Bitácora · CabraSpace", "Logbook · CabraSpace")(lang),
                T("Novedades de equipo y software de astrofotografía y cursos de PixInsight, recopilados cada día.",
                  "Astrophotography equipment and software news and PixInsight courses, collected every day.")(lang), body, extra_js=js)


# ---------------------------------------------------------------- per-observation pages
def breadcrumb(lang, items):
    parts = []
    for i, (href, label) in enumerate(items):
        if i:
            parts.append('<span class="bd" style="font-style: italic; color: var(--t3)">›</span>')
        parts.append(f'<a class="lnk" href="{href}" style="font-size: 14px">{label}</a>' if href else f'<span style="font-size: 14px; color: var(--t3)">{label}</span>')
    return f'<nav aria-label="{T("Ruta", "Breadcrumb")(lang)}" style="padding: 36px var(--gx) 0; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap">{"".join(parts)}</nav>'


def kv_rows(rows):
    return "".join(f'<div class="kv"><span>{esc(k)}</span><span>{v}</span></div>' for k, v in rows if v)


def neighbours(o, obs, lang):
    same = [x for x in obs if x["kind"] == o["kind"] and x is not o]
    return "".join(obs_card(x, lang, 200) for x in same[:3])


def build_obs_page(o, obs, lang):
    title = obs_title(o, lang)
    lam = T(f"Lám. {o['_lam']}", f"Pl. {o['_lam']}")(lang)
    notes = (o.get("notes") or {}).get(lang) or (o.get("notes") or {}).get("es") or ""
    facts = o.get("facts_display", {}).get(lang) or o.get("facts_display", {}).get("es") or []
    media = o.get("media", [])  # list of {type: image|video|plot, src, alt{es,en}, caption{es,en}, poster}
    blocks = []
    for i, m in enumerate(media):
        alt = (m.get("alt") or {}).get(lang) or title
        cap = (m.get("caption") or {}).get(lang) or ""
        h = m.get("height", 470 if i == 0 else 300)
        if m["type"] == "video":
            inner = (f'<video controls preload="none" playsinline poster="{m.get("poster", "")}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000">'
                     f'<source src="{m["src"]}" type="video/mp4"></video>')
            fig = f'<div class="plate" style="height: {h}px"><div class="plate-in">{inner}</div></div>'
        else:
            fit = m["type"] == "plot" or m.get("fit")
            fig = (f'<a href="{m.get("full", m["src"])}" target="_blank" rel="noopener" class="zbox" style="display: block">'
                   + plate_img(m["src"], alt, h, fit=fit) + "</a>")
        blocks.append(f'<figure style="margin: 0; display: flex; flex-direction: column; gap: 14px">{fig}'
                      + (f'<figcaption class="cap"><span class="caps">Fig. {i + 1}</span><span class="bd">{cap}</span></figcaption>' if cap else "") + '</figure>')
    main_col = blocks[0] if blocks else ""
    if o.get("phases"):
        discs = "".join(
            f'<a href="{ph["src"]}" target="_blank" rel="noopener" style="display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--t3)">'
            f'<img src="{ph["src"]}" alt="{T("El Sol a las", "The Sun at")(lang)} {ph["time"]} UTC" loading="lazy" '
            f'style="width: 100%; max-width: 120px; aspect-ratio: 1; border-radius: 50%; object-fit: cover; border: 1px solid var(--line)">'
            f'<span class="bd" style="font-style: italic; font-size: 14px">{ph["time"]}</span></a>' for ph in o["phases"])
        main_col += (f'<div style="display: flex; flex-direction: column; gap: 18px; padding: 28px; border-radius: 22px; background: var(--s1); border: 1px solid var(--line)">'
                     f'<span class="caps" style="color: var(--t2)">{T("Las fases · hora UTC", "The phases · UTC time")(lang)}</span>'
                     f'<div class="phases" style="display: grid; grid-template-columns: repeat({len(o["phases"])}, minmax(0, 1fr)); gap: 12px">{discs}</div></div>')
    more_media = ""
    if len(blocks) > 1:
        more_media = f'<div class="g2" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px">{"".join(blocks[1:])}</div>'
    tool = o.get("made_with")
    tool_card = ""
    if tool:
        tool_card = (f'<div class="card gold" style="padding: 30px; gap: 12px"><span class="caps" style="color: var(--t3)">{T("Hecho con", "Made with")(lang)}</span>'
                     f'<span class="bd" style="font-size: 30px; font-weight: 500">{tool["name"]}</span>'
                     f'<span style="font-size: 15px; line-height: 1.6; color: var(--t2)">{(tool.get("desc") or {}).get(lang, "")}</span></div>')
    downloads = "".join(
        f'<a class="row" href="{d["src"]}" download style="grid-template-columns: minmax(0, 1fr) auto"><span class="rt" style="font-size: 15.5px">{d["label"][lang]}</span><span class="bd rd" style="font-style: italic">{d["fmt"]} ↓</span></a>'
        for d in o.get("downloads", []))
    kind_label = tr(KIND[o["kind"]], lang)
    crumbs = [(fname("observaciones.html", lang), T("Observaciones", "Observations")(lang)),
              (fname("observaciones.html", lang) + "#" + ANCHOR[o["kind"]], kind_label)]
    related = neighbours(o, obs, lang)
    body = breadcrumb(lang, crumbs)
    body += f"""
    <section style="position: relative; padding: 40px var(--gx) 48px; display: flex; flex-direction: column; gap: 20px">
      <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap"><span class="bd" style="font-size: 20px; font-style: italic; color: var(--gold)">{lam}</span><span class="caps" style="color: var(--t2)">{esc(o.get("subtitle", {}).get(lang, kind_label))}</span></div>
      <h1 class="bd" style="font-size: clamp(42px, 5.8vw, 84px); font-weight: 400; line-height: 1; letter-spacing: -0.02em">{o.get("title_html", {}).get(lang, esc(title))}</h1>
    </section>
    <div class="dbl" aria-hidden="true" style="margin: 0 var(--gx)"></div>
    <section class="g12" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 32px; padding: 56px var(--gx) 96px">
      <div class="c8" style="grid-column: span 8; display: flex; flex-direction: column; gap: 40px">
        {main_col}
        {more_media}
        {f'<div style="display: flex; flex-direction: column; gap: 14px; max-width: 720px"><span class="caps" style="color: var(--t3)">{T("Notas", "Notes")(lang)}</span><div style="font-size: 18px; line-height: 1.75; color: var(--t2); display: flex; flex-direction: column; gap: 14px">{notes}</div></div>' if notes else ""}
      </div>
      <aside class="c4" style="grid-column: 9 / span 4; display: flex; flex-direction: column; gap: 28px">
        <div class="card" style="padding: 32px"><span class="caps" style="color: var(--gold); margin-bottom: 8px">{T("Ficha técnica", "Technical details")(lang)}</span>{kv_rows(facts)}</div>
        {tool_card}
        {f'<div style="display: flex; flex-direction: column; gap: 4px"><span class="caps" style="color: var(--t3); padding-bottom: 8px">{T("Descargas", "Downloads")(lang)}</span>{downloads}</div>' if downloads else ""}
      </aside>
    </section>"""
    if related:
        body += f"""
    <section style="display: flex; flex-direction: column; gap: 40px; margin: 0 var(--gb) 96px; padding: 72px var(--gb) 64px; border-radius: 36px; background: var(--s1); border: 1px solid var(--line)">
      <div class="jb" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 0 8px">
        <h2 class="bd" style="font-size: clamp(30px, 3vw, 44px); font-weight: 400; letter-spacing: -0.02em">{T("Más en", "More in")(lang)} <em class="gi">{kind_label.lower()}</em></h2>
        <a class="lnk" href="{fname("observaciones.html", lang)}#{ANCHOR[o["kind"]]}">{T("Todas", "All")(lang)}{ARROW}</a>
      </div>
      <div class="g3" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px">{related}</div>
    </section>"""
    desc = (o.get("description") or {}).get(lang) or title
    og = o.get("og") or obs_thumb(o)
    return page(lang, obs_page(o), f"{title} · CabraSpace", desc, body, og_image=og)


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
