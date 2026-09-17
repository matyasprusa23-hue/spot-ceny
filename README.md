# ⚡ Spotové ceny elektřiny – přehled

Web s nejdražšími a nejlevnějšími dvěma hodinami na denním trhu s elektřinou v ČR.

- **Data:** OTE, a.s. (denní trh) + kurz ČNB z kurzovního lístku OTE
- **Aktualizace:** GitHub Actions (`.github/workflows/update-data.yml`) několikrát denně spustí `scripts/update_data.py`, který doplní nové dny do `docs/data/ote_RRRR.json`
- **Web:** statická stránka ve složce `docs/` (GitHub Pages), grafy Apache ECharts (`docs/vendor`)
- **Výpočty:** `docs/analysis.js` – okna se počítají stejně jako v Google Tabulce

Ruční spuštění aktualizace: záložka **Actions → Aktualizace cen → Run workflow**.
