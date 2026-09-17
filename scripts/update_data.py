"""
Stahuje ceny denního trhu OTE (EUR/MWh), kurz ČNB (z kurzovního lístku OTE)
a výrobu elektřiny v ČR (Energy-Charts, Fraunhofer ISE – data původem z ENTSO-E)
a ukládá je do docs/data/ote_RRRR.json. Spouští GitHub Actions dvakrát denně.

- doplní chybějící dny od 1. 1. 2025 do zítřka (pokud už je zveřejněn)
- přepočítá dny s předběžným kurzem (kurz ČNB pro den dodávky ještě nebyl vyhlášen)
- výpočty (okna, statistiky) dělá až web v prohlížeči
"""
import datetime as dt
import io
import json
import sys
import time
import zipfile
import re
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

TZ = ZoneInfo("Europe/Prague")
START = dt.date(2025, 1, 1)
OTE = "https://www.ote-cr.cz"
DATA = Path(__file__).resolve().parent.parent / "docs" / "data"
HEADERS = {"User-Agent": "spot-ceny-dashboard (GitHub Actions; osobni projekt)"}
ENERGY_CHARTS = "https://api.energy-charts.info/public_power"
GEN_SERIES = {"solar": ["Solar"], "wind": ["Wind onshore", "Wind offshore"], "load": ["Load"],
              "nuclear": ["Nuclear"],
              "fossil": ["Fossil brown coal / lignite", "Fossil hard coal", "Fossil oil", "Fossil gas"]}

session = requests.Session()
session.headers.update(HEADERS)


def get(url, **kw):
    for attempt in range(4):
        try:
            r = session.get(url, timeout=30, **kw)
            if r.status_code == 200:
                return r
            print(f"  HTTP {r.status_code} {url}")
        except requests.RequestException as e:
            print(f"  chyba {e} {url}")
        time.sleep(2 * (attempt + 1))
    return None


def parse_ote(payload):
    """Vrátí (rozlišení v min, [ceny EUR]) nebo None, pokud den ještě není zveřejněn."""
    lines = (payload or {}).get("data", {}).get("dataLine", []) or []
    s15 = next((s for s in lines if re.search(r"15\s*min cena", s.get("title", ""), re.I)), None)
    s60 = next((s for s in lines if re.match(r"Cena", s.get("title", ""), re.I)), None)
    s = s15 or s60
    if not s or not s.get("point"):
        return None
    pts = sorted(s["point"], key=lambda p: int(float(p["x"])))
    vals = []
    for p in pts:
        try:
            vals.append(round(float(p["y"]), 3))
        except (TypeError, ValueError):
            pass
    if not vals:
        return None
    return (15 if s15 else 60), vals


def fetch_day(d):
    r = get(f"{OTE}/cs/kratkodobe-trhy/elektrina/denni-trh/@@chart-data", params={"report_date": d.isoformat()})
    if r is None:
        return None
    try:
        return parse_ote(r.json())
    except ValueError:
        return None


def parse_rate_xlsx(content):
    """Kurzovní lístek ČNB (EUR) od OTE: sloupec A = datum (excel číslo), B = kurz."""
    rates = {}
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        a = re.search(r'<c[^>]*r="A\d+"[^>]*>(?:<f>[^<]*</f>)?<v>([\d.]+)</v>', row)
        b = re.search(r'<c[^>]*r="B\d+"[^>]*>(?:<f>[^<]*</f>)?<v>([\d.]+)</v>', row)
        if not a or not b:
            continue
        serial, rate = float(a.group(1)), float(b.group(1))
        if serial < 40000 or not 10 < rate < 50:
            continue
        rates[(dt.date(1899, 12, 30) + dt.timedelta(days=round(serial))).isoformat()] = rate
    return rates


def load_rates(years):
    rates = {}
    for y in sorted(years):
        r = get(f"{OTE}/pubweb/attachments/01/{y}/Kurzovni_listek_CNB_{y}.xlsx")
        if r is not None:
            rates.update(parse_rate_xlsx(r.content))
    return rates


def rate_for(rates, d):
    key = d.isoformat()
    if key in rates:
        return rates[key], key, False
    earlier = sorted(k for k in rates if k < key)
    if not earlier:
        return None
    return rates[earlier[-1]], earlier[-1], True


def fetch_generation(months):
    """Výroba po 15 minutách po měsících. Energy-Charts občas vrací 429, proto pomalu a s opakováním."""
    out = {}
    for (y, m) in sorted(months):
        last = (dt.date(y + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1)).day
        params = {"country": "cz", "start": f"{y}-{m:02d}-01", "end": f"{y}-{m:02d}-{last}"}
        r = None
        for attempt in range(6):                    # Energy-Charts občas odpoví 429, počkáme a zkusíme znovu
            r = get(ENERGY_CHARTS, params=params)
            if r is not None:
                break
            time.sleep(20 * (attempt + 1))
        if r is None:
            print(f"  výroba {y}-{m:02d}: nedostupná, doplní se příště")
            continue
        try:
            j = r.json()
        except ValueError:
            continue
        series = {p.get("name"): p.get("data", []) for p in j.get("production_types", [])}
        stamps = j.get("unix_seconds", [])
        for i, ts in enumerate(stamps):
            day = dt.datetime.fromtimestamp(ts, TZ).date().isoformat()
            g = out.setdefault(day, {k: [] for k in GEN_SERIES})
            for key, names in GEN_SERIES.items():
                vals = [series.get(n, [])[i] for n in names if i < len(series.get(n, []))]
                vals = [v for v in vals if v is not None]
                g[key].append(round(sum(vals)) if vals else None)
        time.sleep(5)
    return out


def fetch_germany(months):
    """Německé denní průměry (slunce, vítr, spotřeba) – kontext pro vysvětlení cen."""
    out = {}
    for (y, m) in sorted(months):
        last = (dt.date(y + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1)).day
        params = {"country": "de", "start": f"{y}-{m:02d}-01", "end": f"{y}-{m:02d}-{last}"}
        r = None
        for attempt in range(6):                    # Energy-Charts občas odpoví 429, počkáme a zkusíme znovu
            r = get(ENERGY_CHARTS, params=params)
            if r is not None:
                break
            time.sleep(20 * (attempt + 1))
        if r is None:
            continue
        try:
            j = r.json()
        except ValueError:
            continue
        series = {p.get("name"): p.get("data", []) for p in j.get("production_types", [])}
        acc = {}
        for i, ts in enumerate(j.get("unix_seconds", [])):
            day = dt.datetime.fromtimestamp(ts, TZ).date().isoformat()
            a = acc.setdefault(day, {"solar": 0.0, "wind": 0.0, "load": 0.0, "n": 0})
            val = lambda name: (series.get(name, [None] * (i + 1))[i] or 0)
            a["solar"] += val("Solar")
            a["wind"] += val("Wind onshore") + val("Wind offshore")
            a["load"] += val("Load")
            a["n"] += 1
        for day, a in acc.items():
            if a["n"]:
                out[day] = {"solar": round(a["solar"] / a["n"]), "wind": round(a["wind"] / a["n"]), "load": round(a["load"] / a["n"])}
        time.sleep(5)
    return out


def main():
    today = dt.datetime.now(TZ).date()
    tomorrow = today + dt.timedelta(days=1)
    store = {}
    for y in range(START.year, tomorrow.year + 1):
        f = DATA / f"ote_{y}.json"
        store[y] = json.loads(f.read_text()) if f.exists() else {}

    todo = []
    d = START
    while d <= tomorrow:
        e = store[d.year].get(d.isoformat())
        if e is None or e.get("provisional"):
            todo.append(d)
        d += dt.timedelta(days=1)
    print(f"Ke zpracování: {len(todo)} dní")
    if not todo:
        return 0

    rates = load_rates({x.year for x in todo} | {x.year - 1 for x in todo if x.month == 1})
    if not rates:
        print("Kurzovní lístek se nepodařilo stáhnout.")
        return 1

    changed = 0
    for d in todo:
        key = d.isoformat()
        existing = store[d.year].get(key)
        ri = rate_for(rates, d)
        if ri is None:
            continue
        if existing and existing.get("eur"):
            res, eur = existing["res"], existing["eur"]      # ceny už máme, jen přepočet kurzu
        else:
            got = fetch_day(d)
            if got is None:
                print(f"  {key}: zatím nezveřejněno")
                continue
            res, eur = got
        entry = {"res": res, "eur": eur, "rate": ri[0], "rateDate": ri[1], "provisional": ri[2]}
        if entry != existing:
            store[d.year][key] = entry
            changed += 1
            print(f"  {key}: {len(eur)} period, kurz {ri[0]}{' (předběžný)' if ri[2] else ''}")

    # --- výroba (slunce, vítr, spotřeba, jádro, fosilní zdroje) ---
    gen = {}
    for y in range(START.year, tomorrow.year + 1):
        f = DATA / f"gen_{y}.json"
        gen[y] = json.loads(f.read_text()) if f.exists() else {}
    months = set()
    d = START
    while d <= today:
        if d.isoformat() not in gen[d.year] or d >= today - dt.timedelta(days=3):
            months.add((d.year, d.month))     # měsíc doplníme celý; poslední dny se ještě dopřesňují
        d += dt.timedelta(days=1)
    if months:
        print(f"Výroba – měsíce ke stažení: {len(months)}")
        for day, g in fetch_generation(months).items():
            y = int(day[:4])
            if y in gen:
                gen[y][day] = g
        for y, content in gen.items():
            if content:
                (DATA / f"gen_{y}.json").write_text(json.dumps(dict(sorted(content.items())), separators=(",", ":")))

    # --- Německo (denní průměry) ---
    de = {}
    for y in range(START.year, tomorrow.year + 1):
        f = DATA / f"gen_de_{y}.json"
        de[y] = json.loads(f.read_text()) if f.exists() else {}
    de_months = set()
    d = START
    while d <= today:
        if d.isoformat() not in de[d.year] or d >= today - dt.timedelta(days=3):
            de_months.add((d.year, d.month))
        d += dt.timedelta(days=1)
    if de_months:
        for day, g in fetch_germany(de_months).items():
            y = int(day[:4])
            if y in de:
                de[y][day] = g
        for y, content in de.items():
            if content:
                (DATA / f"gen_de_{y}.json").write_text(json.dumps(dict(sorted(content.items())), separators=(",", ":")))

    for y, content in store.items():
        if content:
            ordered = dict(sorted(content.items()))
            (DATA / f"ote_{y}.json").write_text(json.dumps(ordered, separators=(",", ":")))
    (DATA / "meta.json").write_text(json.dumps({
        "updated": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "changedDays": changed,
        "genDays": sum(len(v) for v in gen.values()),
    }))
    print(f"Změněno dní: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
