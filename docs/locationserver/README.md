# LIR Tester

Öffentliche, statische Ansicht aufgezeichneter Haltestellen-Suchanfragen:
https://to-mdv.github.io/datenvergleich/locationserver/

- Deutsch und Englisch stehen nebeneinander, jeweils mit einer einzigen Treffernspalte.
- **Hoch/Runter** wechselt einen Eingabeschritt, **Links/Rechts** den Testfall.
- Beide Sprachen verwenden immer denselben Testfall und Eingabeschritt.
- Alternativ stehen die kompakten Auswahlfelder in der Steuerzeile zur Verfügung.
- «Alle Treffer» zeigt die vollständigen aufgezeichneten OJP-Trefferlisten.
- Ein Treffer lässt sich aufklappen: globale Haltestellenkennung und EFA-Rang.
- Länderkennzeichen: CH grün, DE blau, AT rot, FR violett und weitere ISO-Ländercodes.
- Datenstand: DEV oder TEST nach dem Config-Update, DEV vor der Anpassung oder INT als Referenz.
- Die Adresszeile hält die Auswahl fest; der Link kann für einen konkreten Test geteilt werden.

Es werden keine Live-Anfragen an die Testsysteme gesendet. Die veröffentlichten
Daten enthalten ausschliesslich Haltestellennamen, öffentliche Kennungen,
Bewertungswerte, CH-Zuordnung und Testmetadaten. Keine Zugangsdaten,
internen Service-URLs oder Koordinaten werden veröffentlicht.

Für die Länderkennzeichen wird vorrangig `isoCountryCode` aus
[DiDok / SBB Open Data](https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/)
verwendet. Ergänzend dienen eindeutige Global-ID-Namensräume und der geografische
Abgleich von SYS-Haltestellen mit
[Natural Earth Admin 0](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/).
Wenige verbleibende oder grenznahe Fälle wurden zusätzlich mit der eindeutigen
Ortssuche von [OpenStreetMap/Nominatim](https://nominatim.openstreetmap.org/) geprüft.
Die Quelle ist am Länderkennzeichen hinterlegt. «?» bedeutet, dass keine eindeutige
Zuordnung vorliegt. Die CH-Regionsprüfung der historischen Tests bleibt unverändert
an die damalige OMC-Zuordnung gebunden.

Die Statusprüfung der angezeigten Eingabe verwendet für alle Datenstände dieselben
aktuellen Erwartungen. Die Teststatistik zeigt zusätzlich die unveränderten
ursprünglichen Prüfungen der vollständigen Läufe. Die INT-SYS-Daten können vom
DEV-Datenstand abweichen; fehlende Kennungen sind deshalb nicht allein ein Beleg
für eine Konfigurationsregression.

Die Relevanzdatei und die Programmanpassungen gehören in das getrennte
Deployment-Repository; diese Seite dokumentiert nur deren beobachtete Ergebnisse.
