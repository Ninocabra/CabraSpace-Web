"""Resumen diario por correo de lo que ha entrado en la Bitácora (equipo, software, cursos).

Envía TODO lo que ha entrado desde el correo anterior, no lo «publicado ayer»: los blogs oficiales
entran con su fecha de publicación (hasta 45 días atrás) y se perderían con un filtro por fecha.
Lo ya enviado se recuerda en tools/resumen_enviados.json, que el workflow guarda en el repo.

Uso:
  python tools/resumen_diario.py                  # envía (necesita GMAIL_APP_PASSWORD) y guarda estado
  python tools/resumen_diario.py --preview f.html # solo genera el HTML, no envía ni guarda estado

Variables de entorno: GMAIL_APP_PASSWORD (obligatoria para enviar), RESUMEN_USER y RESUMEN_TO.
"""
import os
import sys
import json
import html
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ROOT, "tools", "resumen_enviados.json")
MAX_STATE = 3000          # ids recordados (de sobra para la ventana de las tres bases)
SITE = "https://cabraspace.com/bitacora.html"

GOLD, INK, PAPER, MUTED, LINE = "#b8892f", "#1c1a17", "#faf7f0", "#7a7266", "#e6dfd0"


def load(name):
    try:
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"AVISO: no se pudo leer {name}: {e}")
        return []


def collect():
    """Todas las entradas actuales, normalizadas: (id, grupo, fecha, título, fuente, resumen, url)."""
    rows = []
    for x in load("equipamiento.json"):
        kind = {"official": "Marcas (oficial)", "press": "Prensa especializada"}.get(
            x.get("source_type"), "Youtubers y foros")
        rows.append({"id": x.get("id") or x.get("url"), "group": "Equipo · " + kind, "date": x.get("date", ""),
                     "title": x.get("title_es", ""), "source": x.get("source", ""),
                     "summary": x.get("summary_es", ""), "url": x.get("url", "")})
    for x in load("novedades.json"):
        rows.append({"id": x.get("id") or x.get("url"), "group": "Software y PixInsight", "date": x.get("date", ""),
                     "title": x.get("title_es", ""), "source": (x.get("category_es") or "").capitalize(),
                     "summary": x.get("summary_es", ""), "url": x.get("url", "")})
    for x in load("youtube_courses.json"):
        rows.append({"id": "yt:" + (x.get("youtube_id") or x.get("url", "")), "group": "Cursos de YouTube",
                     "date": "", "rel": x.get("published_relative", ""),
                     "title": x.get("title_es", ""), "source": x.get("author", ""),
                     "summary": x.get("summary_es", ""), "url": x.get("url", "")})
    return [r for r in rows if r["id"] and r["title"]]


def load_state():
    if not os.path.exists(STATE_FILE):
        return None
    with open(STATE_FILE, encoding="utf-8") as f:
        return json.load(f)


def first_run_selection(rows):
    """Sin estado previo: se envía solo lo fechado desde ayer; el resto se da por enviado."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    return [r for r in rows if r["date"] and r["date"] >= since]


GROUP_ORDER = ["Equipo · Marcas (oficial)", "Equipo · Prensa especializada", "Equipo · Youtubers y foros",
               "Software y PixInsight", "Cursos de YouTube"]


def render(new, today):
    e = html.escape
    n = len(new)
    parts = [f'<div style="background:{PAPER};padding:24px 12px;font-family:Georgia,serif;color:{INK}">',
             f'<div style="max-width:640px;margin:0 auto">',
             f'<div style="font:12px/1 Arial,sans-serif;letter-spacing:.18em;color:{GOLD};text-transform:uppercase">CabraSpace · Bitácora</div>',
             f'<h1 style="font-weight:normal;font-size:26px;margin:8px 0 4px">Resumen del {e(today)}</h1>',
             f'<div style="font:14px Arial,sans-serif;color:{MUTED};margin-bottom:20px">'
             + (f'{n} entrada{"s" if n != 1 else ""} nueva{"s" if n != 1 else ""} desde el último correo.' if n
                else 'Sin novedades desde el último correo.') + '</div>']
    for g in GROUP_ORDER:
        items = [r for r in new if r["group"] == g]
        if not items:
            continue
        items.sort(key=lambda r: r["date"], reverse=True)
        parts.append(f'<h2 style="font:bold 13px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;'
                     f'color:{GOLD};border-bottom:1px solid {LINE};padding-bottom:6px;margin:26px 0 8px">'
                     f'{e(g)} · {len(items)}</h2>')
        for r in items:
            when = "-".join(reversed(r["date"].split("-"))) if r["date"] else r.get("rel", "")
            meta = " · ".join(p for p in [r["source"], when] if p)
            summary = r["summary"]
            if len(summary) > 260:
                summary = summary[:257].rsplit(" ", 1)[0] + "…"
            parts.append(
                f'<div style="margin:0 0 16px">'
                f'<a href="{e(r["url"])}" style="color:{INK};font-size:17px;text-decoration:none;border-bottom:1px solid {GOLD}">{e(r["title"])}</a>'
                f'<div style="font:12px Arial,sans-serif;color:{MUTED};margin:4px 0">{e(meta)}</div>'
                f'<div style="font:14px/1.45 Arial,sans-serif;color:#3d3830">{e(summary)}</div></div>')
    parts.append(f'<div style="font:12px Arial,sans-serif;color:{MUTED};border-top:1px solid {LINE};'
                 f'margin-top:28px;padding-top:12px">Todo el registro en <a href="{SITE}" style="color:{GOLD}">'
                 f'cabraspace.com/bitacora</a>.</div></div></div>')
    return "".join(parts)


def send(subject, body_html, user, to, password):
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["From"], msg["To"] = subject, f"CabraSpace Bitácora <{user}>", to
    msg.attach(MIMEText(body_html, "html", "utf-8"))
    # Gmail muestra la contraseña de aplicación en grupos de 4 con espacios; al pegarla en el
    # secreto pueden colarse espacios o saltos de línea, y entonces Gmail CORTA la conexión en el
    # login (SMTPServerDisconnected, 13-11-2026). Se quita todo espacio en blanco, como AstroPrecios.
    password = "".join(password.split())
    last = None
    for attempt in (1, 2):
        try:
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as s:
                s.starttls()
                s.login(user, password)
                s.sendmail(user, [to], msg.as_string())
            return
        except Exception as e:
            last = e
            print(f"Error enviando (intento {attempt}): {type(e).__name__}: {e} · longitud contraseña={len(password)}")
            if attempt == 1:
                import time
                time.sleep(8)
    raise last


def main():
    preview = None
    if "--preview" in sys.argv:
        preview = sys.argv[sys.argv.index("--preview") + 1]

    rows = collect()
    state = load_state()
    if state is None:
        new = first_run_selection(rows)
        print(f"Primera ejecución: {len(new)} entradas fechadas desde ayer; el resto se marca como enviado.")
    else:
        sent = set(state.get("sent", []))
        new = [r for r in rows if r["id"] not in sent]

    today = datetime.now(timezone(timedelta(hours=1))).strftime("%d-%m-%Y")
    body = render(new, today)
    subject = f"Bitácora CabraSpace · {len(new)} novedad{'es' if len(new) != 1 else ''} · {today}"
    print(f"{len(new)} entradas nuevas.")
    for r in new:
        print(f"  [{r['group']}] {r['title'][:90]}")

    if preview:
        with open(preview, "w", encoding="utf-8") as f:
            f.write(f"<!doctype html><meta charset='utf-8'><title>{html.escape(subject)}</title>{body}")
        print(f"Vista previa: {preview} (no se envía ni se guarda estado)")
        return 0

    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    user = os.environ.get("RESUMEN_USER", "").strip()
    to = os.environ.get("RESUMEN_TO", "").strip() or user
    if not password or not user:
        print("ERROR: faltan GMAIL_APP_PASSWORD o RESUMEN_USER; no se envía.")
        return 1

    send(subject, body, user, to, password)
    print(f"Correo enviado: «{subject}»")

    # Estado: todo lo actual queda como enviado (incluido lo no seleccionado en la 1.ª ejecución).
    ids = [r["id"] for r in rows]
    old = state.get("sent", []) if state else []
    keep = list(dict.fromkeys(ids + old))[:MAX_STATE]
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sent": keep}, f,
                  ensure_ascii=False, indent=0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
