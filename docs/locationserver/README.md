# LIR Tester

Öffentliche, statische Ansicht aufgezeichneter Haltestellen-Suchanfragen:
https://to-mdv.github.io/datenvergleich/locationserver/

- Deutsch steht oben, Englisch unten.
- **Hoch/Runter** wechselt einen Eingabeschritt, **Links/Rechts** den Testfall.
- Beide Sprachen verwenden immer denselben Testfall und Eingabeschritt.
- Alternativ stehen Auswahlfelder und beschriftete Schaltflächen zur Verfügung.
- «Alle Treffer» zeigt die vollständigen aufgezeichneten OJP-Trefferlisten.
- Ein Treffer lässt sich aufklappen: globale Haltestellenkennung und EFA-Rang.
- Datenstand: DEV nach dem Config-Update, DEV vor der Anpassung oder INT als Referenz.
- Die Adresszeile hält die Auswahl fest; der Link kann für einen konkreten Test geteilt werden.

Es werden keine Live-Anfragen an die Testsysteme gesendet. Die veröffentlichten
Daten enthalten ausschliesslich Haltestellennamen, öffentliche Kennungen,
Bewertungswerte, CH-Zuordnung und Testmetadaten. Keine Zugangsdaten,
internen Service-URLs oder Koordinaten werden veröffentlicht.

Die Statusprüfung der angezeigten Eingabe verwendet für alle Datenstände dieselben
aktuellen Erwartungen. Die Teststatistik zeigt zusätzlich die unveränderten
ursprünglichen Prüfungen der vollständigen Läufe. Die INT-SYS-Daten können vom
DEV-Datenstand abweichen; fehlende Kennungen sind deshalb nicht allein ein Beleg
für eine Konfigurationsregression.

Die Relevanzdatei und die Programmanpassungen gehören in das getrennte
Deployment-Repository; diese Seite dokumentiert nur deren beobachtete Ergebnisse.
