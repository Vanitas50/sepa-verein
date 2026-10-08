# SEPA-Lastschrift für Vereine

Kostenloses Browser-Werkzeug, um **Mitgliedsbeiträge per SEPA-Lastschrift** einzuziehen.

### ➡️ https://vanitas50.github.io/sepa-verein/

## Funktionen
- Mitgliederliste als **Excel (.xlsx)** oder CSV hochladen
- Prüft **IBAN (mod-97)**, BIC, Beträge, Mandatsreferenzen und Mandatsdaten
- Erzeugt eine bankfähige **SEPA-Datei** (`pain.008.001.08`, ISO 20022, CORE)
- **Prenotification**-Text (14-Tage-Ankündigung, Pflichtangaben)
- **Kontenabgleich**: CAMT.053-Kontoauszug einlesen → wer bezahlt hat / wer offen ist

## Datenschutz
Läuft **vollständig im Browser**. Keine Mitgliederdaten werden hochgeladen.

## Offline
`dist/sepa-lastschrift.html` – eine einzige Datei, funktioniert ohne Server/Internet.

## Entwicklung
- `sepa.js` – pain.008-Erzeugung & Validierung
- `xlsx.js` – Excel-Import (ZIP + DecompressionStream, ohne Bibliotheken)
- `abgleich.js` – CAMT.053-Kontenabgleich
- `build.mjs` – baut die self-contained Offline-Datei
- Tests: `node test_sepa.mjs`, `node test_xlsx.mjs`, `node test_abgleich.mjs`, `node test_dist.mjs`, `node test_e2e.mjs`
