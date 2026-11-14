"""Resumen diario por correo de lo que ha entrado en la Bitácora (equipo, software, cursos).

Envía TODO lo que ha entrado desde el correo anterior, no lo «publicado ayer»: los blogs oficiales
entran con su fecha de publicación (hasta 45 días atrás) y se perderían con un filtro por fecha.
Lo ya enviado se recuerda en tools/resumen_enviados.json, que el workflow guarda en el repo.

Uso:
  python tools/resumen_diario.py                  # envía (necesita GMAIL_APP_PASSWORD) y guarda estado
  python tools/resumen_diario.py --preview f.html # solo genera el HTML, no envía ni guarda estado
  python tools/resumen_diario.py --preview f.html --candidatas c.json   # idem, con otro fichero de candidatas

Además lista las CANDIDATAS (lo que el filtro estricto no publicó) numeradas, y el dueño contesta al
correo «publica 2, 5 y 7»: lo lee tools/procesar_respuestas.py. Ver tools/CURACION.md.

Variables de entorno: GMAIL_APP_PASSWORD (obligatoria para enviar), RESUMEN_USER y RESUMEN_TO.
"""
import os
import sys
import json
import html
import smtplib
import email.utils
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import curacion as cu

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


def cand_view(c):
    """Lo que se muestra de una candidata: título/resumen en español si la IA ya los hizo."""
    pub = c.get("publish") or {}
    scored = c.get("score") is not None
    return {"title": (pub.get("title_es") if scored and pub.get("title_es") else c["title"]),
            "summary": pub.get("summary_es", "") if scored else "",
            "meta": " · ".join(p for p in [c.get("source", ""), "-".join(reversed(c["date"].split("-")))] if p),
            "reason": c.get("reason", ""), "score": c.get("score"), "url": c["url"]}


def render_candidates(cands, digest_id):
    """Sección «Candidatas»: numeradas (el número es la posición en ESTE correo) y con instrucciones."""
    e = html.escape
    k = len(cands)
    parts = [f'<div style="background:#fff;border:1px solid {LINE};border-left:4px solid {GOLD};'
             f'border-radius:4px;padding:14px 16px;margin:30px 0 8px">',
             f'<div style="font:bold 13px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:{GOLD}">'
             f'Candidatas · {k}</div>',
             f'<div style="font:14px/1.5 Arial,sans-serif;color:#3d3830;margin-top:8px">'
             f'El filtro automático no las ha publicado. <b>Responde a este correo con los números de las que '
             f'quieras publicar</b>, por ejemplo <b>«publica 2, 5 y 7»</b> (vale también «2,5,7», «2 5 7» o '
             f'«todas»). Con «ninguna» se descartan todas. Las que no nombres se descartan y no vuelven a salir.</div></div>']
    for i, c in enumerate(cands, 1):
        v = cand_view(c)
        summary = v["summary"]
        if len(summary) > 240:
            summary = summary[:237].rsplit(" ", 1)[0] + "…"
        extra = f' · puntuación IA {v["score"]}/10' if v["score"] is not None else ""
        parts.append(
            f'<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px"><tr>'
            f'<td style="width:44px;vertical-align:top;padding:2px 10px 0 0">'
            f'<div style="width:34px;height:34px;line-height:34px;text-align:center;border-radius:50%;'
            f'background:{GOLD};color:#fff;font:bold 16px Arial,sans-serif">{i}</div></td>'
            f'<td style="vertical-align:top">'
            f'<a href="{e(v["url"])}" style="color:{INK};font-size:16px;text-decoration:none;border-bottom:1px solid {GOLD}">{e(v["title"])}</a>'
            f'<div style="font:12px Arial,sans-serif;color:{MUTED};margin:4px 0">{e(v["meta"])}</div>'
            f'<div style="font:12px Arial,sans-serif;color:{GOLD}">Por qué es candidata: {e(v["reason"])}{e(extra)}</div>'
            + (f'<div style="font:14px/1.45 Arial,sans-serif;color:#3d3830;margin-top:4px">{e(summary)}</div>' if summary else '')
            + '</td></tr></table>')
    parts.append(f'<div style="font:11px Arial,sans-serif;color:{MUTED}">Referencia de este correo: {e(digest_id)} '
                 f'(no la borres del asunto al contestar).</div>')
    return "".join(parts)


def render_text(new, cands, digest_id, today):
    """Versión de texto plano (la que cita tu cliente de correo al contestar)."""
    out = [f"CabraSpace · Bitácora — resumen del {today}", f"{len(new)} entradas nuevas.", ""]
    for r in new:
        out.append(f"- {r['title']} ({r['source']})")
    if cands:
        out += ["", f"CANDIDATAS ({len(cands)}) — responde con los números que quieras publicar, p. ej. «publica 2, 5 y 7»; "
                    "«todas» o «ninguna» también valen.", ""]
        for i, c in enumerate(cands, 1):
            v = cand_view(c)
            out.append(f"{i}. {v['title']} [{v['meta']}] — {v['reason']}")
        out += ["", f"Referencia: {digest_id}"]
    return "\n".join(out)


def render(new, today, cands=None, digest_id=None):
    e = html.escape
    n = len(new)
    parts = [f'<div style="background:{PAPER};padding:24px 12px;font-family:Georgia,serif;color:{INK}">',
             f'<div style="max-width:640px;margin:0 auto">',
             f'<div style="font:12px/1 Arial,sans-serif;letter-spacing:.18em;color:{GOLD};text-transform:uppercase">CabraSpace · Bitácora</div>',
             f'<h1 style="font-weight:normal;font-size:26px;margin:8px 0 4px">Resumen del {e(today)}</h1>',
             f'<div style="font:14px Arial,sans-serif;color:{MUTED};margin-bottom:20px">'
             + (f'{n} entrada{"s" if n != 1 else ""} nueva{"s" if n != 1 else ""} desde el último correo.' if n
                else 'Sin novedades desde el último correo.')
             + (f' <b style="color:{GOLD}">{len(cands)} candidata{"s" if len(cands) != 1 else ""} esperan tu respuesta ↓</b>'
                if cands else '') + '</div>']
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
    if cands:
        parts.append(render_candidates(cands, digest_id))
    parts.append(f'<div style="font:12px Arial,sans-serif;color:{MUTED};border-top:1px solid {LINE};'
                 f'margin-top:28px;padding-top:12px">Todo el registro en <a href="{SITE}" style="color:{GOLD}">'
                 f'cabraspace.com/bitacora</a>.</div></div></div>')
    return "".join(parts)


def send(subject, body_html, user, to, password, body_text=None, digest_id=None):
    msg = MIMEMultipart("alternative")
    # formataddr: con el nombre «Bitácora» (no ASCII), concatenar f"... <{user}>" hacía que Python codificara
    # TODO el valor, dirección incluida, dentro de una sola palabra codificada: el From quedaba sin dirección real.
    msg["Subject"], msg["From"], msg["To"] = subject, email.utils.formataddr(("CabraSpace Bitácora", user)), to
    if digest_id:
        # El lector de respuestas descarta cualquier correo con esta cabecera (es el propio resumen) y
        # busca el token CB-... en Asunto / In-Reply-To / References para saber a qué resumen contestan.
        msg[cu.DIGEST_HEADER] = digest_id
        msg["Message-ID"] = email.utils.make_msgid(idstring=digest_id, domain="cabraspace.com")
    if body_text:
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
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
            # Sin datos de la contraseña: los registros de Actions de este repo son públicos.
            hint = "" if len(password) == 16 else " · la contraseña guardada NO tiene 16 letras (no parece de aplicación)"
            print(f"Error enviando (intento {attempt}): {type(e).__name__}: {e}{hint}")
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

    # Candidatas. Un fallo aquí NUNCA debe impedir el resumen diario: se envía sin la sección.
    cand_path = cu.CANDIDATAS_FILE
    if "--candidatas" in sys.argv:
        cand_path = sys.argv[sys.argv.index("--candidatas") + 1]
    cands_doc, selected, digest_id = None, [], None
    try:
        cands_doc = cu.load_candidatas(cand_path)
        decisions = cu.load_decisiones(cu.DECISIONES_FILE)["decisions"]
        published_ids = {r["id"] for r in rows}
        if not preview:
            cu.drop_published(cands_doc, published_ids)   # ya entraron por la vía automática
            cu.expire(cands_doc)
        selected = cu.select_for_digest(cands_doc, published_ids, cu.source_policy(decisions))
        if selected:
            digest_id = cu.new_digest_id(cu.utcnow(), [c["id"] for c in selected])
    except Exception as ex:
        print(f"AVISO: candidatas no disponibles ({type(ex).__name__}); el resumen sale sin ellas.")
        selected, digest_id = [], None

    today = datetime.now(timezone(timedelta(hours=1))).strftime("%d-%m-%Y")
    body = render(new, today, selected, digest_id)
    subject = f"Bitácora CabraSpace · {len(new)} novedad{'es' if len(new) != 1 else ''}"
    if selected:
        subject += f" · {len(selected)} candidata{'s' if len(selected) != 1 else ''}"
    subject += f" · {today}" + (f" [{digest_id}]" if digest_id else "")
    print(f"{len(new)} entradas nuevas, {len(selected)} candidatas.")
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

    send(subject, body, user, to, password, render_text(new, selected, digest_id, today), digest_id)
    print(f"Correo enviado: «{subject}»")

    # Candidatas: registrar QUÉ número era cada una en ESTE correo (la respuesta se mapea con esto).
    if digest_id and cands_doc is not None:
        digests = cu.load_digests(cu.DIGESTS_FILE)
        cu.register_digest(digests, cands_doc, digest_id, selected)
        cu.save_json(cu.DIGESTS_FILE, digests)
        cu.save_json(cand_path, cands_doc)

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
