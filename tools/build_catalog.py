# -*- coding: utf-8 -*-
"""
Genera annotate-catalog.json (pestaña Anotar) a partir de fuentes GRATUITAS:

  - OpenNGC (github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0): NGC/IC completos +
    addendum (M45, M40...). Aporta tipo, tamano (ejes/PA), magnitud, cruce
    Messier y NOMBRES COMUNES.
  - Sharpless Sh2 (VizieR VII/20): nebulosas H-alpha (clave en banda estrecha).
  - Barnard (VizieR VII/220A): nebulosas oscuras.

Se ejecuta EN DESARROLLO (descarga por red) y el JSON resultante se commitea
como asset estatico: en runtime la web no toca ninguna API.

Formato de salida (compacto, arrays):
  { "v": 1, "objects": [ [name, common, cat, ra, dec, majA, minA, pa, mag], ... ] }
  cat: "g"=galaxia, "n"=nebulosa (incl. oscuras/SNR/PN), "c"=cumulo, "s"=estrellas
  ra/dec en grados J2000; majA/minA en arcmin; pa en grados; mag (V o B) o null.

Filtro de inclusion NGC/IC (evitar 14k etiquetas-ruido):
  nombre comun  O  numero Messier  O  majAx>=1.5'  O  mag<=13
Dedup: se omiten Sh2/Barnard a <10' de una nebulosa NGC/IC ya incluida.

Uso:  python tools/build_catalog.py          (regenera annotate-catalog.json)
"""
import csv
import io
import json
import math
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "annotate-catalog.json")

OPENNGC_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv"
ADDENDUM_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv"
SHARPLESS_URL = ("https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=VII/20/catalog"
                 "&-out.max=unlimited&-out.add=_RAJ2000,_DEJ2000&-out=Sh2&-out=Diam")
BARNARD_URL = ("https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=VII/220A/barnard"
               "&-out.max=unlimited&-out.add=_RAJ2000,_DEJ2000&-out=Barn&-out=Diam")

CAT_MAP = {
    "G": "g", "GPair": "g", "GTrpl": "g", "GGroup": "g",
    "PN": "n", "HII": "n", "EmN": "n", "Neb": "n", "RfN": "n", "SNR": "n",
    "DrkN": "n", "Cl+N": "n", "Nova": "n",
    "OCl": "c", "GCl": "c",
    "*": "s", "**": "s", "*Ass": "s",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CabraSpace catalog builder)"})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")


def sex_to_deg(s, is_ra):
    """'05:35:17.3' (horas) / '-05:23:28' (grados) -> grados decimales."""
    s = (s or "").strip()
    if not s:
        return None
    sign = -1.0 if s.startswith("-") else 1.0
    s = s.lstrip("+-")
    parts = s.split(":")
    try:
        v = float(parts[0]) + float(parts[1]) / 60.0 + (float(parts[2]) if len(parts) > 2 else 0.0) / 3600.0
    except (ValueError, IndexError):
        return None
    return sign * v * (15.0 if is_ra else 1.0)


def parse_openngc(text, out, neb_positions):
    rd = csv.DictReader(io.StringIO(text), delimiter=";")
    n_in = 0
    for row in rd:
        typ = (row.get("Type") or "").strip()
        cat = CAT_MAP.get(typ)
        if not cat:
            continue  # Dup / NonEx / Other / sin tipo
        ra = sex_to_deg(row.get("RA"), True)
        dec = sex_to_deg(row.get("Dec"), False)
        if ra is None or dec is None:
            continue
        name = (row.get("Name") or "").strip()
        common = (row.get("Common names") or "").split(",")[0].strip()
        messier = (row.get("M") or "").strip()
        try:
            maj = float(row.get("MajAx") or 0)
        except ValueError:
            maj = 0.0
        try:
            mino = float(row.get("MinAx") or 0)
        except ValueError:
            mino = 0.0
        try:
            pa = float(row.get("PosAng") or 0)
        except ValueError:
            pa = 0.0
        mag = None
        for k in ("V-Mag", "B-Mag"):
            try:
                mag = float(row.get(k) or "")
                break
            except ValueError:
                continue
        # Filtro: comun O Messier O tamano O brillo
        if not (common or messier or maj >= 1.5 or (mag is not None and mag <= 13.0)):
            continue
        # Nombre visible: Messier gana ("M 42"); si no, la designacion formateada
        # ("NGC0224"->"NGC 224", "IC0434"->"IC 434", "B033"->"B 33").
        if messier:
            disp = "M " + messier.lstrip("0")
        else:
            m = re.match(r"^([A-Za-z]+)0*(\d+)(.*)$", name)
            disp = (m.group(1) + " " + m.group(2) + m.group(3)) if m else name
        out.append([disp, common, cat, round(ra, 5), round(dec, 5),
                    round(maj, 1), round(mino, 1), round(pa, 0),
                    round(mag, 1) if mag is not None else None])
        if cat == "n":
            neb_positions.append((ra, dec))
        n_in += 1
    return n_in


def parse_vizier_tsv(text, name_col, prefix, out, neb_positions, dedup_arcmin=10.0):
    """TSV de VizieR: cabecera con nombres de columna tras los comentarios '#'."""
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    if not lines:
        return 0
    header = lines[0].split("\t")
    idx = {h.strip(): i for i, h in enumerate(header)}
    n_in = 0
    dd = dedup_arcmin / 60.0
    for line in lines[2:]:  # salta cabecera + linea de '---'
        cols = line.split("\t")
        if len(cols) < len(header):
            continue
        try:
            ra = float(cols[idx["_RAJ2000"]])
            dec = float(cols[idx["_DEJ2000"]])
            num = cols[idx[name_col]].strip()
            diam = float((cols[idx["Diam"]]).strip() or 0)
        except (ValueError, KeyError, IndexError):
            continue
        if not num:
            continue
        # Dedup contra nebulosas NGC/IC ya incluidas (evita doble etiqueta NGC7000+Sh2-117)
        cosd = math.cos(math.radians(dec))
        if any(abs(dec - d0) < dd and abs(ra - r0) * cosd < dd for r0, d0 in neb_positions):
            continue
        out.append([prefix + num, "", "n", round(ra, 5), round(dec, 5),
                    round(diam, 1), round(diam, 1), 0, None])
        n_in += 1
    return n_in


def main():
    out = []
    neb_positions = []

    print("Descargando OpenNGC...")
    n1 = parse_openngc(fetch(OPENNGC_URL), out, neb_positions)
    print("  NGC/IC incluidos:", n1)
    print("Descargando OpenNGC addendum...")
    n2 = parse_openngc(fetch(ADDENDUM_URL), out, neb_positions)
    print("  addendum incluidos:", n2)
    print("Descargando Sharpless (VizieR VII/20)...")
    try:
        n3 = parse_vizier_tsv(fetch(SHARPLESS_URL), "Sh2", "Sh2-", out, neb_positions)
        print("  Sh2 incluidos:", n3)
    except Exception as e:
        print("  AVISO: Sharpless omitido:", e)
    print("Descargando Barnard (VizieR VII/220A)...")
    try:
        n4 = parse_vizier_tsv(fetch(BARNARD_URL), "Barn", "B ", out, neb_positions)
        print("  Barnard incluidos:", n4)
    except Exception as e:
        print("  AVISO: Barnard omitido:", e)

    data = {"v": 1, "objects": out}
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(OUT) / 1024.0
    cats = {}
    for o in out:
        cats[o[2]] = cats.get(o[2], 0) + 1
    print(f"OK: {len(out)} objetos -> annotate-catalog.json ({kb:.0f} KB) · por categoria: {cats}")


if __name__ == "__main__":
    main()
