# ArcheoMappa Italia (prototipo)

Web app installabile (PWA) per la mappa del potenziale archeologico italiano. È un prototipo di ricerca e sviluppo da cedere all'ufficio di archeologia competente: non serve per scavare e non indica dove scavare.

Non ha account, pagamenti, pubblicità né tracciamento. Tutto resta nel dispositivo; le uniche richieste di rete vanno ai servizi cartografici e di dati elencati più sotto.

## Che cosa fa

### Fase 1: mappa, siti noti, zone, fonti

- **Livelli**: OpenStreetMap, OpenTopoMap, satellite Esri; rilievo ombreggiato; servizi WMS istituzionali (catasto, ortofoto, IGM, LiDAR PST-A per regione) e qualsiasi altro WMS aggiunto a mano leggendo il suo GetCapabilities. «Verifica servizi» prova davvero ogni servizio e mostra se risponde.
- **Dintorni**: castelli, rovine, strutture storiche e luoghi di culto già censiti in OpenStreetMap entro un raggio da 1 a 30 km dal centro; filtro per epoca stimata; esportazione GeoJSON e CSV.
- **Zone**: triangolazione di Delaunay dei siti noti e punteggio dei triangoli (siti vicini, distanza media, regolarità, densità). Scarta le aree vicine a siti già noti o sotto soglia: nel dubbio non propone nulla. Mostra le prime 3 zone ed esporta GeoJSON.
- **Fonti**: Wikipedia, Wikimedia Commons, Internet Archive ed Europeana (con chiave) su un luogo o attorno al centro, con profilo per epoca.
- **Accesso**: modalità «ente» (coordinate esatte) o «pubblica» (posizioni arrotondate a circa 1 km, zone disattivate). Quale adottare lo decide l'ente.
- Pulsante **Segnala un ritrovamento fortuito** con le indicazioni di legge e le coordinate da copiare.
- Funziona senza rete per ciò che è già stato visto; link condivisibili tipo `#15/42.98/12.5`.

### Fase 2: rilievo LiDAR e anomalie (scheda «Rilievo»)

Carichi un modello digitale del terreno (DTM) e l'app lo legge **sul dispositivo**, senza inviarlo a nessuno, con un Web Worker (se il browser non lo permette calcola nel thread principale, più lentamente).

- **Formati**: GeoTIFF (non compresso, LZW, Deflate o PackBits, a strisce o a tessere, anche BigTIFF, interi o decimali, con predittore) e ASCII Grid (`.asc`, di cui va indicato il sistema di coordinate). Sistemi supportati: UTM WGS84 e ETRS89 (EPSG 326xx e 258xx), WGS84 e ETRS89 in gradi, Web Mercator. **Gauss-Boaga non è supportato**: riproietta il file in UTM 32N con QGIS.
- **Visualizzazioni**: ombreggiatura multidirezionale o da nord-ovest, rilievo locale (arancio = rialzo, blu = avvallamento), cielo visibile (SVF), pendenza e una combinata. Sono quelle usate in archeologia per far emergere rialzi e fossati poco visibili.
- **Rilevatore di anomalie**: cerca *recinti* (contorno chiuso con spazio interno, rampa e fossato), *tumuli e strutture circolari* e *tracciati lineari* (aggeri, strade incassate, terrazzamenti). Ogni risultato ha una confidenza da 0 a 100%, una forma sulla mappa e un popup. Esporta GeoJSON e CSV con le regole usate.
- **Regole visibili e modificabili**: soglia di contrasto (automatica o in metri), scala del terreno di fondo, ricucitura dei frammenti, dimensioni minime e massime per ogni categoria, confidenza minima, distanza dai siti noti. Le impostazioni predefinite dipendono dal pixel del file («dettaglio» fino a 3 m, «grossolano» oltre) e ogni profilo ricorda le sue modifiche. L'elenco esatto delle regole applicate compare dopo ogni ricerca.
- **Filtri**: scarta le anomalie sopra edifici e lungo strade attuali (da OpenStreetMap, richiede rete; senza rete il filtro non si applica e lo dice) e quelle vicine a siti già noti.
- Nella modalità «pubblica» il rilevatore è disattivato (si può solo guardare il rilievo).

**Dove prendere i dati.** Non c'è un servizio da cui scaricare in automatico: si scarica il file e lo si carica a mano. Fonti da verificare di persona, comprese le licenze correnti:

- TINITALY (INGV): DTM a 10 m di tutta Italia in GeoTIFF. Va bene per provare ma vede solo forme grandi.
- PST / Ministero dell'Ambiente (MASE): DTM e DSM LiDAR a circa 1 m, con copertura parziale, dal Geoportale Nazionale.
- Rilievi LiDAR regionali (per esempio Friuli Venezia Giulia, Toscana, Sardegna, Sicilia, Provincia di Trento): risoluzioni e licenze diverse.

Per ritagliare un file grande e riesportarlo: QGIS, «Raster → Estrazione → Ritaglia raster per estensione», poi esporta in GeoTIFF (compressione Deflate o LZW) in UTM 32N.

## Pubblicarla (serve https)

Installabilità e funzionamento offline richiedono un indirizzo https. La cartella è statica: non c'è nulla da compilare. Tre strade gratuite:

1. **GitHub Pages**: crea un repository, carica tutto il contenuto della cartella, poi Settings, Pages, branch `main`, cartella `/ (root)`. L'app sarà su `https://TUO-NOME.github.io/NOME-REPO/`.
2. **Netlify Drop**: vai su app.netlify.com/drop e trascina la cartella.
3. **Cloudflare Pages**: «Upload assets» e carica la cartella.

I percorsi sono tutti relativi, quindi funziona anche in una sottocartella.

## Installarla

- **Android (Chrome)**: menu ⋮, «Installa app». In Info compare anche il pulsante «Installa l'app».
- **iPhone/iPad (Safari)**: Condividi, «Aggiungi alla schermata Home».
- **Computer (Chrome/Edge)**: icona di installazione nella barra dell'indirizzo.

## APK

Un APK si ricava dall'app già pubblicata: vai su pwabuilder.com, inserisci l'indirizzo https e scegli «Android». Per un pacchetto Capacitor/Bubblewrap serve Android SDK, che qui non era disponibile. L'APK aperto da file non richiede il Play Store; per il Play Store serve un account sviluppatore.

## Aggiornare

Dopo ogni modifica cambia `VERSIONE` in `sw.js` (ora `am-v2`, poi `am-v3`…): così i dispositivi scaricano i file nuovi e cancellano la cache vecchia. Cambia anche `VERSIONE` in `js/app.js` (ora 0.2.0) e, se aggiungi file, la lista `GUSCIO` di `sw.js`.

## Provare la logica

```
npm test              # tutto
npm run test:rapidi   # solo logica e visualizzazioni, senza Python
```

Nessuna dipendenza npm (Node 18 o più recente). Le prove sul rilievo creano da sole file GeoTIFF e ASCII di prova con `tools/make_test_dem.py` (richiede Python con numpy, tifffile e Pillow; senza, quelle prove vengono saltate): un terreno finto con un recinto, un tumulo, un aggere e una collina naturale, in più formati di compressione. Coprono:

- `tests/test.mjs`: geometria, triangolazione, zone, epoche, lettura di Overpass (anche edifici e strade) e di GetCapabilities, CSV, filtro degli indirizzi;
- `tests/test-raster.mjs`: lettore GeoTIFF/ASCII confrontato valore per valore con un riferimento;
- `tests/test-visual.mjs`: proiezioni, ombreggiatura, rilievo locale, cielo visibile, colori;
- `tests/test-detect.mjs`: forme, regole di classificazione, rilevatore sul terreno finto a 2 e 10 m, filtri, GeoJSON;
- `tests/test-analisi.mjs`: sessione di analisi, cache, motore con e senza worker, arresto del worker.

Per rigenerare le icone: `python3 tools/make_icons.py` (richiede Pillow).

## Struttura

```
index.html, css/app.css      interfaccia
js/app.js                    schede, mappa, collegamento fra le parti
js/geo.js                    distanze, proiezione, Delaunay
js/potential.js              punteggio e selezione delle zone
js/epochs.js                 epoche stimate dalle parole del testo
js/sources.js                OpenStreetMap, Wikipedia, Commons, Archive, Europeana, WMS
js/layers.js                 registro dei livelli e prova dei servizi
js/util.js                   DOM sicuro, CSV, cache, rete
js/rilievo-ui.js             scheda «Rilievo»: file, visualizzazioni, risultati, export
js/motore.js                 Web Worker con ripiego sul thread principale
js/worker-rilievo.js         il worker
js/analisi.js                sessione: lettura, visualizzazione, rilevamento
js/raster.js                 lettore GeoTIFF e ASCII Grid a finestre
js/proj.js                   UTM, Web Mercator, gradi
js/visual.js                 ombre, rilievo locale, cielo visibile, colori
js/detect.js                 rilevatore di anomalie e regole
tools/make_test_dem.py       terreno finto per le prove
sw.js, manifest.json, icons/ installazione e uso offline
tests/                       prove della logica e dei dati finti
```

La mappa usa Leaflet 1.9.4 caricato da unpkg; il service worker lo conserva in cache dopo il primo avvio.

## Limiti da conoscere

- **Dati**: i siti noti vengono da OpenStreetMap, che è volontario e incompleto. Non sostituisce il Catalogo Generale dei Beni Culturali né i vincoli ufficiali.
- **Epoche**: stimate dalle parole del testo (nome, descrizione, tag). Sono un indizio, non una datazione.
- **Soglie delle zone**: i valori predefiniti (0,25 e 0,55, distanza minima 700 m) sono un punto di partenza. Con dati molto densi quasi tutto risulta «alto»: vanno tarati con l'ufficio su aree già studiate.
- **Servizi WMS istituzionali**: gli indirizzi sono quelli pubblicati dai rispettivi enti al momento della scrittura, ma non ho potuto contattarli. Il nome del livello viene letto dal servizio e potrebbe non essere leggibile dal browser (CORS). In quel caso si inserisce a mano. I servizi `http` (come SITAP) non funzionano su una pagina https.
- **Rilevatore non tarato su dati reali**: è stato provato solo su un terreno finto. Le soglie predefinite sono un punto di partenza ragionevole, non un risultato di taratura: su LiDAR vero vanno verificate e regolate confrontando con strutture note. Boschi, cave, argini, muri a secco, campi lavorati e rilievi naturali possono dare falsi positivi; strutture molto degradate o più piccole del pixel sfuggono. Il rilevatore dà ipotesi da verificare con ortofoto, fonti e sopralluogo autorizzato, non scoperte.
- **Pixel da 10 m (TINITALY)**: si vedono solo forme grandi, e sul terreno finto il risultato cambiava con il raggio di analisi (la soglia automatica dipende dall'area). Per tumuli, fossati e piccoli forti servono dati a 1–2 m.
- **Memoria e tempi**: l'area analizzata è un quadrato di lato fino a 6 km; oltre 6 milioni di pixel la risoluzione viene ridotta (e lo dice). Su telefoni con poca memoria un file ASCII molto grande può non aprirsi: meglio un GeoTIFF ritagliato.
- **Il file non viene salvato**: dopo la chiusura dell'app va caricato di nuovo. Restano salvate le impostazioni.
- **Non ancora presenti**: punteggio da idrografia (APM), edifici scomparsi, scaricamento automatico del LiDAR dai servizi pubblici, GNA, vincoli ufficiali, rapporto in PDF.

## Come è stata verificata

Le prove della logica passano. L'interfaccia è stata provata in Chromium headless con una libreria cartografica sostitutiva e servizi simulati: schede, ricerca, filtri, zone, fonti, esportazioni, modalità pubblica, protezione dall'iniezione di HTML, cache e riapertura senza rete. Per il rilievo, sempre in Chromium: caricamento di un GeoTIFF e di un ASCII, lettura nel Web Worker e ripiego senza worker, sei visualizzazioni, ricerca delle anomalie, filtro edifici, esportazioni, file non valido, impostazioni salvate.

Non è stata provata su telefoni veri, con Leaflet reale, con i servizi WMS istituzionali reali né **con un file LiDAR italiano vero**: nessun dato reale era raggiungibile durante lo sviluppo. Va fatta una prova sul campo prima di consegnarla.

## Note legali

Le ricerche archeologiche sul terreno sono riservate allo Stato e richiedono concessione o autorizzazione (D.Lgs. 42/2004, artt. 88 e 89). Le zone di potenziale sono ipotesi di studio. I ritrovamenti fortuiti vanno denunciati (art. 90): verifica sempre il testo vigente.

## Licenze dei dati

© collaboratori di OpenStreetMap (ODbL); OpenTopoMap (CC-BY-SA); Esri; Wikipedia e Wikimedia Commons (licenze indicate caso per caso); Internet Archive; Europeana; Geoportale Nazionale (MASE) e Agenzia delle Entrate secondo le rispettive licenze. I rilievi che carichi restano soggetti alla licenza del file (per TINITALY: citare INGV secondo la licenza indicata dal distributore).
