# Datenvergleich

Interaktiver Fahrplanvergleich **DINO ZVV → HRDF NeRED V2 → INFO+**.

**Seite:** https://to-mdv.github.io/datenvergleich/

Die Ansicht bietet eine Karte, eine Fahrplantabelle mit einer Spalte je SJYID,
Kalender, Quellblöcke und einen fachlichen Vergleich. Datenstände lassen sich einzeln
einblenden; die Bereiche sind über Trennleisten verstellbar. Die ausgewählte Linie
zeigt ihre Haltestellen stets als rote Punkte.

## Enthaltene Daten

Fahrplanperiode: **13.12.2026–11.12.2027**. Aufbereitung: **23.11.2026**.

| Datenstand | Quellblöcke |
|---|---:|
| DINO ZVV | 116’863 |
| HRDF NeRED V2 | 85’935 |
| INFO+ ZVV 12.11. | 107’174 |
| INFO+ Gesamt 30.10. | 921’325 |

V1 wird nicht ausgeliefert. Der nationale Gesamtbestand ist der bestätigte ältere
Vergleichsstand vom 30.10.2026. Der genaue fachliche Stand von DINO und NeRED ist
offen; INFO+ ist kein nachgewiesener Nachlauf von V2. Farbmarkierungen zeigen
Unterschiede und beweisen allein keinen Datenverlust. METABHF und UMSTEIGB sind
ausgeschlossen, da INFO+ dafür Master ist.

Verglichen werden Halte und Zeiten, Verkehrstage, Richtungstexte (*R/RICHTUNG),
Verkehrsmittel (*G/ZUGART), Linienbezeichnungen (*L/LINIE), Haltecodes,
Attribute (*A/ATTRIBUT), Verkehrshinweise (*I hi) und weitere Infotexte sowie
Durchbindungen (DURCHBI). Referenzen werden aufgelöst; Halteabschnitte und
Verkehrstage bleiben erhalten. Unklare oder nicht direkt abbildbare Merkmale
werden als solche angezeigt. DINO-Anschlussregeln mit allgemeinen Zeitfenstern
werden nicht durch eine geratene Auswahl in konkrete DURCHBI-Paare umgewandelt.

OJP-Demo-Links fragen den aktuellen Auskunftsbestand ab und sind keine Abfrage
der hier veröffentlichten historischen Lieferung.

## Betrieb auf GitHub Pages

`docs/` ist die vollständig statische Website. GitHub Pages veröffentlicht diesen
Ordner vom Branch `main`. Es gibt keinen Python-Webserver und keine Verbindung
zu einem lokalen Rechner. Der Browser führt die vorhandene Vergleichslogik in
einem Web Worker mit **Pyodide 314.0.8** aus. SQLite-Daten werden komprimiert und
pro Linie nachgeladen. Die Übersicht lädt einmalig rund 11,5 MB Kartendaten;
einzelne Linien benötigen höchstens rund 1,6 MB komprimierte Fahrplandaten.

Ein moderner Browser mit WebAssembly und Internetzugriff für die Grundkarte ist
erforderlich. Der erste Start lädt zusätzlich die gebündelte Python-Laufzeit.

Lokal prüfen:

```powershell
python -m http.server 8878 --bind 127.0.0.1 --directory docs
```

## Daten neu aufbereiten

Die ursprüngliche lokale SQLite-Datei wird nicht hochgeladen. Die sichtbaren
Daten werden über einen expliziten Eingabepfad exportiert:

```powershell
python tools/export_data.py --source '<Pfad>/timetables.sqlite' --output docs/data
python tools/verify_export.py --source '<Pfad>/timetables.sqlite'
```

`docs/data/manifest.json` enthält die Zuordnung von Linien zu Dateien,
Quellzählungen, Dateigrössen und SHA-256-Prüfsummen.

## Bibliotheken und Karten

- [Leaflet 1.9.4](https://leafletjs.com/) – BSD-2-Clause, Lizenz unter `docs/vendor/`.
- [Pyodide 314.0.8](https://pyodide.org/) – gebündelte Laufzeit und Lizenzhinweise unter `docs/vendor/pyodide/`.
- Helle Grundkarte: Stadia Maps Alidade Smooth, OpenMapTiles und OpenStreetMap.
  Stadia verlangt für öffentliche Domains eine passende Domainfreigabe.
  Die öffentliche Domain ist noch nicht freigegeben. Deshalb startet die Online-Version mit
  einer hell dargestellten OpenStreetMap-Ersatzkarte. Stadia hell bleibt im Kartenmenü
  auswählbar. Lokal startet weiterhin Stadia hell. Die Kartenattribution bleibt sichtbar.
