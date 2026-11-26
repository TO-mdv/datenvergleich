# Top 500 · LIR-Benchmark

Eigenes Dashboard: https://to-mdv.github.io/datenvergleich/lir-top500/

500 Bahnhöfe nach dem höchsten durchschnittlichen täglichen Fahrgastaufkommen
(DTV), neuestes verfügbares Jahr je Bahnhof, aus SBB Open Data
[Ein- und Aussteigende an Bahnhöfen](https://data.sbb.ch/explore/dataset/passagierfrequenz/).
Nur Stationen, die im Schweizer TEST-SYS (OMC 23) eindeutig über ihre globale
ID zugeordnet werden konnten. Alle 500 IDs sind auch im INT-SYS vorhanden.
496 Werte stammen aus 2025, vier aus 2024. Die Auswahl deckt Bahnhöfe dieser
Quelle ab; sie ist keine Rangliste einschliesslich Bus und Tram. Die Quelle
berücksichtigt nur angegebene Eisenbahnunternehmen; Umsteigende zählen doppelt.

Messung: OJP 2.0 LIR, Sprache de, zehn Ergebnisse, IncludePtModes true,
RequestorRef MENTRegTest. Keine Einschränkung auf den Objekttyp Haltestelle.
Gleiche Namen auf TEST und INT; Abgleich ausschliesslich über globale IDs.
Jeder Präfix ab dem ersten Zeichen wird getestet, bis die Station erstmals in
den Top 3 erscheint. Leerzeichen zählen mit. Gemeinsame Präfixe werden pro
System zwischengespeichert. Nach einem Treffer wird die längere Eingabe nicht
mehr geprüft; die Messung bewertet keine spätere Stabilität.

Weniger Zeichen ist besser: 1–3 sehr früh, 4–5 früh, 6–8 spät, ab 9 sehr spät.
Fehlende Top-3-Treffer und Anfragefehler sind getrennte Zustände. Mittelwerte
enthalten nur erfolgreiche Stationen; das ist keine Laufzeitmessung.

Die Seite listet alle 500 Fälle, erlaubt Suche, Filter und Sortierung und
zeigt beim Anklicken einer Station die aufgezeichneten Top 3 je Präfix.
Im Dialog wechseln Hoch/Runter den Schritt und Links/Rechts den Bahnhof
innerhalb der gefilterten Liste. Beide Systeme werden gemeinsam umgeschaltet.

Die Hilfsskripte liegen getrennt im juno-sbb-Repository unter
`tools/location-search/top500.py`, `prefix-top3.py` und `export-top500.py`.
Rohdaten und Checkpoints liegen ausserhalb der Repositories. Die öffentliche
Seite enthält nur Namen, öffentliche Kennungen und Messresultate, keine
Koordinaten, Zugangsdaten oder internen Service-URLs. Es werden keine
Live-Anfragen beim Öffnen der Seite gesendet.
