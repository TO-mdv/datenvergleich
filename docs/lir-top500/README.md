# 600 Bahnhöfe · Top-5-Vergleich

Dashboard: https://to-mdv.github.io/datenvergleich/lir-top500/

Die bestehende Adresse bleibt erhalten. Die aktuelle Messung vergleicht:

- DEV mit DB-Daten und neuer Relevanzstaffelung sowie Z-Korrektur.
- TEST mit DB-Daten und bisheriger Konfiguration.
- INT ohne Teilnetz db und mit unverändertem Originalprofil.

## Testauswahl

500 Schweizer Bahnhöfe aus SBB Open Data «Ein- und Aussteigende an Bahnhöfen»,
neuester verfügbarer DTV je Station; Auswahl und Namen wie im vorherigen Lauf.
496 Werte stammen aus 2025, vier aus 2024. Umsteigende zählen doppelt, nur die
im Datensatz genannten Eisenbahnunternehmen sind berücksichtigt. Bus und Tram
sind nicht Bestandteil dieser Auswahl.

100 deutsche Fern- und Regionalverkehrsknoten aus dem aktuellen DEV-SYS,
Teilnetz db, deutsche Gemeindezuordnung: alle 16 Landeshauptbahnhöfe, die zuvor
kuratierten Hauptbahnhöfe und Knoten, ergänzt um weitere Hauptbahnhöfe mit dem
höchsten tripCountService bis genau 100. Der angezeigte Rang folgt diesem
Fahrplanwert innerhalb der Auswahl. Dies ist weder eine Fahrgaststatistik noch
eine absolute Top-100-Liste einschliesslich aller S-Bahn-Stationen.

Alle 600 DB-/CH-Referenz-IDs sind auf DEV und TEST vorhanden. Auf INT sind
32 DB-Zielkennungen direkt vorhanden. Für 42 weitere wird vor dem Lauf der
eindeutig gleichnamige Bahnhof im INT-SYS verwendet, für sechs weitere ist der
Name nach Entfernen von Leer-/Satzzeichen und Hbf/Hauptbahnhof identisch.
Mehrdeutige Namen werden nicht automatisch zugeordnet; generierte gen:-Objekte
werden bei der eindeutigen Namenszuordnung nicht als zusätzlicher Bahnhof
verwendet. Die Zuordnung erfolgt vor dem Test; Antworten werden weiterhin über
die zugeordnete globale ID und nicht über ihren Anzeigenamen verglichen.

Damit gibt es auf INT für 80 der 100 DB-Ziele eine Zielkennung. 20 sind nicht
eindeutig zuordenbar oder fehlen. Ihr Status «Keine SYS-Ziel-ID» bleibt separat.
`target_refs` und `target_source` dokumentieren die Zuordnung pro System im
JSON und die jeweiligen Ziel-IDs sind ebenfalls im CSV enthalten.

## Messung

600 Fälle je System, insgesamt 1800. Jeder Name wird ab dem ersten Zeichen
buchstabenweise abgefragt, bis die globale Ziel-ID erstmals unter den ersten
fünf Ergebnissen steht. Leerzeichen und Satzzeichen zählen mit. Für fehlende
Referenz-IDs werden dennoch sämtliche Präfixe bis zum vollständigen Namen
abgefragt. Keine Serverantwort wird aus einem älteren Lauf übernommen;
gemeinsame Präfixe werden nur innerhalb des neuen Laufs pro System geteilt.

OJP 2.0, Sprache de, NumberOfResults 10, IncludePtModes true,
RequestorRef MENTRegTest, kein Typfilter. Orte und Adressen belegen ebenfalls
Rangplätze. Server liefern zum Teil mehr als zehn Ergebnisse; bewertet werden
die ersten fünf in ihrer tatsächlichen Reihenfolge. Es wird nicht geprüft, ob
ein einmal gefundener Bahnhof bei längeren Eingaben in den Top 5 bleibt.

Weniger Zeichen ist besser: 1–3 sehr früh, 4–5 früh, 6–8 spät, ab 9 sehr spät.
Durchschnittswerte beziehen sich ausschliesslich auf gefundene Fälle.
Fehlende IDs, vorhandene aber nicht gefundene Ziele und Anfragefehler sind
unterschiedliche Zustände. DEV/TEST werden unter derselben Messgrenze verglichen.

## DEV-Konfiguration

Commit `527b62678ef530cad82742cea7e40b2f6565fabb`, Semaphore 59190.

- CH 500: gerundet `300 + 700 * sqrt(DTV / maximaler DTV)`.
- Bern, Bellinzona, Interlaken Ost und Interlaken West: ausdrücklich 1000.
- Münchenstein, Münchenbuchsee und Münchwilen TG: ausdrücklich 500.
- DB-Landeshauptbahnhöfe: 400; weitere in der Relevanzdatei hinterlegte DB-Knoten: 350.
- Übrige CH-Grundwerte bleiben 100; QUALITY vor REGION bleibt erhalten.
- `[Phonetics] IsNeverCarPlateAbbrev "AB;AM;AN;AS;BAD;IN;ST;Z"`.

Der EFA-11.0-Code in `AbbreviationMgr.cpp` löst einen vollständigen Suchterm
auch bei deaktivierter Ersetzung am Wortanfang/-ende als Kfz-Kennzeichen auf.
Die Ausnahmeliste erhält die sieben bisherigen Default-Ausnahmen und ergänzt
Z. Damit wird der Suchanfang nicht mehr zu Zwickau aufgelöst. Der ServiceHost
wurde dafür nicht geändert. Alle Zielabfragen Z, be, münc, münch, münchen und I
werden zusätzlich auf Deutsch und Englisch auf DEV geprüft.

## Bedienung und Nachweise

DEV, TEST und INT stehen nebeneinander. Suche, CH/DB-Gruppenfilter,
DEV/TEST-Vergleichsfilter und Sortierung stehen oberhalb der vollständigen
Liste. Ein Klick auf den Bahnhof öffnet die aufgezeichneten Top 5 je Schritt.
Hoch/Runter wechselt den Eingabeschritt, Links/Rechts den Bahnhof innerhalb der
gefilterten Liste. Alle drei Systeme werden gemeinsam umgeschaltet.

`data.json` und `stations.csv` enthalten die neuen 600er-Ergebnisse.
`previous-top5-500.json` erhält den vorherigen 500er-Top-5-Lauf.
`previous-top3.json` erhält den historischen Top-3-Lauf; dessen Messgrenze darf
nicht als identisch mit Top 5 behandelt werden.

Wiederverwendbare Helfer liegen im separaten juno-sbb-Repository unter
`tools/location-search/`: `top500.py` (auch für 600 Fälle und drei Stages),
`export-ranking600.py`, `verify-ranking-profile.py`, `test-ranking600.cjs`.
Rohdaten, Checkpoints und Laufzeitnachweise liegen ausserhalb der Repositories.
Öffentliche Exporte sind auf Namen, öffentliche Kennungen, Messwerte und
Metadaten begrenzt; keine Koordinaten, internen URLs oder Zugangsdaten.

## Ergebnis dieses Laufs

1800 Fälle vollständig ausgewertet. 3232 eindeutige Anfragen, 3234 HTTP-Versuche;
zwei anfängliche Timeouts wurden erfolgreich wiederholt, kein bleibender
Abfragefehler. DEV/TEST jeweils CH 499/500 und DB 100/100 gefunden. INT CH
499/500, DB 22/80 zugeordneten Zielen gefunden, 58 nicht Top 5, weitere 20 ohne
eindeutige Zielkennung. Rosé bleibt auf allen drei Systemen ausserhalb der Top 5.

| System | CH: Ø Zeichen bei Treffern | DB: Ø Zeichen bei Treffern |
|---|---:|---:|
| DEV | 2,96 | 3,10 |
| TEST | 3,81 | 5,19 |
| INT | 3,81 | 5,00 (nur 22 Treffer) |

DEV gegenüber TEST: 292 früher, 297 gleichauf, 11 später. Die späteren Treffer
sind Zürich Altstetten, Lenzburg, Stettbach, Zürich Enge, Bern Wankdorf,
Wallisellen, Zürich Wiedikon, Murten/Morat, Moutier, Thusis und Diessenhofen.
Der Vergleichsfilter im Dashboard macht diese Fälle gezielt sichtbar.

Nach dauerhaftem Update bestehen auf DEV alle zwölf Zielprüfungen (sechs
Eingaben in de und en): Z, be, münc, münch, münchen und I.
