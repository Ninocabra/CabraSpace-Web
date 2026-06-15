"""
Genera latest.json: un resumen ligero (3 software + 3 equipamiento) para el dashboard de la
home. Asi la portada no descarga novedades.json + equipamiento.json enteros (~217 KB) solo para
mostrar 6 tarjetas. Se ejecuta al final del scraper (ver .github/workflows/scraper.yml).

Uso:  python tools/build_latest.py     (desde la raiz del repo)
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Campos que consume el dashboard (index.js). Nada mas, para que el fichero sea minusculo.
FIELDS = ("title_es", "title_en", "category_es", "category_en", "date", "url")
N = 3


def slim(filename, n):
    path = os.path.join(ROOT, filename)
    if not os.path.exists(path):
        print(f"  (falta {filename}, se omite)")
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"  Error leyendo {filename}: {e}")
        return []
    # Las BD ya estan ordenadas de mas nuevo a mas viejo (el scraper antepone lo nuevo).
    return [{k: item.get(k, "") for k in FIELDS} for item in data[:n]]


def main():
    latest = {
        "software": slim("novedades.json", N),
        "hardware": slim("equipamiento.json", N),
    }
    out = os.path.join(ROOT, "latest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=2)
    print(f"latest.json: {len(latest['software'])} software + {len(latest['hardware'])} hardware")


if __name__ == "__main__":
    main()
