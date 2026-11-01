# ArcheoMappa Italia (prototipo)

Web app installabile (PWA) per la mappa del potenziale archeologico italiano. È un prototipo di ricerca e sviluppo da cedere all'ufficio di archeologia competente: non serve per scavare e non indica dove scavare.

Non ha account, pagamenti, pubblicità né tracciamento. Tutto resta nel dispositivo; le uniche richieste di rete vanno ai servizi cartografici e di dati elencati più sotto.

## Che cosa fa

### Fase 1: mappa, siti noti, zone, fonti

- **Pulsanti sulla mappa**: sopra la mappa ci sono i pulsanti per cambiare la mappa di base e per accendere o spegnere subito i livelli più usati (LiDAR, ortofoto, IGM, catasto, rilievo ombreggiato). Non serve aprire ogni volta il pannello Livelli. Un livello che si vede solo da vicino lo dice sul pulsante («zoom 15+»); uno che ha dato errori ha un «!». Il pulsante della base apre l'elenco di tutte le mappe di base. Il primo pulsante della barra, **«3D»**, apre la vista 3D del terreno (vedi sotto). **«Spegni tutto»** è il pulsante tondo con una sola icona in basso a sinistra della mappa, sopra la scala: è un interruttore: il primo tocco spegne tutti i livelli sovrapposti (le mappe di base restano) e ricorda quali erano accesi; il secondo tocco li riaccende (la barra sull'icona sparisce quando il tasto sta per riaccendere). L'elenco resta salvato anche dopo aver chiuso l'app. Se nel frattempo si accende a mano un altro livello, il tasto torna a spegnere e ricorda solo quelli che spegne.
- **Quale livello sta sopra e quale sotto**: nell'elenco dei livelli sovrapposti ogni riga ha ▲ e ▼. L'elenco va dall'alto al basso: il primo sta sopra tutti. L'ordine vale per i livelli accesi e si ricorda; i livelli spenti restano al loro posto nell'elenco e prendono quel posto quando si accendono.
- **Mappe di base** (tutte libere o con uso gratuito, ciascuna con la propria attribuzione): OpenStreetMap, OpenTopoMap (curve di livello), satellite Esri, **CyclOSM** (sentieri, mulattiere, curve di livello), **OpenStreetMap Umanitaria (HOT)**, **CARTO Voyager** e **CARTO Positron** (sfondo chiaro, adatto a leggere i livelli sovrapposti), **Sentinel-2 senza nuvole (EOX)**, mosaico satellitare a 10 m. Sentinel-2 EOX è offerto per uso **non commerciale**: l'app lo scrive nell'elenco. I server delle basi libere sono di volontari o di aziende che possono cambiare le condizioni: se una non si carica, ce ne sono altre.
- **Tocco lungo sulla mappa**: tenendo premuto un punto (circa mezzo secondo, senza muovere il dito) si apre un riquadro con le coordinate, «Copia», «Apri in Google Maps» (apre quel punto nell'app o nel sito di Google Maps) e «Usa come centro». Con il mouse vale anche il tasto destro. Il gesto non scatta se si trascina la mappa o se si zooma con due dita, e il rilascio non sposta il centro di ricerca. Nella modalità pubblica coordinate e collegamento sono arrotondati come il resto dell'app. «Apri in Google Maps» invia a Google le coordinate di quel punto, come ogni collegamento a Google Maps.
- **Ortofoto e IGM: il formato di richiesta si sceglie provando.** Questi livelli del Ministero hanno un livello per ogni fuso UTM (`.32` e `.33`) e non sempre rispondono a ogni formato di richiesta. L'app prova fino a cinque varianti (WMS 1.3.0 o 1.1.1, un fuso o due, immagini da 512 px o tessere da 256 px; il fuso si sceglie dalla longitudine) e usa la prima che restituisce un'immagine; la scelta è ricordata e si rifà da sola se la mappa passa nell'altro fuso. «Perché non si vede?» elenca tutte le varianti con il messaggio del servizio. Se il servizio risponde con un errore tipo `msShapefileOpen` (file di indici illeggibile) il guasto è sul server del Ministero e nessuna variante lo risolve. Ogni livello ha il suo ingrandimento minimo, sotto il quale non chiede nulla, e l'avviso di errore compare una volta sola invece che a ogni zoom. **IGM 1:25.000:** il servizio disegna solo da zoom 13 in su, e chi lo interroga più in largo riceve un'immagine «vuota» che sembra una risposta buona. Dalla 0.5.0 la prova dei formati parte dall'ingrandimento minimo del livello (non da quello della mappa) e, se l'immagine è vuota, riprova a zoom più alti (fino a tre), così non sceglie una variante sbagliata soltanto perché a scala larga non si vede nulla. La causa per cui l'IGM «non funzionava» non è dimostrata (il servizio del Ministero non è raggiungibile dall'ambiente di sviluppo): questa è la spiegazione più probabile; se resta un errore del server (`msShapefileOpen`), «Perché non si vede?» lo riporta con lo zoom di ogni prova.
- **Confronta due livelli** (pulsante «Confronta» sulla mappa): scegli due livelli qualsiasi, per esempio IGM e satellite oppure LiDAR e ortofoto. Con il **cursore a tendina** il primo si vede a sinistra della linea e il secondo a destra; si trascina la linea (o si usano le frecce) e la mappa si può spostare e ingrandire. Con il **lampeggio** i due livelli si alternano nello stesso punto, con pausa e cambio a mano. È un confronto che fai tu a occhio: l'app non dice nulla su ciò che vede.
- **Livelli**: rilievo ombreggiato TINITALY (INGV, 10 m, CC BY 4.0: tre volte più fine dell'ombreggiatura Esri, che resta disponibile come ripiego); servizi WMS istituzionali (catasto, ortofoto, IGM, LiDAR del Geoportale nazionale per Marche e Umbria; l'IGM 1:25.000 compare solo da zoom 13) e qualsiasi altro WMS aggiunto a mano leggendo il suo GetCapabilities. «Verifica servizi» chiede a ogni servizio la tessera vera al centro della mappa e dice se ha ricevuto un'immagine oppure il messaggio di errore del servizio, con miniatura e indirizzo; per i servizi di cui non conosce il livello dice «non verificabile», senza dichiararli fermi.
- **Dintorni**: castelli, rovine, strutture storiche e luoghi di culto già censiti in OpenStreetMap entro un raggio da 1 a 30 km dal centro; filtro per epoca stimata; esportazione GeoJSON e CSV.
- **Zone**: triangolazione di Delaunay dei siti noti e punteggio dei triangoli (siti vicini, distanza media, regolarità, densità). Scarta le aree vicine a siti già noti o sotto soglia: nel dubbio non propone nulla. Mostra le prime 3 zone ed esporta GeoJSON.
- **Fonti**: Wikipedia, Wikimedia Commons, Internet Archive ed Europeana (con chiave) su un luogo o attorno al centro, con profilo per epoca.
- **Accesso**: modalità «ente» (coordinate esatte) o «pubblica» (posizioni arrotondate a circa 1 km, zone disattivate). Quale adottare lo decide l'ente.
- Pulsante **Segnala un ritrovamento fortuito** con le indicazioni di legge e le coordinate da copiare.
- Funziona senza rete per ciò che è già stato visto; link condivisibili tipo `#15/42.98/12.5`.

### Vista 3D del terreno (dalla 0.6.0)

Il pulsante **«3D»** (il primo della barra in alto) apre a tutto schermo il terreno in rilievo attorno al centro della mappa, con la stessa mappa di base di quella in uso (satellite, topografica o stradale; le altre basi ripiegano sul satellite). Si ruota con due dita o con il tasto destro, si inclina e si ingrandisce come in qualsiasi mappa 3D; toccando un punto compaiono **quota in metri e coordinate**. Sotto la mappa ci sono i comandi: basi, **Ombre** (ombreggiatura dalle stesse quote), **Edifici** (blocchi di OpenStreetMap con l'altezza dichiarata), **LiDAR** (solo se è acceso sulla mappa 2D), **esagerazione delle altezze** ×1 (reale), ×1,5, ×2, ×3, **Dall'alto** (pianta, nord in alto) e **Inclina**; in alto a destra ci sono zoom e bussola (un tocco sulla bussola rimette il nord in alto). Si esce con «✕ Chiudi 3D», con Esc o con il tasto Indietro di Android; la mappa 2D riparte dal punto in cui si era arrivati.

**Da dove vengono le altezze.** Da zoom 12 in su, dentro l'Italia, le quote sono quelle di **TINITALY** (INGV, passo 10 m, CC BY 4.0) chieste al servizio WCS dell'INGV come GeoTIFF a decimali; dove il servizio non ha dato (mare, bordi, buchi) o fuori dall'Italia e a scala larga l'app completa con le quote mondiali **Terrarium** (circa 30 m di passo reale), e se TINITALY non risponde ripiega su queste e lo scrive nella riga di stato. Le quote del 3D sono mostrate in metri interi, perché il dato è a 10 m. Le tessere scaricate restano nella cache del dispositivo (circa 0,7 MB per tessera di quota la prima volta).

**Che cosa NON è.** Non è il 3D fotogrammetrico di Google Earth: non ci sono edifici e alberi modellati dalle foto, ma un terreno liscio a 10 m con sopra l'immagine satellitare e i blocchi degli edifici di OpenStreetMap (che hanno l'altezza solo dove qualcuno l'ha inserita; l'esagerazione non li alza). «Altezze precise» vuol dire precise quanto un modello a 10 m: errori verticali di alcuni metri sono normali, più grandi sulle pareti ripide. **Il LiDAR a 1 m del Ministero non fornisce quote vere** attraverso il suo servizio (solo un'immagine ombreggiata): nel 3D si può soltanto stenderlo sopra il rilievo come immagine, e solo nell'app Android (o con il proxy), perché è un servizio `http`. La vista usa WebGL2 e MapLibre GL JS 5.7.0 (BSD), incluso nell'app e caricato soltanto al tocco di «3D».

### Fase 2: rilievo LiDAR e anomalie (scheda «Rilievo»)

**Fonte predefinita: il LiDAR del servizio, senza caricare file.** Scegli sulla mappa il centro e il raggio, tocca «Mostra il rilievo» o «Cerca anomalie»: l'app scarica dal servizio WMS del Geoportale nazionale (regione e livello scelti nei Livelli, per ora Marche e Umbria) l'immagine del DTM attorno al centro, a blocchi che si sovrappongono, e la elabora **sul dispositivo** con un Web Worker (se il browser non lo permette calcola nel thread principale, più lentamente). Serve l'app Android oppure, dal sito, il proxy (vedi sotto): una pagina https non può leggere i pixel del servizio del Ministero.

Il servizio non dà le quote ma un'immagine a 256 livelli di grigio (la stessa idea del filtro di microrilievo dell'app di riferimento). Per non indovinare, l'app chiede al servizio la quota vera in 9 punti (GetFeatureInfo, come fa l'app di riferimento) e la confronta con i grigi di quei punti: se la relazione è una retta (R² ≥ 0,98) i grigi diventano **metri** e si dichiara quanti metri vale un livello; altrimenti restano **livelli relativi** (le forme si leggono, le altezze no) e l'app lo scrive nella scheda e nei file esportati. Se il servizio adatta i grigi a ogni richiesta, i blocchi vengono riallineati fra loro. Se il passo è grosso (più di mezzo metro per livello) lo dice: i dislivelli piccoli non si distinguono.

**Perché il LiDAR del servizio sembra «grossolano», e che cosa si è fatto (dalla 0.5.0).** Con 256 grigi il terreno arriva a *gradini*: un'ombreggiatura calcolata su gradini di mezzo metro mostra false curve di livello al posto del terreno. Per la sola visualizzazione l'app ora **leviga i gradini** (opzione «Leviga i gradini del servizio», attiva di base, nella scheda Rilievo): alterna una leggera sfocatura a una correzione che riporta ogni pixel dentro l'intervallo di arrotondamento da cui è nato (valore letto ± mezzo gradino). Il vero terreno sta per costruzione in quell'intervallo, quindi la superficie non si allontana dal dato del servizio di più di mezzo gradino; dove il terreno sale di più di un gradino per pixel (muri, scarpate, bordi di fossato) il dato resta com'è. In prove su un terreno finto con gradini da 0,25, 0,5 e 1 m, l'errore dell'ombreggiatura rispetto al terreno vero scende del 71%, 85% e 76%. L'immagine sulla mappa è inoltre calcolata con un campionamento bilineare, a doppia risoluzione dove l'area è piccola (fino a 2400 pixel per lato, come prima della 0.5: la 0.5.0 arrivava a 3072 e per i telefoni era troppo pesante) e senza la scala di gradini che nasceva ruotando la griglia UTM nel Web Mercator. **La levigatura si applica solo se i grigi sono stati convertiti in metri**: con i grigi relativi non si sa che cosa valga un livello e non viene fatta. L'accuratezza delle altezze non migliora: il rilevatore di anomalie lavora sempre sul dato vero, non su quello levigato.

*Limiti.* La levigatura **non aggiunge dettagli che il servizio non ha**: forme più basse o più strette di un gradino si attenuano (nelle prove, con gradino da 0,5 m, la profondità misurata di un fossato stretto passa da 0,83 m nel dato a gradini a 0,67 m dopo la levigatura, contro 0,86 m del terreno vero: si perde un po' di profondità; l'altezza di un argine basso passa da 0,25 m a 0,30 m, contro 0,46 m del vero: non arriva al vero ma non peggiora). Le prove sono su terreni finti: non sono verificate su LiDAR vero del Ministero, che dall'ambiente di sviluppo non è raggiungibile. Il livello **LiDAR sulla mappa** (pulsante «LiDAR») è l'immagine che il Ministero produce: nelle prove fatte il 1° novembre 2026 (vedi sotto) è già un **rilievo ombreggiato** a 1 m, non una scala di quote. L'app lo mostra com'è, con tessere da 256 pixel (la 0.5.0 le chiedeva da 512: non aggiungeva dettaglio, perché il dato è a 1 m, e ogni tessera pesava il quadruplo; dalla 0.5.1 sono tornate a 256). Per le altezze in metri l'app chiede al servizio la quota in 9 punti; sull'immagine ombreggiata la relazione con i grigi non è una retta, quindi la conversione di norma non riesce e la scheda Rilievo lavora su livelli relativi. Con raggi sopra 1,2 km il pixel supera il metro (al massimo 2400 pixel per lato): il cursore del raggio lo mostra.

**Che cosa è stato verificato sul servizio vero (1° novembre 2026, da un computer di GitHub: «Actions → Diagnosi servizi → Run workflow»).** Il servizio LiDAR del Ministero (Marche, DTM 1 m) risponde alle richieste da 256, 512, 1000 e 2000 pixel senza errori (48 richieste per dimensione, nessun fallimento) e con tempi simili; la copertura a 1 m è a macchie, non continua (in una scansione di 980 finestre da 1 km nelle Marche ne risultavano con dati 98). L'immagine del livello DTM è un rilievo ombreggiato. La lettura della quota (GetFeatureInfo) risponde nel formato atteso (`@16 Stretched value;Pixel Value; grigio;quota;`) ma ogni tanto dà un errore 500 del server (nelle prove da circa 1 richiesta su 16 a 1 su 3); i «grigi allungati» (Stretched) corrispondevano, nei punti provati in una zona delle Marche, a circa 6,7 m per livello. Il servizio dell'IGM 1:25.000 risponde con l'errore `msShapefileOpen ... tile_33_igm25k.shp` (l'indice dei file sul disco di rete dell'IGM non è leggibile): il guasto è sul server del Ministero. TINITALY (`tinitaly_hshd`, EPSG:3857) e tutte le nuove mappe di base rispondono con immagini valide.

**0.5.1: LiDAR coperto dalle «Ombre».** Nella 0.5.0 l'ordine di partenza dei livelli metteva «Ombre» (TINITALY, 10 m, semitrasparente) sopra il LiDAR: con entrambi accesi il LiDAR a 1 m risultava velato da un'immagine molto più sfocata, soprattutto agli ingrandimenti alti (nella 0.4.0 stava sopra chi era stato acceso per ultimo). Ora il LiDAR sta sopra le ombreggiature; l'ordine salvato dalla 0.5.0 viene lasciato da parte (si può cambiare con ▲ e ▼). Non si è potuto provare su un telefono vero: la causa è dimostrata come ordine dei livelli in un browser, non come spiegazione certa del problema segnalato.

**0.5.2: «Spegni tutto» riaccende.** Il pulsante tondo in basso a sinistra non spegne più e basta: dopo aver spento i livelli, un secondo tocco li riaccende uguali a prima (stesso elenco, stessa trasparenza e stesso ordine; il LiDAR riparte con la regione scelta). L'icona cambia: con la barra = «spegni», senza barra = «riaccendi». L'elenco dei livelli spenti resta salvato (`am.spenti`) anche dopo aver chiuso l'app. Prove nel browser: spegni, riaccendi, riavvio con tutto spento, livello acceso a mano nel frattempo.

**0.6.0: vista 3D.** Nuovo pulsante «3D» (vedi la sezione sopra). Il pulsante «Spegni tutto» resta in basso a *sinistra*, come richiesto il 30 ottobre.

In alternativa avanzata si può usare un file proprio (GeoTIFF o ASCII Grid), che resta sul dispositivo e non viene inviato a nessuno.

- **Formati**: GeoTIFF (non compresso, LZW, Deflate o PackBits, a strisce o a tessere, anche BigTIFF, interi o decimali, con predittore) e ASCII Grid (`.asc`, di cui va indicato il sistema di coordinate). Sistemi supportati: UTM WGS84 e ETRS89 (EPSG 326xx e 258xx), WGS84 e ETRS89 in gradi, Web Mercator. **Gauss-Boaga non è supportato**: riproietta il file in UTM 32N con QGIS.
- **Visualizzazioni**: ombreggiatura multidirezionale o da nord-ovest, rilievo locale (arancio = rialzo, blu = avvallamento), cielo visibile (SVF), pendenza e una combinata. Sono quelle usate in archeologia per far emergere rialzi e fossati poco visibili.
- **Contorni sulla mappa**: dalla 0.4.0 i contorni dei recinti sono disegnati dove sono davvero (prima erano calcolati rispetto alla finestra di ricerca e potevano comparire spostati verso l'angolo nord-ovest).
- **Rilevatore di anomalie**: cerca *recinti* (contorno chiuso con spazio interno, rampa e fossato), *tumuli e strutture circolari* e *tracciati lineari* (aggeri, strade incassate, terrazzamenti). Ogni risultato ha una confidenza da 0 a 100%, una forma sulla mappa e un popup. Esporta GeoJSON e CSV con le regole usate.
- **Regole visibili e modificabili**: soglia di contrasto (automatica o in metri), scala del terreno di fondo, ricucitura dei frammenti, dimensioni minime e massime per ogni categoria, confidenza minima, distanza dai siti noti. Le impostazioni predefinite dipendono dal pixel del file («dettaglio» fino a 3 m, «grossolano» oltre) e ogni profilo ricorda le sue modifiche. L'elenco esatto delle regole applicate compare dopo ogni ricerca.
- **Filtri**: scarta le anomalie sopra edifici e lungo strade attuali (da OpenStreetMap, richiede rete; senza rete il filtro non si applica e lo dice) e quelle vicine a siti già noti.
- **Confronto con la foto** (dopo «Cerca anomalie»): per ogni anomalia controlla se nella foto di riferimento c'è un segno nello stesso punto. Foto a scelta: satellite attuale Esri, i quattro satelliti storici Esri (2014, 2018, 2022, 2026) oppure l'ortofoto 2012 del Ministero. L'esito è uno fra **solo nel LiDAR** (nella foto non si distingue nulla), **visibile anche nella foto**, **incerto** e **non valutabile** (con il motivo: foto mancante o troppo grossolana, area uniforme, nessuno spazio libero attorno). Si può filtrare l'elenco per esito; le figure sulla mappa cambiano stile; GeoJSON e CSV portano l'esito, il valore p, il contrasto di luminosità, la nota sulla vegetazione e la foto usata.

  *Come funziona.* Le tessere della foto si scaricano per l'area del rilievo, si unificano in un mosaico e si riportano sulla stessa griglia del LiDAR. Per ogni anomalia si misura quanto la luminosità dentro la figura differisce da quella dell'anello attorno e quanto è forte il bordo, e si confronta con le stesse misure della stessa figura messa in ~100 posizioni casuali della foto (test di permutazione, con seme fisso: stesso risultato a ogni esecuzione). Si prova anche qualche piccolo spostamento (circa ±2 m) per tollerare il disallineamento fra le fonti, e il valore p è corretto di conseguenza. Soglie: p ≤ 0,05 «visibile», p ≥ 0,25 «solo nel LiDAR», in mezzo «incerto». Dove la foto è prevalentemente verde lo segnala (la vegetazione nasconde molti segni).

  *Limiti, da dire chiaramente.* «Solo nel LiDAR» significa che nella foto non si distingue un segno, **non** che la foto dimostri l'assenza: una foto sfocata, vegetazione, ombre, stagione o semplicemente la risoluzione possono nasconderlo. Il contrario vale per «visibile anche nella foto»: un segno nello stesso punto non prova che sia la stessa struttura. Le soglie sono scelte su terreni e foto sintetici e **non sono tarate su siti reali**: vanno verificate con casi noti prima di fidarsene. Servono l'app Android (o il proxy) perché il browser da una pagina web non può leggere i pixel delle tessere di altri siti. Per tenere leggero il calcolo, con raggi grandi la foto viene presa a risoluzione ridotta e l'app lo dice. IGM contro satellite è per ora solo manuale (vedi «Confronta due livelli»); un confronto automatico fra due livelli del Ministero si potrà aggiungere in seguito se serve.
- Nella modalità «pubblica» il rilevatore è disattivato (si può solo guardare il rilievo).

**Dove prendere un file proprio (facoltativo).** Fonti da verificare di persona, comprese le licenze correnti:

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

## App Android (APK)

Il progetto contiene il necessario per costruire un APK con Capacitor (cartella `apk/`), e un flusso di lavoro GitHub (`.github/workflows/apk.yml`) che lo costruisce da solo a ogni modifica dell'app, oppure a mano da Actions → «APK Android» → Run workflow. L'APK compare nella pagina **Releases** del repository, nella versione «apk-ultimo», con indirizzo fisso:

`https://github.com/TUO-NOME/NOME-REPO/releases/download/apk-ultimo/ArcheoMappa-Italia.apk`

Per installarlo il telefono chiede di consentire l'installazione da quella fonte. L'APK è firmato con una chiave di sviluppo (`apk/debug.keystore`, pubblica, la stessa a ogni costruzione, e il flusso di lavoro controlla che sia davvero quella: così gli aggiornamenti si installano sopra la versione precedente): va bene per provare e per distribuire all'interno dell'ente, non per il Play Store.

**Perché serve l'APK per il LiDAR del Ministero.** I servizi del Geoportale nazionale (LiDAR, ortofoto) sono pensati per `http`. Una pagina `https` come il sito su GitHub Pages non può caricarli: il browser trasforma le immagini `http` in `https` (provato in Chromium) e, se il servizio non risponde in `https`, non si vede nulla. L'app Android è impostata come altre app Capacitor che li usano: si apre su `http://localhost` e consente il traffico `http` (`apk/capacitor.config.json`), quindi i servizi si caricano. Nell'app anche la lettura dei GetCapabilities passa dal client nativo, che non ha il blocco CORS.

**Dal sito (https)**: serve un proxy. In `tools/proxy-pcn-worker.js` c'è un programma di poche righe da incollare in un Cloudflare Worker gratuito (le istruzioni sono nel file); poi si incolla l'indirizzo in Livelli → «Servizi del Ministero: proxy». Passano solo le mappe WMS del Geoportale. In alternativa si carica un file LiDAR nella scheda Rilievo.

Costruzione in locale (serve Node 22, JDK 21 e Android SDK): `cd apk && npm install && node prepara-www.mjs && npx cap add android && node applica-android.mjs && npx cap sync android && cd android && ./gradlew assembleDebug`.

Per il solo involucro senza GitHub resta valida anche la strada pwabuilder.com, ma darebbe un'app su https e quindi senza il LiDAR del Ministero.

## Aggiornare

Dopo ogni modifica cambia `VERSIONE` in `sw.js` (ora `am-v11`, poi `am-v12`…): così i dispositivi scaricano i file nuovi e cancellano la cache vecchia. Cambia anche `VERSIONE` in `js/app.js` (ora 0.6.0), la versione in `package.json` e `apk/package.json` e, se aggiungi file, la lista `GUSCIO` di `sw.js` (altrimenti l'app non parte senza rete).

## Provare la logica

```
npm test              # tutto
npm run test:rapidi   # solo logica e visualizzazioni, senza Python
```

Nessuna dipendenza npm (Node 18 o più recente). Le prove sul rilievo creano da sole file GeoTIFF e ASCII di prova con `tools/make_test_dem.py` (richiede Python con numpy, tifffile e Pillow; senza, quelle prove vengono saltate): un terreno finto con un recinto, un tumulo, un aggere e una collina naturale, in più formati di compressione e anche in gradi (EPSG:4326, come i DTM del PST scaricati in WGS84). Coprono:

- `tests/test.mjs`: geometria, triangolazione, zone, epoche, lettura di Overpass (anche edifici e strade) e di GetCapabilities, CSV, filtro degli indirizzi;
- `tests/test-raster.mjs`: lettore GeoTIFF/ASCII confrontato valore per valore con un riferimento;
- `tests/test-visual.mjs`: proiezioni, ombreggiatura, rilievo locale, cielo visibile, colori;
- `tests/test-detect.mjs`: forme, regole di classificazione, rilevatore sul terreno finto a 2 e 10 m, filtri, GeoJSON;
- `tests/test-analisi.mjs`: sessione di analisi, cache, motore con e senza worker, arresto del worker;
- `tests/test-layers.mjs`: livelli del Ministero (nomi dei livelli, http/https secondo l'ambiente, proxy), client nativo dell'app Android e programma del proxy;
- `tests/test-servizio.mjs`: rilievo dal LiDAR del servizio contro un servizio simulato (grigi a scala fissa e adattati a ogni richiesta): indirizzi, blocchi e riallineamento, calibrazione in metri, errori del servizio, analisi completa che ritrova tumulo, recinto e aggere.
- `tests/test-varianti.mjs`: formati di richiesta di ortofoto e IGM (fuso dalla longitudine, ordine delle prove, variante preferita, scelta fra risposte buone, vuote e guaste);
- `tests/test-confronto.mjs`: confronto LiDAR–foto su mosaici Web Mercator sintetici proiettati davvero in UTM (disco chiaro, recinto, strada, foto uniforme, bordo, vegetazione, determinismo);
- `tests/test-riferimenti.mjs`: tessere, mosaico, zoom utilizzabile, fonti di riferimento (satellite, storici, ortofoto con 512 px);
- `tests/test-tendina.mjs`: cursore a tendina e lampeggio (taglio che segue la mappa, trascinamento, tastiera, pausa, pulizia);
- `tests/test-ordine.mjs`: ordine dei livelli sovrapposti (▲▼, livelli spenti, ordine salvato);
- `tests/test-tocco-lungo.mjs`: riconoscimento del tocco lungo (durata, tolleranza, due dita, soppressione del click) e collegamento a Google Maps;
- `tests/test-dettaglio.mjs`: levigatura dei gradini a 8 bit su terreni finti, con l'errore misurato prima e dopo (ombre, quote, fossato, argine, muro).
- `tests/test-dem.mjs`: lettore GeoTIFF dell'INGV (a tessere, big-endian, decimali, vuoti), ricampionamento sulla tessera perché il servizio restituisce un riquadro più largo, riempimento dei buchi, codifica Terrarium e scelta della fonte;
- `tests/test-stile3d.mjs`: stile della vista 3D (rilievo, basi, ombre, edifici, LiDAR, attribuzioni), conversione di ingrandimento Leaflet/MapLibre, indirizzi delle tessere e testo della quota.

Per rigenerare le icone: `python3 tools/make_icons.py` (richiede Pillow).

## Struttura

```
index.html, css/app.css      interfaccia
js/app.js                    schede, mappa, collegamento fra le parti
js/geo.js                    distanze, proiezione, Delaunay
js/potential.js              punteggio e selezione delle zone
js/epochs.js                 epoche stimate dalle parole del testo
js/sources.js                OpenStreetMap, Wikipedia, Commons, Archive, Europeana, WMS
js/layers.js                 registro dei livelli, http/https, proxy, prova dei servizi
js/util.js                   DOM sicuro, CSV, cache, rete
js/rilievo-ui.js             scheda «Rilievo»: fonte (servizio o file), visualizzazioni, risultati, export
js/lidar-servizio.js         LiDAR dal servizio WMS: blocchi, calibrazione in metri, metadati per l'analisi
js/tessere.js                tessere WMS: ripiego con il client nativo e diagnosi «Perché non si vede?»
js/motore.js                 Web Worker con ripiego sul thread principale
js/worker-rilievo.js         il worker
js/analisi.js                sessione: lettura, visualizzazione, rilevamento
js/raster.js                 lettore GeoTIFF e ASCII Grid a finestre
js/proj.js                   UTM, Web Mercator, gradi
js/visual.js                 ombre, rilievo locale, cielo visibile, colori, riproiezione bilineare
js/dettaglio.js              levigatura dei gradini a 8 bit del servizio
js/ordine.js                 ordine (sopra/sotto) dei livelli sovrapposti
js/tocco-lungo.js            tocco lungo sulla mappa e collegamento a Google Maps
js/dem.js                    quote TINITALY (GeoTIFF dell'INGV) e Terrarium: lettura, ricampionamento, codifica
js/stile3d.js                stile della vista 3D e indirizzi delle tessere
js/vista3d.js                vista 3D (MapLibre): quote, comandi, chiusura
vendor/maplibre/             MapLibre GL JS 5.7.0 (BSD), caricato solo al tocco di «3D»
js/detect.js                 rilevatore di anomalie e regole
tools/make_test_dem.py       terreno finto per le prove
tools/proxy-pcn-worker.js    proxy gratuito (Cloudflare Worker) per i servizi del Ministero
apk/                         pacchetto Android (Capacitor): configurazione e script
.github/workflows/apk.yml    costruisce l'APK e lo pubblica nelle Releases
sw.js, manifest.json, icons/ installazione e uso offline
tests/                       prove della logica e dei dati finti
```

La mappa usa Leaflet 1.9.4 caricato da unpkg; il service worker lo conserva in cache dopo il primo avvio.

## Limiti da conoscere

- **Dati**: i siti noti vengono da OpenStreetMap, che è volontario e incompleto. Non sostituisce il Catalogo Generale dei Beni Culturali né i vincoli ufficiali.
- **Epoche**: stimate dalle parole del testo (nome, descrizione, tag). Sono un indizio, non una datazione.
- **Soglie delle zone**: i valori predefiniti (0,25 e 0,55, distanza minima 700 m) sono un punto di partenza. Con dati molto densi quasi tutto risulta «alto»: vanno tarati con l'ufficio su aree già studiate.
- **LiDAR dai servizi WMS del Ministero**: i nomi dei file e dei livelli di Marche e Umbria vengono da un'app Android che li usa davvero (Marche: DTM 1 m e 2 m, DSM primo e ultimo impulso; Umbria: DTM 1 m, anche del volo 2014, DSM 2014). Per le altre regioni il nome del livello va letto dal servizio, e dal sito non è possibile (CORS): sono segnate «da verificare». Non ho potuto contattare i servizi del Ministero dall'ambiente di sviluppo, quindi **non so se rispondano anche in https**: dal sito, senza proxy, il LiDAR potrebbe non vedersi (l'app lo dice in un messaggio). Nell'app Android si usa `http`, come l'app di riferimento. Se una tessera non si carica con l'immagine normale, l'app riprova con il client nativo e, se il servizio risponde con un errore, mostra il suo messaggio; i pulsanti «Verifica servizi» e «Perché non si vede?» (Livelli) fanno la stessa prova su una tessera vera di ogni servizio WMS e mostrano risposta, miniatura e indirizzo. Lo stato «risponde» nell'elenco dei livelli vuol dire solo che è arrivata un'immagine, non che sia quella giusta.
- **Come l'app ricava il rilievo dal servizio**: non ho potuto vedere le immagini vere del Ministero. Quel che so viene dall'app di riferimento (formato delle richieste, zoom nativo 17 per 1 m, lettura della quota con GetFeatureInfo). Non so se i grigi siano a scala fissa per tutta la regione (in tal caso un livello vale diversi metri e i tumuli bassi spariscono) o adattati a ogni richiesta; l'app lo misura a ogni scarico e lo scrive. Su un servizio simulato (terreno con tumulo alto 2,2 m, recinto con argine di 1,3 m e aggere basso di 1 m; raggio 500 m) la sensibilità dipende dal passo: a 0,5 m per livello ritrova tumulo e recinto ma non l'aggere basso; a 1,3 m solo il tumulo; a 2,4 m per livello non trova nulla e l'app lo dice (pochi livelli, nessuna conversione in metri). Con grigi adattati a ogni richiesta ritrova tumulo e recinto. È un test della catena di calcolo, non una misura sul LiDAR vero.
- **Altri servizi WMS istituzionali**: ortofoto 2012 ha il livello noto (stessa fonte). Il catasto dell'Agenzia delle Entrate usa WMS 1.3.0 in EPSG:4258 (latitudine e longitudine, ordine degli assi del 1.3.0), come l'app di riferimento, con i livelli particelle, fabbricati, strade e acque, visibili da zoom 15. L'IGM 1:25.000 ha un livello per ogni fuso: il nome si sceglie leggendo il servizio («Cambia livello»). **Se il servizio risponde con un errore del tipo `msShapefileOpen(): Unable to access file … TILEINDEX\…shp`, il guasto è sul server del Ministero** (percorso dell'indice delle tessere con le barre rovesce): l'app non può ripararlo e lo mostra com'è; si può provare un altro fuso o riprovare più tardi. Per l'ortofoto non so ancora che cosa vada storto: serve il testo della scheda di «Verifica servizi». I servizi `http` (come SITAP) funzionano solo nell'app Android.
- **Rilevatore non tarato su dati reali**: è stato provato solo su un terreno finto. Le soglie predefinite sono un punto di partenza ragionevole, non un risultato di taratura: su LiDAR vero vanno verificate e regolate confrontando con strutture note. Boschi, cave, argini, muri a secco, campi lavorati e rilievi naturali possono dare falsi positivi; strutture molto degradate o più piccole del pixel sfuggono. Il rilevatore dà ipotesi da verificare con ortofoto, fonti e sopralluogo autorizzato, non scoperte.
- **Pixel da 10 m (TINITALY)**: si vedono solo forme grandi, e sul terreno finto il risultato cambiava con il raggio di analisi (la soglia automatica dipende dall'area). Per tumuli, fossati e piccoli forti servono dati a 1–2 m.
- **Memoria e tempi**: l'area analizzata è un quadrato di lato fino a 6 km; oltre 6 milioni di pixel la risoluzione viene ridotta (e lo dice). Su telefoni con poca memoria un file ASCII molto grande può non aprirsi: meglio un GeoTIFF ritagliato.
- **Nulla viene salvato**: il LiDAR scaricato e un eventuale file proprio vanno richiesti di nuovo dopo la chiusura dell'app. Restano salvate le impostazioni e la scelta di regione e livello.
- **Non ancora presenti**: punteggio da idrografia (APM), edifici scomparsi, scaricamento del LiDAR di altre regioni (di cui non conosco i nomi dei livelli), GNA, vincoli ufficiali, rapporto in PDF.

## Come è stata verificata

Le prove della logica passano. L'interfaccia è stata provata in Chromium headless con una libreria cartografica sostitutiva e servizi simulati: schede, ricerca, filtri, zone, fonti, esportazioni, modalità pubblica, protezione dall'iniezione di HTML, cache e riapertura senza rete. Per il rilievo, sempre in Chromium: caricamento di un GeoTIFF e di un ASCII, lettura nel Web Worker e ripiego senza worker, sei visualizzazioni, ricerca delle anomalie, filtro edifici, esportazioni, file non valido, impostazioni salvate.

Il livello del Ministero è stato provato in Chromium con Leaflet vero e risposte simulate in tre casi: app Android simulata (richieste `http`, immagini caricate), sito `https` senza proxy (richieste `https` e messaggio chiaro se il servizio non risponde) e sito con proxy. Il programma del proxy è provato con un servizio simulato. In Chromium, con client nativo simulato, sono provati anche: il ripiego quando l'immagine normale non carica, il messaggio vero del servizio in caso di errore, il pulsante «Perché non si vede?», il rilievo dal servizio senza file (scelta regione e livello, scarico, quote in metri o livelli relativi, ricerca delle anomalie, nessun riscarico se l'area non cambia) e lo stesso dal sito con proxy che consente la lettura. Sempre in Chromium con client nativo simulato: la verifica su tessera vera di tutti i servizi, la richiesta del catasto (versione 1.3.0, EPSG:4258, BBOX in ordine latitudine e longitudine attorno al centro) e la scelta del livello IGM.

Vista 3D: in Chromium con WebGL2 (render software) e MapLibre vero, con TINITALY, Terrarium, satellite ed edifici simulati ma con file nel formato vero: apertura al tocco di «3D», quote lette dal terreno 3D che coincidono con quelle del file entro 1,5 m (e non con quelle mondiali), dichiarazione della fonte, cambio base, ombre, edifici, esagerazione ×2, tocco con quota, chiusura con Esc e con Indietro, riapertura. Il lettore del GeoTIFF dell'INGV è stato provato anche sul servizio vero, da un computer di GitHub («Actions → Diagnosi 3D quote»): il servizio restituisce un riquadro più largo di quello chiesto, e l'app lo ricampiona leggendo la georeferenziazione.

Non è stata provata su telefoni veri, con i servizi del Ministero reali (nemmeno le immagini LiDAR che restituiscono davvero), **con la costruzione dell'APK su GitHub (non eseguibile dall'ambiente di sviluppo)**, con un proxy messo davvero online né **con un file LiDAR italiano vero**: nessun dato reale era raggiungibile. Va fatta una prova sul campo prima di consegnarla.

## Note legali

Le ricerche archeologiche sul terreno sono riservate allo Stato e richiedono concessione o autorizzazione (D.Lgs. 42/2004, artt. 88 e 89). Le zone di potenziale sono ipotesi di studio. I ritrovamenti fortuiti vanno denunciati (art. 90): verifica sempre il testo vigente.

## Licenze dei dati

© collaboratori di OpenStreetMap (ODbL); OpenTopoMap (CC-BY-SA); Esri; Wikipedia e Wikimedia Commons (licenze indicate caso per caso); Internet Archive; Europeana; Geoportale Nazionale (MASE) e Agenzia delle Entrate secondo le rispettive licenze. I rilievi che carichi restano soggetti alla licenza del file (per TINITALY: citare INGV secondo la licenza indicata dal distributore).
