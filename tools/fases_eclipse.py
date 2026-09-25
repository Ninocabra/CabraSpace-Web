"""
Phase discs of the 12-08-2026 eclipse page (obs/eclipse-2026/fase-*.jpg), from the Vespera Pro frames.

Every disc is cut the same way: centred on the Sun's centre measured by the timelapse pipeline
(video/pipeline/centros2.csv, model correlation on 442 px thumbnails = frame / 8), with a half-side of
1.25 solar radii (Rs = 35.5 x 2 thumbnail px, efem.pkl), background subtracted, normalised on the
brightest part of the Sun and painted with one warm palette. The Vespera saves two kinds of JPEG with
different colour (warm and grey); painting the luminance with a single palette keeps the series
uniform, which is why none comes out green any more.

Totality is not in the Vespera frames (18:30:30-18:32:30 only noise comes through the solar filter),
so its disc is cut from the CabraEclipse corona (Fuji X-T5) around the Moon.

    python tools/fases_eclipse.py
"""
import csv
import glob
import json
import os
import numpy as np
from PIL import Image

SRC = r"E:\ASTRO Sin Procesar\Vespera PRO\Imagenes\Eclipse Agosto 2026"
FRAMES = os.path.join(SRC, "02-observation", "01-images")
CENTRES = os.path.join(SRC, "video", "pipeline", "centros2.csv")
CORONA = r"C:\Users\ninoc\Downloads\CabraEclipse_v3.45.0_final.jpg"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "obs", "eclipse-2026")

THUMB = 8                      # frames are 3536 px, thumbnails 442 px
R_SUN = 35.5 * 2 * THUMB       # solar radius in frame pixels
HALF = 1.25 * R_SUN
SIZE = 600
GOLD = np.array([255, 178, 70], np.float32)
BG = np.array([22, 15, 11], np.float32)

# UTC minute:second wanted -> the nearest frame is used; None marks totality
WANTED = ["17:37:38", "17:52:00", "18:05:00", "18:15:00", "18:22:00", "18:28:00", None,
          "18:35:00", "18:38:00", "18:41:00", "18:44:00", "18:47:00", "18:49:00", "18:51:00"]


def frames():
    out = []
    for f in sorted(glob.glob(os.path.join(FRAMES, "2026-08-12_*.jpeg"))):
        b = os.path.basename(f)
        hh, mm, ss = b[11:13], b[14:16], b[17:19]
        idx = int(b.rsplit("_", 1)[1].split(".")[0])
        out.append((int(hh) * 3600 + int(mm) * 60 + int(ss), idx, f))
    return out


def disc(path, cx, cy):
    im = Image.open(path).convert("L")
    a = np.asarray(im, np.float32)
    a = np.clip(a - np.median(a), 0, None)
    box = (int(round(cx - HALF)), int(round(cy - HALF)), int(round(cx + HALF)), int(round(cy + HALF)))
    crop = Image.fromarray(a).crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    c = np.asarray(crop, np.float32)
    top = np.percentile(c[c > 0], 99.5) if (c > 0).any() else 1.0
    n = np.clip(c / max(top, 1e-3), 0, 1) ** 0.85
    rgb = BG + n[..., None] * (GOLD - BG)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def totality():
    im = Image.open(CORONA).convert("RGB")
    small = np.asarray(im.reduce(8).convert("L"), np.float32)
    dark = small < 20
    ys, xs = np.nonzero(dark[small.shape[0] // 4: 3 * small.shape[0] // 4, small.shape[1] // 4: 3 * small.shape[1] // 4])
    cy = (ys.mean() + small.shape[0] // 4) * 8
    cx = (xs.mean() + small.shape[1] // 4) * 8
    r_moon = np.sqrt(len(xs) / np.pi) * 8
    half = 1.25 * r_moon * 1.35          # a little wider than the others, to show the inner corona
    return im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half))).resize((SIZE, SIZE), Image.LANCZOS), (cx, cy, r_moon)


def main():
    centres = {int(r["idx"]): r for r in csv.DictReader(open(CENTRES))}
    # only frames whose centre the pipeline trusts: from 18:51 the disc sinks behind the horizon and
    # the model correlation drops (cal 0.82 at 18:51:01, 0.55 at 18:52:30)
    fr = [x for x in frames() if centres.get(x[1], {}).get("ok") == "1" and float(centres[x[1]]["cal"]) >= 0.8]
    phases = []
    for k, w in enumerate(WANTED, 1):
        name = f"fase-{k}.jpg"
        if w is None:
            img, info = totality()
            img.save(os.path.join(OUT, name), quality=88, optimize=True)
            phases.append({"src": f"obs/eclipse-2026/{name}", "time": "18:31", "totality": True,
                           "frame": "CabraEclipse_v3.45.0_final.jpg (Fuji X-T5)"})
            continue
        h, m, s = map(int, w.split(":"))
        t = h * 3600 + m * 60 + s
        sec, idx, path = min(fr, key=lambda x: abs(x[0] - t))
        r = centres[idx]
        img = disc(path, float(r["x"]) * THUMB, float(r["y"]) * THUMB)
        img.save(os.path.join(OUT, name), quality=88, optimize=True)
        phases.append({"src": f"obs/eclipse-2026/{name}", "time": f"{(sec + 30) // 3600:02d}:{(sec + 30) % 3600 // 60:02d}",
                       "frame": os.path.basename(path)})
    print(json.dumps(phases, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
