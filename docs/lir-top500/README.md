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

Commit `e4884ed574c54e33c1491dab9e80c08e64832a15`, Semaphore 59198.

Die DTV-Staffelung und bisherigen Ausnahmen bleiben erhalten. Für Bern werden
sechs gezielte Werte geändert: Wankdorf 950, Europaplatz 900, Bern Bahnhof 850,
Zytglogge 550, Hirschengraben 530 und Wankdorf Center 350. Hauptbahnhof Bern
bleibt auf 1000. Wankdorf Center hatte zuvor noch 625, Wankdorf nur 428 und
Europaplatz 387. Das verursachte die unerwünschte Reihenfolge.

Grundlage sind SBB DTV (Wankdorf 15000, Europaplatz 7000) und SYS-Linienzahl
(20 bzw. 9 gegenüber 3 beim Wankdorf Center) sowie die Funktion als Umsteigeknoten.
Diese Kennzahlen sind keine direkte Messung der Umsteigevorgänge. Bern Bahnhof,
Zytglogge und Hirschengraben haben besonders viele hinterlegte ÖV-Linien.

Die Kfz-Kennzeichen-Auflösung ist für **alle Länder einschliesslich der Schweiz**
deaktiviert: `[Phonetics] IsNeverCarPlateAbbrevException "__DISABLED__"`.
Der gelesene EFA-11.0-Code in `AbbreviationMgr.cpp`, FindCarPlateAbbreviation,
verwendet diesen Parameter bei nichtleerem Wert als Positivliste. Der Marker
ist kein gültiger Code; dadurch wird keine Kennzeichen-Zuordnung zugelassen.
Ein leerer Wert würde auf die frühere Negativliste zurückfallen und die Erkennung
wieder einschalten. Normale Orts-/Haltestellenkürzel werden weiterhin verarbeitet.
Der ServiceHost-Code wurde nicht verändert. Beide EFA-Dienste werden nach der
Änderung neu gestartet und geprüft. TEST und INT bleiben unverändert.

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


Zusätzlich zu den ersten Top-5-Treffern enthält `controls` feste Eingaben Bern,
wi, Z, be, münc, münch, münchen und I auf allen drei Systemen jeweils in de/en.
Diese 48 Abfragen laufen unabhängig davon, ob ein Ziel bereits bei einem kürzeren
Präfix gefunden wurde. Dadurch werden leere Zwischenantworten wie bei wi sichtbar.
Der neue Kontrollbereich des Dashboards zeigt diese Antworten direkt nebeneinander.

`previous-top5-600.json` enthält den vorherigen Dreiervergleich mit 600 Fällen.

Der erneute Lauf umfasst 1800 vollständig gemessene Fälle und zusätzlich 48
feste Kontrollabfragen. Zwei anfängliche DEV-Timeouts wurden erfolgreich
wiederholt. Kein bleibender Abfragefehler. Die neuen Ergebnisse und die
Kontrollausgabe für Bern/wi sind im Dashboard enthalten. Die Referenzmessungen
auf TEST/INT liefen unabhängig vom DEV-Update; DEV wurde nach Abschluss des
Updates und der Prüfung beider Dienste gemessen. `stage_windows` dokumentiert
die getrennten Messzeiträume. `merge-ranking-runs.py` prüft vor dem Zusammenführen
identische Eingaben und disjunkte Stages. `capture-ranking-controls.py` zeichnet
die zusätzlichen festen Abfragen auf.
