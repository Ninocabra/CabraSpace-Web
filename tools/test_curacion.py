"""Pruebas de la curación por correo: lector de respuestas, filtro de seguridad, idempotencia,
mapeo número -> candidata, aprendizaje y criterios relajados del scraper.

Ejecutar:  python -m unittest discover -s tools -p "test_curacion.py" -v
No usan red ni el buzón real: el IMAP es un doble (FakeIMAP) y las direcciones son de mentira.
"""
import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import curacion as cu  # noqa: E402
import procesar_respuestas as pr  # noqa: E402

OWNER = "dueno.prueba@gmail.com"
GOOD_AUTH = ("mx.google.com; dkim=pass header.i=@gmail.com header.s=20230601 header.b=AbCdEf; "
             "spf=pass (google.com: domain of dueno.prueba@gmail.com designates 209.85.220.41 as permitted sender) "
             "smtp.mailfrom=dueno.prueba@gmail.com; dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com")
NOW = datetime(2026, 11, 15, 9, 0, tzinfo=timezone.utc)
DIGEST = "CB-20261115-a1b2c3"


def make_msg(body="publica 2", frm=OWNER, subject=f"Re: Bitácora CabraSpace · 3 candidatas [{DIGEST}]",
             auth=GOOD_AUTH, in_reply_to="<orig@x>", mid="<m1@mail.gmail.com>", extra_auth=None, extra=None):
    m = EmailMessage()
    if auth is not None:
        m["Authentication-Results"] = auth
    if extra_auth is not None:
        m["Authentication-Results"] = extra_auth
    if frm is not None:
        m["From"] = frm
    m["To"] = "bot@example.com"
    m["Subject"] = subject
    if in_reply_to:
        m["In-Reply-To"] = in_reply_to
    if mid:
        m["Message-ID"] = mid
    for k, v in (extra or {}).items():
        m[k] = v
    m.set_content(body)
    return m


def raw(**kw):
    return make_msg(**kw).as_bytes()


def quoted_reply(top, n=7):
    """Lo que genera Gmail al contestar arriba: respuesta + atribución + el resumen citado con «>»."""
    quoted = "\n".join("> " + l for l in [
        "CabraSpace · Bitácora — resumen del 15-11-2026", "",
        f"CANDIDATAS ({n}) — responde con los números que quieras publicar, p. ej. «publica 2, 5 y 7»;",
        "«todas» o «ninguna» también valen.", "",
        "1. ZWO lanza algo [ZWO · 14-11-2026] — motivo", "2. Otra cosa [Space.com · 13-11-2026] — motivo", "",
        f"Referencia: {DIGEST}"])
    return f"{top}\n\nEl sáb, 15 nov 2026 a las 8:17, CabraSpace Bitácora <bot@example.com>\nescribió:\n\n{quoted}\n"


# =============================================================================================
class ParseReplyTests(unittest.TestCase):
    def check(self, text, n, action, numbers=()):
        r = cu.parse_reply(text, n)
        self.assertEqual((r.action, r.numbers), (action, sorted(numbers)), f"{text!r} -> {r}")

    def test_variantes_de_publicar(self):
        for t in ["publica 2, 5 y 7", "Publica 2,5,7", "2,5,7", "2 5 7", "2, 5 y 7", "Publícalas: 2, 5 y 7",
                  "publica la 2, la 5 y la 7", "Publicar 2 5 7 por favor", "ok, publica 2, 5 y 7. Gracias!",
                  "Sí, publica los números 2, 5 y 7", "PUBLICA 2 Y 5 Y 7", "publica nº 2, nº 5 y nº 7", "2º, 5º y 7º"]:
            self.check(t, 7, "publish", [2, 5, 7])

    def test_rangos(self):
        self.check("publica del 2 al 4", 7, "publish", [2, 3, 4])
        self.check("2-4 y 7", 7, "publish", [2, 3, 4, 7])
        self.check("publica 1 a 3", 7, "publish", [1, 2, 3])

    def test_todas(self):
        for t in ["todas", "Todas", "publica todas", "publícalas todas, gracias", "todo", "publica todo"]:
            self.check(t, 7, "all")

    def test_todas_menos(self):
        self.check("publica todas menos la 3 y la 4", 7, "publish", [1, 2, 5, 6, 7])
        self.check("todas excepto 1", 3, "publish", [2, 3])

    def test_ninguna(self):
        for t in ["ninguna", "Ninguna, gracias", "descarta", "descartar todas", "nada", "descarta todo", "ninguno"]:
            self.check(t, 7, "none")

    def test_publica_y_descarta_el_resto(self):
        self.check("publica 2 y 5 y descarta el resto", 7, "publish", [2, 5])

    def test_basura_no_se_entiende(self):
        for t in ["", "   ", "hola", "gracias por el correo, el 3 de enero nos vemos", "no sé cuál",
                  "descarta 3",                    # ambiguo: no se actúa
                  "publica", "esto me suena a la 2 pero no estoy seguro", "https://x.com/2024/05/3",
                  "Enviado desde mi iPhone", "Recordatorio: llamar al 112"]:
            self.assertIsNone(cu.parse_reply(t, 7).action, t)

    def test_fuera_de_rango(self):
        self.assertIsNone(cu.parse_reply("publica 99", 7).action)
        r = cu.parse_reply("publica 2 y 99", 7)
        self.assertEqual((r.action, r.numbers, r.ignored), ("publish", [2], 1))
        self.assertIsNone(cu.parse_reply("publica 0", 7).action)
        self.assertIsNone(cu.parse_reply("publica 2", 0).action)

    def test_el_texto_citado_se_ignora(self):
        # El resumen citado contiene «publica 2, 5 y 7», números y títulos: nada de eso debe contar.
        self.check(quoted_reply("publica 1 y 3"), 7, "publish", [1, 3])
        self.check(quoted_reply("todas"), 7, "all")
        self.check(quoted_reply("ninguna"), 7, "none")

    def test_respuesta_vacia_con_cita_no_publica_lo_citado(self):
        # Control que debe fallar si el lector leyera la cita: el ejemplo citado dice «publica 2, 5 y 7».
        self.assertIsNone(cu.parse_reply(quoted_reply(""), 7).action)
        self.assertIsNone(cu.parse_reply(quoted_reply("gracias"), 7).action)

    def test_atribucion_en_ingles_y_outlook(self):
        en = "publica 2\n\nOn Sat, Nov 15, 2026 at 8:17 AM CabraSpace <bot@example.com> wrote:\nTexto citado 5 7 9\n"
        self.check(en, 7, "publish", [2])
        outlook = "publica 4\n\nDe: CabraSpace Bitácora <bot@example.com>\nEnviado: sábado\nPara: yo\nAsunto: algo 6\n"
        self.check(outlook, 7, "publish", [4])
        sep = "publica 3\n-----Original Message-----\ntodas 1 2"
        self.check(sep, 7, "publish", [3])

    def test_firma_de_movil(self):
        self.check("publica 2 y 6\n\nEnviado desde mi iPhone", 7, "publish", [2, 6])
        self.check("publica 2\n-- \nNino\nTel 600 123 456", 7, "publish", [2])

    def test_html_sin_la_cita(self):
        m = EmailMessage()
        m["From"] = OWNER
        m.set_content("x")
        m.clear_content()
        m.set_content("fallback", subtype="html")
        m.set_content('<div dir="ltr">publica 2, 5<br></div><br><div class="gmail_quote"><div>El sáb escribió:</div>'
                      '<blockquote class="gmail_quote">publica 1 y 7 y 6</blockquote></div>', subtype="html")
        parsed = cu.parse_reply(cu.extract_text(m), 7)
        self.assertEqual((parsed.action, parsed.numbers), ("publish", [2, 5]))


# =============================================================================================
class SecurityTests(unittest.TestCase):
    def verdict(self, **kw):
        return cu.check_message(cu.parse_message(raw(**kw)), OWNER)

    def test_respuesta_valida(self):
        self.assertEqual(self.verdict(), (True, "ok"))

    def test_remitente_incorrecto(self):
        self.assertEqual(self.verdict(frm="otra.persona@gmail.com"), (False, "from"))

    def test_remitente_con_nombre_trampa(self):
        self.assertEqual(self.verdict(frm=f'"{OWNER}" <malo@evil.com>'), (False, "from"))
        self.assertEqual(self.verdict(frm="dueno.prueba@gmail.com.evil.com"), (False, "from"))
        self.assertEqual(self.verdict(frm="xdueno.prueba@gmail.com"), (False, "from"))

    def test_remitente_con_mayusculas_es_el_mismo(self):
        self.assertEqual(self.verdict(frm=f"Dueno <{OWNER.upper()}>"), (True, "ok"))

    def test_sin_from_o_dos_from(self):
        self.assertEqual(self.verdict(frm=None), (False, "from"))
        two = make_msg().as_bytes().replace(b"From:", b"From: otra@x.com\r\nFrom:", 1)   # dos cabeceras From
        self.assertEqual(two.count(b"From:"), 2)
        self.assertEqual(cu.check_message(cu.parse_message(two), OWNER), (False, "from"))

    def test_sin_authentication_results(self):
        self.assertEqual(self.verdict(auth=None), (False, "sin_auth"))

    def test_dkim_ausente_o_fallido(self):
        self.assertEqual(self.verdict(auth="mx.google.com; spf=pass smtp.mailfrom=dueno.prueba@gmail.com"), (False, "dkim"))
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("dkim=pass", "dkim=fail")), (False, "dkim"))
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("dkim=pass", "dkim=none")), (False, "dkim"))

    def test_dkim_de_otro_dominio(self):
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("header.i=@gmail.com", "header.i=@evil.com")), (False, "dkim"))
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("header.i=@gmail.com", "header.i=@evilgmail.com")), (False, "dkim"))

    def test_spf_fallido_o_de_otro_dominio(self):
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("spf=pass", "spf=softfail")), (False, "spf"))
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("smtp.mailfrom=dueno.prueba@gmail.com", "smtp.mailfrom=x@evil.com")),
                         (False, "spf"))

    def test_cabecera_falsificada_por_debajo_de_la_de_gmail_no_cuenta(self):
        bad = GOOD_AUTH.replace("dkim=pass", "dkim=fail")
        self.assertEqual(self.verdict(auth=bad, extra_auth=GOOD_AUTH), (False, "dkim"))

    def test_cabecera_que_no_es_de_gmail(self):
        self.assertEqual(self.verdict(auth=GOOD_AUTH.replace("mx.google.com", "mx.evil.example")), (False, "auth_no_gmail"))

    def test_no_es_respuesta(self):
        self.assertEqual(self.verdict(in_reply_to=None, subject=f"Hola [{DIGEST}]"), (False, "no_respuesta"))

    def test_re_en_asunto_basta_aunque_no_haya_in_reply_to(self):
        self.assertEqual(self.verdict(in_reply_to=None), (True, "ok"))

    def test_la_propia_copia_del_resumen_se_ignora(self):
        # El resumen llega a la misma bandeja, del mismo remitente y con autenticación válida.
        v = self.verdict(extra={cu.DIGEST_HEADER: DIGEST}, subject=f"Re: x [{DIGEST}]")
        self.assertEqual(v, (False, "es_resumen"))

    def test_sin_dueno_configurado(self):
        self.assertEqual(cu.check_message(cu.parse_message(raw()), ""), (False, "sin_dueno"))

    def test_token_en_asunto_in_reply_to_o_references(self):
        self.assertEqual(cu.find_digest_id(cu.parse_message(raw())), DIGEST)
        m = cu.parse_message(raw(subject="Re: otra cosa", in_reply_to=f"<x.{DIGEST}@cabraspace.com>"))
        self.assertEqual(cu.find_digest_id(m), DIGEST)
        self.assertIsNone(cu.find_digest_id(cu.parse_message(raw(subject="Re: nada"))))


# =============================================================================================
def make_state(n=4, sent=NOW - timedelta(hours=1)):
    """4 candidatas c1..c4 en un resumen donde el número 1 es c3, el 2 es c1, el 3 es c4, el 4 es c2."""
    cands = {"candidates": [
        {"id": f"https://ex.com/c{i}", "title": f"Titulo {i}", "source": "Fuente A" if i % 2 else "Fuente B",
         "url": f"https://ex.com/c{i}", "date": "2026-11-14", "reason": "motivo", "status": "pending", "score": 6,
         "first_seen": "2026-11-14", "digest": DIGEST, "target": "equipamiento",
         "publish": {"id": f"https://ex.com/c{i}", "title_es": f"Titulo ES {i}", "title_en": f"Title {i}",
                     "url": f"https://ex.com/c{i}", "date": "2026-11-14", "source": "Fuente A", "source_type": "reviewer",
                     "tags": []}}
        for i in range(1, n + 1)]}
    order = ["https://ex.com/c3", "https://ex.com/c1", "https://ex.com/c4", "https://ex.com/c2"][:n]
    digests = {"digests": {DIGEST: {"sent": sent.isoformat(timespec="seconds"), "ids": order, "resolved": None,
                                    "outcome": None}}, "processed": []}
    return cands, digests, {"decisions": []}


class ApplyAndIdempotencyTests(unittest.TestCase):
    def run_process(self, raws, state=None, db=None):
        cands, digests, decisions = state or make_state()
        db, count, ids = pr.process(raws, OWNER, cands, digests, decisions, db if db is not None else [{"id": "viejo"}], NOW)
        return cands, digests, decisions, db, count, ids

    def test_mapeo_numero_a_candidata_del_resumen_concreto(self):
        cands, digests, decisions, db, count, ids = self.run_process([raw(body="publica 1 y 3")])
        # número 1 = c3, número 3 = c4 (NO c1 y c3: el número es la posición en el correo, no el orden del fichero)
        self.assertEqual(set(ids), {"https://ex.com/c3", "https://ex.com/c4"})
        self.assertEqual([e["id"] for e in db][-1], "viejo")
        self.assertEqual({e["id"] for e in db[:2]}, {"https://ex.com/c3", "https://ex.com/c4"})
        self.assertEqual(count["respuestas_aplicadas"], 1)
        self.assertEqual((count["publicadas"], count["rechazadas"]), (2, 2))

    def test_se_registran_aceptadas_y_rechazadas(self):
        cands, digests, decisions, *_ = self.run_process([raw(body="publica 1 y 3")])
        by_url = {d["url"]: d["decision"] for d in decisions["decisions"]}
        self.assertEqual(by_url, {"https://ex.com/c3": "aceptada", "https://ex.com/c4": "aceptada",
                                  "https://ex.com/c1": "rechazada", "https://ex.com/c2": "rechazada"})
        self.assertEqual(cands["candidates"], [])                       # ya no quedan pendientes
        self.assertIsNotNone(digests["digests"][DIGEST]["resolved"])

    def test_decisiones_solo_con_datos_publicos(self):
        _, _, decisions, *_ = self.run_process([raw(body="publica 1")])
        for d in decisions["decisions"]:
            self.assertEqual(set(d), {"date", "digest", "title", "url", "source", "decision"})

    def test_todas_y_ninguna(self):
        *_, db, count, ids = self.run_process([raw(body="todas")])
        self.assertEqual((len(ids), count["rechazadas"]), (4, 0))
        cands, digests, decisions, db, count, ids = self.run_process([raw(body="ninguna")])
        self.assertEqual((len(ids), count["rechazadas"]), (0, 4))
        self.assertTrue(all(d["decision"] == "rechazada" for d in decisions["decisions"]))
        self.assertEqual(db, [{"id": "viejo"}])

    def test_misma_respuesta_dos_veces_se_aplica_una(self):
        state = make_state()
        r = raw(body="publica 2")
        cands, digests, decisions, db, count, ids = self.run_process([r, r], state)
        self.assertEqual(count["respuestas_aplicadas"], 1)
        self.assertEqual(count["ya_procesado"], 1)
        self.assertEqual(len(ids), 1)
        self.assertEqual(len(decisions["decisions"]), 4)

    def test_idempotente_entre_pasadas_con_el_estado_guardado(self):
        cands, digests, decisions = make_state()
        db = [{"id": "viejo"}]
        r = raw(body="publica 2")
        db, c1, ids1 = pr.process([r], OWNER, cands, digests, decisions, db, NOW)
        # «Segunda pasada horaria»: el estado se ha escrito y releído de disco
        cands2, digests2, decisions2 = (json.loads(json.dumps(x)) for x in (cands, digests, decisions))
        db2, c2, ids2 = pr.process([r], OWNER, cands2, digests2, decisions2, copy.deepcopy(db), NOW + timedelta(hours=1))
        self.assertEqual(c2["ya_procesado"], 1)
        self.assertEqual((ids2, db2, decisions2), ([], db, decisions))

    def test_apply_reply_por_si_solo_es_idempotente(self):
        cands, digests, decisions = make_state()
        first = cu.apply_reply(cands, digests, decisions, DIGEST, cu.Parsed("publish", [1]), NOW)
        self.assertEqual(len(first[0]), 1)
        n_dec = len(decisions["decisions"])
        self.assertIsNone(cu.apply_reply(cands, digests, decisions, DIGEST, cu.Parsed("all"), NOW))   # 2.ª vez: nada
        self.assertEqual(len(decisions["decisions"]), n_dec)

    def test_otra_respuesta_distinta_al_mismo_resumen_no_cambia_nada(self):
        r1, r2 = raw(body="publica 2", mid="<a@x>"), raw(body="todas", mid="<b@x>")
        cands, digests, decisions, db, count, ids = self.run_process([r1, r2])
        self.assertEqual(count["respuestas_aplicadas"], 1)
        self.assertEqual(count["resumen_ya_resuelto_o_viejo"], 1)
        self.assertEqual(len(ids), 1)

    def test_resumen_desconocido(self):
        r = raw(subject="Re: x [CB-20261101-ffffff]")
        *_, count, ids = self.run_process([r])
        self.assertEqual((count["rechazado_sin_resumen"], ids), (1, []))

    def test_resumen_demasiado_viejo(self):
        state = make_state(sent=NOW - timedelta(days=cu.DIGEST_MAX_AGE_DAYS + 2))
        *_, count, ids = self.run_process([raw(body="todas")], state)
        self.assertEqual((count["resumen_ya_resuelto_o_viejo"], ids), (1, []))

    def test_atacante_no_publica(self):
        spoof = raw(body="publica todas", frm="atacante@gmail.com", mid="<s1@x>")
        noauth = raw(body="publica todas", auth=None, mid="<s2@x>")
        failed = raw(body="publica todas", auth=GOOD_AUTH.replace("dkim=pass", "dkim=fail"), mid="<s3@x>")
        cands, digests, decisions, db, count, ids = self.run_process([spoof, noauth, failed])
        self.assertEqual(ids, [])
        self.assertEqual(db, [{"id": "viejo"}])
        self.assertEqual(decisions["decisions"], [])
        self.assertEqual((count["rechazado_from"], count["rechazado_sin_auth"], count["rechazado_dkim"]), (1, 1, 1))
        self.assertEqual(len(cands["candidates"]), 4)                    # nada tocado
        self.assertIsNone(digests["digests"][DIGEST]["resolved"])        # y el resumen sigue abierto
        self.assertEqual(digests["processed"], [])                       # un rechazo no «quema» el mensaje

    def test_la_cita_del_resumen_no_publica_lo_citado(self):
        *_, count, ids = self.run_process([raw(body=quoted_reply("gracias"))])
        self.assertEqual((count["no_entendido"], ids), (1, []))

    def test_respuesta_no_entendida_no_decide_nada_y_no_se_repite(self):
        state = make_state()
        r = raw(body="a ver si me acuerdo el 3")
        cands, digests, decisions, db, count, ids = self.run_process([r], state)
        self.assertEqual((count["no_entendido"], decisions["decisions"]), (1, []))
        self.assertIsNone(digests["digests"][DIGEST]["resolved"])        # puede contestar otra vez, bien escrito
        *_, count2, _ = self.run_process([r, raw(body="publica 1", mid="<n2@x>")], state)
        self.assertEqual((count2["ya_procesado"], count2["respuestas_aplicadas"]), (1, 1))

    def test_publicar_no_duplica_lo_que_ya_estaba(self):
        db = [{"id": "https://ex.com/c3"}]
        *_, db2, count, ids = self.run_process([raw(body="publica 1")], None, db)
        self.assertEqual((ids, db2), ([], db))

    def test_candidata_caducada_se_cuenta_y_no_rompe(self):
        state = make_state()
        state[0]["candidates"] = [c for c in state[0]["candidates"] if c["id"] != "https://ex.com/c3"]
        _, _, decisions, db, count, ids = self.run_process([raw(body="todas")], state)
        self.assertEqual((count["ya_no_estaban"], len(ids)), (1, 3))


# =============================================================================================
class SendTests(unittest.TestCase):
    """El correo que SALE lleva lo que el lector necesita para reconocerlo (sin enviar nada)."""
    def test_cabeceras_y_partes_del_resumen(self):
        import resumen_diario as rd
        cand = {"id": "u1", "title": "Titulo <b>uno</b>", "source": "S", "url": "https://x/1", "date": "2026-11-14",
                "reason": "motivo", "score": None, "publish": {}}
        body = rd.render([], "14-11-2026", [cand], DIGEST)
        text = rd.render_text([], [cand], DIGEST, "14-11-2026")
        sent = {}

        class FakeSMTP:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def starttls(self): pass
            def login(self, u, p): sent["pw"] = p
            def sendmail(self, frm, to, msg): sent["msg"] = msg

        with mock.patch("smtplib.SMTP", FakeSMTP):
            rd.send(f"Asunto [{DIGEST}]", body, OWNER, OWNER, "abcd efgh ijkl mnop", text, DIGEST)
        parsed = cu.parse_message(sent["msg"].encode())
        self.assertEqual(sent["pw"], "abcdefghijklmnop")                         # sin espacios
        self.assertEqual(parsed[cu.DIGEST_HEADER], DIGEST)
        self.assertIn(DIGEST, parsed["Message-ID"])
        self.assertEqual(cu.find_digest_id(parsed), DIGEST)
        self.assertEqual([p.get_content_type() for p in parsed.iter_parts()], ["text/plain", "text/html"])
        self.assertNotIn("abcdefghijklmnop", sent["msg"])
        self.assertIn("&lt;b&gt;uno", body)                                       # el título se escapa
        self.assertIn("publica 2, 5 y 7", body)
        self.assertIn("1. Titulo", text)
        # el From lleva una dirección REAL (no metida dentro de una palabra codificada)
        self.assertEqual(parsed.get_all("From")[0].addresses[0].addr_spec, OWNER)
        # y el propio resumen, recibido en la bandeja (mismo remitente), NO se interpreta como respuesta del dueño
        self.assertEqual(cu.check_message(parsed, OWNER), (False, "es_resumen"))

    def test_sin_candidatas_el_correo_es_el_de_siempre(self):
        import resumen_diario as rd
        self.assertNotIn("Candidatas", rd.render([], "14-11-2026"))
        self.assertNotIn("Candidatas", rd.render([], "14-11-2026", [], None))


class FakeIMAP:
    """Doble de imaplib.IMAP4_SSL: solo lo que usa procesar_respuestas.fetch_raw_messages."""
    def __init__(self, raws):
        self.raws, self.calls, self.readonly = raws, [], None

    def select(self, box, readonly=False):
        self.readonly = readonly
        self.calls.append(("select", box))
        return "OK", [b"1"]

    def search(self, charset, *crit):
        self.calls.append(("search", crit))
        return "OK", [b" ".join(str(i + 1).encode() for i in range(len(self.raws)))]

    def fetch(self, num, what):
        self.calls.append(("fetch", what))
        return "OK", [(b"1 (BODY[] {1})", self.raws[int(num) - 1]), b")"]

    def logout(self):
        self.calls.append(("logout",))


class MainEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        self.paths = {"CANDIDATAS_FILE": os.path.join(t, "candidatas.json"), "DIGESTS_FILE": os.path.join(t, "digests.json"),
                      "DECISIONES_FILE": os.path.join(t, "decisiones.json")}
        self.equipo = os.path.join(t, "equipamiento.json")
        self.enviados = os.path.join(t, "enviados.json")
        cands, digests, decisions = make_state(sent=cu.utcnow() - timedelta(hours=1))
        for k, doc in zip(("CANDIDATAS_FILE", "DIGESTS_FILE", "DECISIONES_FILE"), (cands, digests, decisions)):
            cu.save_json(self.paths[k], doc)
        cu.save_json(self.equipo, [{"id": "viejo"}])
        cu.save_json(self.enviados, {"sent": ["a"]})
        self.env = {"RESUMEN_USER": OWNER, "RESUMEN_TO": OWNER, "GMAIL_APP_PASSWORD": "abcd efgh ijkl mnop"}
        self.patches = [mock.patch.object(cu, k, v) for k, v in self.paths.items()] + \
            [mock.patch.object(pr, "EQUIPO_FILE", self.equipo), mock.patch.object(pr, "ENVIADOS_FILE", self.enviados),
             mock.patch.dict(os.environ, self.env)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_main(self, raws):
        fake = FakeIMAP(raws)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = pr.main(imap_factory=lambda: fake, derived=False)
        return rc, buf.getvalue(), fake

    def test_flujo_completo_y_log_sin_datos_personales(self):
        secreto = raw(body="texto-que-no-debe-salir-en-el-log", mid="<sec@x>")     # válido pero no entendible
        rc, out, fake = self.run_main([raw(body="publica 2 y 3"), secreto,
                                       raw(body="todas", frm="atacante@gmail.com", mid="<z@x>")])
        self.assertEqual(rc, 0)
        self.assertTrue(fake.readonly)                                   # nunca modifica el buzón
        db = cu.load_json(self.equipo, [])
        self.assertEqual({e["id"] for e in db[:2]}, {"https://ex.com/c1", "https://ex.com/c4"})   # números 2 y 3
        dec = cu.load_json(self.paths["DECISIONES_FILE"], {})["decisions"]
        self.assertEqual(sorted(d["decision"] for d in dec), ["aceptada", "aceptada", "rechazada", "rechazada"])
        self.assertIn("a", cu.load_json(self.enviados, {})["sent"])
        self.assertIn("https://ex.com/c1", cu.load_json(self.enviados, {})["sent"])   # no se le reenvía como novedad
        for secreto in (OWNER, "atacante", "texto-que-no-debe-salir", "abcdefghijklmnop", "abcd", "mnop", "Titulo"):
            self.assertNotIn(secreto, out)
        self.assertIn("respuestas_aplicadas=1", out)
        self.assertIn("rechazado_from=1", out)

    def test_segunda_pasada_no_vuelve_a_aplicar(self):
        r = raw(body="publica 1")
        self.run_main([r])
        before = (open(self.equipo, encoding="utf-8").read(), open(self.paths["DECISIONES_FILE"], encoding="utf-8").read())
        rc, out, fake = self.run_main([r])
        after = (open(self.equipo, encoding="utf-8").read(), open(self.paths["DECISIONES_FILE"], encoding="utf-8").read())
        self.assertEqual(before, after)
        self.assertEqual(fake.calls, [])                 # y ni siquiera abrió el buzón: ya no hay resúmenes abiertos
        self.assertIn("no se abre el buzón", out)

    def test_sin_resumenes_pendientes_no_conecta(self):
        cu.save_json(self.paths["DIGESTS_FILE"], {"digests": {}, "processed": []})
        fake = FakeIMAP([])
        factory = mock.Mock(return_value=fake)
        with redirect_stdout(io.StringIO()):
            rc = pr.main(imap_factory=factory, derived=False)
        self.assertEqual(rc, 0)
        factory.assert_not_called()

    def test_la_busqueda_imap_usa_fecha_en_ingles_y_token(self):
        _, _, fake = self.run_main([])
        crit = [c for c in fake.calls if c[0] == "search"][0][1]
        self.assertEqual(crit[0], "SINCE")
        self.assertRegex(crit[1], r"^\d{2}-[A-Z][a-z]{2}-\d{4}$")
        self.assertEqual(crit[2:], ("SUBJECT", "CB-"))

    def test_faltan_variables(self):
        with mock.patch.dict(os.environ, {"RESUMEN_USER": "", "RESUMEN_TO": ""}, clear=False):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(pr.main(imap_factory=lambda: FakeIMAP([]), derived=False), 1)


# =============================================================================================
def decision(source, dec, date="2026-11-10", title="t"):
    return {"date": date, "source": source, "decision": dec, "title": title, "url": f"https://x/{title}-{source}"}


class LearningTests(unittest.TestCase):
    def policy(self, decisions):
        return cu.source_policy(decisions, NOW)

    def test_silenciar_a_las_cinco_rechazadas_con_cero_aceptadas(self):
        d = [decision("Tienda", "rechazada", title=str(i)) for i in range(5)]
        self.assertEqual(self.policy(d)["Tienda"]["action"], "mute")
        self.assertEqual(self.policy(d[:4])["Tienda"]["action"], "neutral")       # 4 no basta

    def test_una_aceptada_ya_no_se_silencia(self):
        d = [decision("Tienda", "rechazada", title=str(i)) for i in range(5)] + [decision("Tienda", "aceptada", title="ok")]
        self.assertEqual(self.policy(d)["Tienda"]["action"], "penalty")           # 1/6 < 25 %

    def test_bonus_y_neutral(self):
        d = [decision("Buena", "aceptada", title=str(i)) for i in range(3)] + [decision("Buena", "rechazada", title="r1"),
                                                                              decision("Buena", "rechazada", title="r2")]
        self.assertEqual(self.policy(d)["Buena"]["action"], "bonus")              # 3/5 = 60 %
        d = [decision("Media", "aceptada", title=str(i)) for i in range(2)] + [decision("Media", "rechazada", title=str(i + 9)) for i in range(3)]
        self.assertEqual(self.policy(d)["Media"]["action"], "neutral")            # 2/5 = 40 %

    def test_decisiones_viejas_no_cuentan(self):
        d = [decision("Vieja", "rechazada", date="2026-01-01", title=str(i)) for i in range(9)]
        self.assertNotIn("Vieja", self.policy(d))

    def test_fewshot_ultimas_40_y_formato(self):
        d = [decision("S", "aceptada" if i % 2 else "rechazada", title=f"titulo-{i}") for i in range(60)]
        block = cu.fewshot_block(d)
        lines = block.splitlines()
        self.assertEqual(len(lines), cu.FEWSHOT_N)
        self.assertIn("titulo-59", lines[-1])
        self.assertNotIn("titulo-19", block)                                      # las 20 más viejas, fuera
        self.assertTrue(lines[-1].startswith("- ACCEPTED [S]"))
        self.assertTrue(lines[-2].startswith("- REJECTED [S]"))

    def test_prompt_lleva_ejemplos_y_la_candidata(self):
        d = [decision("ZWO (YouTube)", "aceptada", title="ZWO lanza la ASI9999")]
        p = cu.build_candidate_prompt({"title": "Candidata rara", "source": "Fuente", "url": "https://x/1"}, "motivo X", d)
        self.assertIn("ACCEPTED [ZWO (YouTube)] ZWO lanza la ASI9999", p)
        self.assertIn("Candidata rara", p)
        self.assertIn("motivo X", p)
        self.assertNotIn("Past decisions", cu.build_candidate_prompt({"title": "t", "source": "s", "url": "u"}, "m", []))

    def test_seleccion_del_resumen(self):
        def cand(i, score, source="A", digest=None, status="pending"):
            return {"id": f"u{i}", "title": f"t{i}", "source": source, "url": f"u{i}", "date": f"2026-11-{10 + i:02d}",
                    "status": status, "score": score, "digest": digest, "reason": "r", "publish": {}}
        doc = {"candidates": [cand(1, 5), cand(2, 9), cand(3, 7, source="Muda"), cand(4, 8, digest="CB-old"),
                              cand(5, 1), cand(6, None), cand(7, 7, status="ia_descartada"), cand(8, 6), cand(9, 6)]}
        pol = {"Muda": {"action": "mute"}}
        sel = cu.select_for_digest(doc, {"u8"}, pol)
        # excluidos: u3 (fuente silenciada), u4 (ya salió), u5 (score<=2), u7 (descartada), u8 (ya publicada)
        self.assertEqual(set(c["id"] for c in sel), {"u1", "u2", "u6", "u9"})
        self.assertEqual(sel[0]["id"], "u2")                                       # la mejor puntuada primero
        self.assertEqual(len(cu.select_for_digest(doc, set(), pol, limit=2)), 2)

    def test_registro_del_resumen_fija_los_numeros(self):
        doc = {"candidates": [{"id": "a", "digest": None}, {"id": "b", "digest": None}]}
        digests = {"digests": {}, "processed": []}
        cu.register_digest(digests, doc, "CB-20261115-000000", doc["candidates"], NOW)
        self.assertEqual(digests["digests"]["CB-20261115-000000"]["ids"], ["a", "b"])
        self.assertTrue(all(c["digest"] == "CB-20261115-000000" for c in doc["candidates"]))

    def test_add_candidates_no_duplica_ni_readmite_lo_decidido(self):
        doc = {"candidates": []}
        mk = lambda u: {"id": u, "status": "pending", "score": None, "digest": None}
        self.assertEqual(cu.add_candidates(doc, [mk("a"), mk("b"), mk("a")], {"c"}), 2)
        self.assertEqual(cu.add_candidates(doc, [mk("a"), mk("c"), mk("d")], {"c"}), 1)


# =============================================================================================
class ScraperRelaxedCriteriaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with redirect_stdout(io.StringIO()):
            import scraper_equipment as se
        cls.se = se

    def item(self, title, source="Fuente", **kw):
        d = {"title": title, "source": source, "url": "https://ex.com/" + str(abs(hash(title))), "date": NOW.strftime("%Y-%m-%d"),
             "is_youtube": False, "is_mfg": False, "is_press": False, "body_content": ""}
        d.update(kw)
        return d

    def test_prensa_con_marca_sin_equipo_ni_modelo_es_candidata_y_el_estricto_la_descarta(self):
        t = "ZWO announces new educational partnership with schools"
        self.assertFalse(self.se.check_press_relevance(t))                 # el estricto la deja fuera (control en rojo)
        self.assertIn("ZWO", self.se.relaxed_reason(self.item(t, is_press=True), "prefiltro"))

    def test_prensa_de_astrofotografia_sin_marca(self):
        t = "Best backyard telescope for astrophotography beginners"
        self.assertFalse(self.se.check_press_relevance(t))
        self.assertIsNotNone(self.se.relaxed_reason(self.item(t, is_press=True), "prefiltro"))

    def test_prensa_de_ciencia_sin_marca_no_es_candidata(self):
        for t in ["Euclid telescope maps dark matter across the universe", "Webb telescope finds distant galaxy"]:
            self.assertIsNone(self.se.relaxed_reason(self.item(t, is_press=True), "prefiltro"), t)

    def test_marca_ambigua_no_basta(self):
        t = "NASA's Orion capsule completes splashdown test"
        self.assertFalse(self.se.check_press_relevance(t))                  # (no pasa el estricto)
        self.assertIsNone(self.se.relaxed_reason(self.item(t, is_press=True), "prefiltro"))
        self.assertIsNone(self.se.brand_in_title("Orion Nebula captured in new image"))
        self.assertIsNone(self.se.brand_in_title("The white dwarf star cools"))

    def test_prefiltro_solo_aplica_a_prensa(self):
        self.assertIsNone(self.se.relaxed_reason(self.item("ZWO video sobre algo", is_youtube=True), "prefiltro"))

    def test_ia_con_marca_si_sin_marca_no_y_foros_no(self):
        self.assertIn("Celestron", self.se.relaxed_reason(self.item("Celestron mount tutorial in depth"), "ia"))
        self.assertIsNone(self.se.relaxed_reason(self.item("How I process my images tonight"), "ia"))
        self.assertIsNone(self.se.relaxed_reason(self.item("Celestron mount help me", source="Stargazers Lounge"), "ia"))
        self.assertIsNotNone(self.se.relaxed_reason(self.item("Algo sin marca", source="ZWO (YouTube)", is_mfg=True), "ia"))

    def test_cuota(self):
        self.assertIsNotNone(self.se.relaxed_reason(self.item("ZWO ASI2600MM Pro review"), "cuota"))

    def test_relleno_y_editores_bloqueados_nunca(self):
        for via in ("cuota", "prefiltro", "ia"):
            self.assertIsNone(self.se.relaxed_reason(self.item("ZWO Black Friday giveaway #shorts", is_press=True), via))
            self.assertIsNone(self.se.relaxed_reason(self.item("ZWO ASI2600MM deals", source="MotorVsMotor", is_press=True), via))

    def test_gemini_candidata_recibe_ejemplos_y_marca_la_baja_puntuacion(self):
        se = self.se
        decisions = {"decisions": [decision("ZWO (YouTube)", "aceptada", title="EJEMPLO-ACEPTADO-1"),
                                   decision("Tienda", "rechazada", title="EJEMPLO-RECHAZADO-1")]}
        sent = []

        class Resp:
            def __init__(self, score):
                self.score = score
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                inner = {"score": self.score, "title_es": "ES", "title_en": "EN", "summary_es": "r", "summary_en": "s",
                         "category_es": "CÁMARAS", "category_en": "CAMERAS", "tags": ["ZWO"]}
                return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}]}).encode()

        scores = iter([8, 1])

        def fake_urlopen(req, *a, **k):
            sent.append(json.loads(req.data.decode())["contents"][0]["parts"][0]["text"])
            return Resp(next(scores))

        mk = lambda i: {"id": f"https://ex.com/g{i}", "title": f"Cand {i}", "source": "Fuente", "url": f"https://ex.com/g{i}",
                        "date": "2026-11-14", "reason": "motivo", "status": "pending", "score": None, "digest": None,
                        "first_seen": NOW.strftime("%Y-%m-%d"), "publish": {"title_es": "orig", "tags": []}}
        doc = {"candidates": [mk(1), mk(2)]}
        out = os.path.join(tempfile.mkdtemp(), "c.json")
        with mock.patch.object(se.urllib.request, "urlopen", fake_urlopen), mock.patch("time.sleep"), \
                mock.patch.object(se, "load_database", lambda: []), redirect_stdout(io.StringIO()):
            se.finish_curation(doc, [], {}, decisions, {}, "KEY-DE-PRUEBA", out, True, 0)
        self.assertEqual(len(sent), 2)
        self.assertTrue(all("EJEMPLO-ACEPTADO-1" in p and "EJEMPLO-RECHAZADO-1" in p for p in sent))  # few-shot llega a Gemini
        by = {c["id"]: c for c in doc["candidates"]}
        scored = sorted(c["score"] for c in doc["candidates"])
        self.assertEqual(scored, [1, 8])
        hi = [c for c in doc["candidates"] if c["score"] == 8][0]
        lo = [c for c in doc["candidates"] if c["score"] == 1][0]
        self.assertEqual((hi["status"], hi["publish"]["title_es"]), ("pending", "ES"))
        self.assertEqual(lo["status"], "ia_descartada")
        self.assertTrue(os.path.exists(out))

    def test_main_en_seco_genera_candidatas_y_no_toca_la_bitacora(self):
        se = self.se
        today = NOW.strftime("%Y-%m-%d")
        items = [
            self.item("ZWO announces new educational partnership with schools", "Space.com", is_press=True),
            self.item("Celestron EdgeHD 8 review for beginners", "Un Youtuber", is_youtube=True),
            self.item("Rumor: new QHY268M camera spotted", "Reddit r/telescopes"),
            self.item("ZWO Black Friday giveaway #shorts", "ZWO (YouTube)", is_youtube=True, is_mfg=True),
            self.item("Quarterly gadget digest", "Blog X", is_mfg=True),
            self.item("Euclid telescope maps dark matter", "Space.com", is_press=True),
        ]
        tmp = tempfile.mkdtemp()
        cpath = os.path.join(tmp, "c.json")
        eq_before = open(os.path.join(se.os.path.dirname(se.os.path.dirname(se.__file__)), "equipamiento.json"), encoding="utf-8").read()
        env = {"CANDIDATAS_FILE": cpath, "GEMINI_API_KEY": "", "GROQ_API_KEY": "", "DEEPSEEK_API_KEY": ""}
        with mock.patch.dict(os.environ, env), mock.patch.object(se, "SOURCES", [{"name": "x", "url": "u", "is_youtube": False}]), \
                mock.patch.object(se, "fetch_feed_items", lambda s: copy.deepcopy(items)), \
                mock.patch.object(se, "GITHUB_REPOS", []), mock.patch.object(se, "GITLAB_REPOS", []), \
                mock.patch.object(se, "save_database") as sd, \
                mock.patch.object(se, "regenerate_markdown_catalog") as rc, redirect_stdout(io.StringIO()):
            se.main()
        sd.assert_not_called()                                            # dry-run: la Bitácora no se toca
        rc.assert_not_called()
        doc = cu.load_json(cpath, {})
        titles = {c["title"]: c for c in doc["candidates"]}
        self.assertIn("ZWO announces new educational partnership with schools", titles)       # prensa: marca sin modelo
        self.assertNotIn("ZWO Black Friday giveaway #shorts", titles)                          # relleno
        self.assertNotIn("Euclid telescope maps dark matter", titles)                          # ciencia sin marca
        self.assertNotIn("Rumor: new QHY268M camera spotted", titles)                          # foro: fuera
        for c in doc["candidates"]:
            self.assertEqual(c["status"], "pending")
            for k in ("id", "title", "source", "url", "date", "reason", "publish"):
                self.assertTrue(c[k], k)
        eq_after = open(os.path.join(se.os.path.dirname(se.os.path.dirname(se.__file__)), "equipamiento.json"), encoding="utf-8").read()
        self.assertEqual(eq_before, eq_after)

    def test_la_cuota_convierte_en_candidatas_lo_que_no_cupo(self):
        se = self.se
        items = [self.item(f"ZWO ASI{2000 + i}MM Pro camera announcement", "Un Youtuber", is_youtube=True) for i in range(4)]
        tmp = tempfile.mkdtemp()
        cpath = os.path.join(tmp, "c.json")
        env = {"CANDIDATAS_FILE": cpath, "GEMINI_API_KEY": "", "GROQ_API_KEY": "", "DEEPSEEK_API_KEY": ""}
        with mock.patch.dict(os.environ, env), mock.patch.object(se, "SOURCES", [{"name": "x", "url": "u", "is_youtube": True}]), \
                mock.patch.object(se, "fetch_feed_items", lambda s: copy.deepcopy(items)), \
                mock.patch.object(se, "GITHUB_REPOS", []), mock.patch.object(se, "GITLAB_REPOS", []), \
                mock.patch.object(se, "MAX_OTHER_ITEMS", 1), redirect_stdout(io.StringIO()):
            se.main()
        doc = cu.load_json(cpath, {})
        self.assertGreaterEqual(len(doc["candidates"]), 1)
        self.assertTrue(all("límite" in c["reason"] for c in doc["candidates"]))

    def test_cupo_agotado_no_pierde_la_prensa_que_el_estricto_descartaria(self):
        # Con el cupo de prensa a 0, el item ni llega al pre-filtro: antes de offer_skipped se perdía.
        se = self.se
        items = [self.item("ZWO announces new educational partnership with schools", "Space.com", is_press=True),
                 self.item("Euclid telescope maps dark matter", "Space.com", is_press=True),
                 self.item("ZWO ASI2600MM Pro camera launch", "Space.com", is_press=True)]
        cpath = os.path.join(tempfile.mkdtemp(), "c.json")
        env = {"CANDIDATAS_FILE": cpath, "GEMINI_API_KEY": "", "GROQ_API_KEY": "", "DEEPSEEK_API_KEY": ""}
        with mock.patch.dict(os.environ, env), mock.patch.object(se, "SOURCES", [{"name": "x", "url": "u", "is_youtube": False}]), \
                mock.patch.object(se, "fetch_feed_items", lambda s: copy.deepcopy(items)), \
                mock.patch.object(se, "GITHUB_REPOS", []), mock.patch.object(se, "GITLAB_REPOS", []), \
                mock.patch.object(se, "MAX_PRESS_ITEMS", 0), redirect_stdout(io.StringIO()):
            se.main()
        by = {c["title"]: c["reason"] for c in cu.load_json(cpath, {})["candidates"]}
        self.assertIn("cita ZWO", by["ZWO announces new educational partnership with schools"])   # relajado
        self.assertIn("límite", by["ZWO ASI2600MM Pro camera launch"])                                # pasaba el estricto
        self.assertNotIn("Euclid telescope maps dark matter", by)

    def test_resena_editorial_sin_marca(self):
        self.assertIn("reseña editorial", self.se.relaxed_reason(self.item("REVIEW: Spectrum Optics SkyPilot 127", "Astronomy.com", is_press=True), "prefiltro"))
        self.assertIsNone(self.se.relaxed_reason(self.item("REVIEW: NASA mission to Mars rover lander", "Astronomy.com", is_press=True), "prefiltro"))
        self.assertIsNone(self.se.relaxed_reason(self.item("Review of the year in astronomy", "Astronomy.com", is_press=True), "prefiltro"))

    def test_si_curacion_falla_el_estricto_sigue(self):
        se = self.se
        bad = os.path.join(tempfile.mkdtemp(), "roto.json")
        with open(bad, "w") as f:
            f.write("{no es json")
        items = [self.item("ZWO ASI2600MM Pro review", "Un Youtuber", is_youtube=True)]
        env = {"CANDIDATAS_FILE": bad, "GEMINI_API_KEY": "", "GROQ_API_KEY": "", "DEEPSEEK_API_KEY": ""}
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(se, "SOURCES", [{"name": "x", "url": "u", "is_youtube": True}]), \
                mock.patch.object(se, "fetch_feed_items", lambda s: copy.deepcopy(items)), \
                mock.patch.object(se, "GITHUB_REPOS", []), mock.patch.object(se, "GITLAB_REPOS", []), redirect_stdout(out):
            se.main()
        self.assertIn("Candidatas desactivadas", out.getvalue())
        self.assertIn("DRY-RUN", out.getvalue())                          # el camino estricto llegó hasta el final


if __name__ == "__main__":
    unittest.main()
