# Datenvergleich

Prüfung der Fahrplandaten ZVV auf ihrem neuen Weg **DINO (ZVV) → NeRED (HRDF) → INFO+ (HRDF) → OJP**.
Referenz ist der **Gesamtexport 2027** aus INFO+, so wie die Daten bisher an die OJP-Auskunft gingen.

**Seite:** https://to-mdv.github.io/datenvergleich/

## Ansichten

| Ansicht | Frage | Inhalt |
|---|---|---|
| **Übersicht** | Kommt alles an? | Eine Kennzahl je Datenstand (Anteil korrekter Fahrtage), Verluste je Verarbeitungsschritt, grösste Abweichungen, Datenqualitätshinweise |
| **Linien-Ampel** | Wo sind die Probleme? | Sortier- und filterbare Tabelle je Linie, wahlweise gegen die Referenz oder gegen die Vorstufe |
| **Kalender** | Wann fehlt etwas? | Fahrten pro Verkehrstag im Verhältnis zur Referenz (alle Linien oder eine Linie), auffällige Tage |
| **Fahrtenmatrix** | Welche Fahrt genau? | Jede Fahrt einer Linie mit Status je Stand; Klick zeigt Verkehrstage und Fahrplan nebeneinander |
| **Zieltexte** | Stimmt die angezeigte Richtung? | Zieltext je Fahrt (DINO-Fahrtziel, HRDF-Richtung, sonst Endhalt) je Stand gegenüber der Referenz |
| **Angebote** | Bleiben Attribute erhalten? | HRDF-Attribute (`*A`, z. B. Niederflur, Reservation) je Code und Linie: vorhanden / fehlt / zusätzlich |
| **Verkehrshinweise** | Bleiben Hinweise erhalten? | Infotexte (`*I`) bzw. DINO-Notizen je Text und Linie: vorhanden / fehlt / zusätzlich |
| **Karte** | Wo fehlen Abschnitte? | Längster Fahrweg je Linie; Abschnitte gefärbt nach Vorkommen: überall, nur Referenz, teilweise, nur neu |
| **Methodik** | Wie wurde verglichen? | Abgleichregeln und Statusdefinitionen |

Die frühere Detailansicht (Karte, Attribute, Infotexte, Durchbindungen) bleibt unter
[`/v1/`](https://to-mdv.github.io/datenvergleich/v1/) erreichbar.

## Vergleichslogik (kurz)

- Schlüssel ist die SJYID (DINO `trip.GLOBAL_ID`, HRDF `*I JY`). Fahrten ohne SJYID oder mit neu
  vergebener SJYID werden über ersten/letzten Halt und Zeiten zugeordnet.
- Vergleichseinheit ist der **Fahrtag** (Fahrt × Verkehrstag): vorhanden? gleiche Halte? gleiche Zeiten (±1 Min)?
- Fehlt ein Fahrtag, gibt es aber am selben Tag auf der Linie eine überzählige Fahrt mit identischem Fahrplan,
  zählt er als «gleicher Fahrplan, andere SJYID» (INFO+ legt solche Fahrten teilweise zusammen).
- Die Datenstände haben unterschiedliche Stichtage; ein Teil der Abweichungen sind echte Fahrplanänderungen.

## Daten neu aufbereiten

Die Rohdaten werden nicht hochgeladen. Erwartet wird ein Ordner mit den Unterordnern
`DINO_2_3_*`, `ZVV 2027 NeRED V2`, `ZVV 2027` und `Gesamt 2027`:

```powershell
python tools/build_compare.py --base '<Datenordner>' --out docs/data --cache .cache
```

Laufzeit rund 3 Minuten (Gesamtexport 1,4 GB). Bei geänderten Rohdaten vorher `.cache` löschen.
Ergebnis: `docs/data/summary.json`, `docs/data/extras.json` (Zieltexte, Angebote, Hinweise), `docs/data/map.json` (Karte) und je Linie `docs/data/lines/<hash>.json`.
Die Seite ist rein statisch (kein Build-Schritt, keine Bibliotheken).

Lokal ansehen:

```powershell
python -m http.server 8878 --bind 127.0.0.1 --directory docs
```
