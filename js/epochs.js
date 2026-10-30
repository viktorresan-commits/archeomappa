// Classificazione delle epoche per lessico di parole chiave (italiano/inglese).
// È un'euristica sul testo: indica il tema dichiarato, non data nulla.

export const EPOCHE = [
  { id: "preistoria", nome: "Preistoria", colore: "#8a6d3b" },
  { id: "protostoria", nome: "Protostoria", colore: "#a0522d" },
  { id: "etrusco", nome: "Etrusco", colore: "#b5547c" },
  { id: "greco", nome: "Greco e punico", colore: "#2e86c1" },
  { id: "romano", nome: "Romano", colore: "#c0392b" },
  { id: "tardoantico", nome: "Tardoantico", colore: "#7d3c98" },
  { id: "altomedioevo", nome: "Altomedioevo", colore: "#117a65" },
  { id: "medioevo", nome: "Medioevo", colore: "#1f618d" },
  { id: "moderno", nome: "Età moderna", colore: "#b9770e" },
  { id: "contemporaneo", nome: "Novecento", colore: "#566573" },
];

export function normalizza(testo) {
  return String(testo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// [espressione, peso]. Le frasi "consumano" il testo trovato così che le parole
// al loro interno non vengano contate due volte (es. "linea gotica").
const FRASI = [
  [/\blinea gotica\b/g, "contemporaneo", 4],
  [/\bgrande guerra\b/g, "contemporaneo", 4],
  [/\b(prima|seconda) guerra mondiale\b/g, "contemporaneo", 4],
  [/\bworld war\b/g, "contemporaneo", 4],
  [/\bvallo alpino\b/g, "contemporaneo", 4],
  [/\beta del bronzo\b|\bbronze age\b/g, "protostoria", 3],
  [/\beta del ferro\b|\biron age\b/g, "protostoria", 3],
  [/\bmagna grecia\b/g, "greco", 3],
  [/\balto ?medioevo\b|\bearly middle ages\b/g, "altomedioevo", 3],
  [/\btardo ?antic[oaie]\b|\blate antiquit(y|e)\b/g, "tardoantico", 3],
  [/\bvia (appia|flaminia|aurelia|cassia|salaria|latina|emilia|postumia|domizia|egnazia|valeria|tiburtina|casilina|ostiense|annia|popilia)\b/g, "romano", 3],
];

const PAROLE = {
  preistoria: [/\bpaleolit/, /\bmesolit/, /\bneolit/, /\beneolit/, /\bcalcolit/, /\bpreistor/, /\bprehistor/, /\bdolmen\b/, /\bmenhir\b/, /\bmegalit/, /\bpalafitt/, /\bincisioni rupestri\b/, /\bgraffiti rupestri\b/, /\bgrotta preistorica\b/],
  protostoria: [/\bprotostor/, /\bvillanovian/, /\bnuragic/, /\bnuraghe\b/, /\bnuraghi\b/, /\bterramar/, /\bcastellier/, /\bgolasecca/, /\bcivilta (di )?remedello\b/, /\bcultura di (polada|canegrate|golasecca)\b/],
  etrusco: [/\betrusc/, /\betruscan/],
  greco: [/\bgrec[oaie]\b/, /\bgreek\b/, /\bellenistic/, /\bhellenistic/, /\bcolonia greca\b/, /\bfenici/, /\bphoenician/, /\bpunic/, /\bcartagines/],
  romano: [/\bromano\b/, /\bromana\b/, /\bromane\b/, /\bromani\b/, /\broman\b/, /\bvilla rustica\b/, /\banfiteatr/, /\bamphitheat/, /\bcastrum\b/, /\bmunicipium\b/, /\bmansio\b/, /\bcenturiazion/, /\bacquedott/, /\baqueduct/, /\bimperiale\b/, /\brepubblicano\b/, /\bmilliario\b/, /\bterme\b/, /\bthermae\b/, /\bpiscina limaria\b/],
  tardoantico: [/\bpaleocristian/, /\bbizantin/, /\bbyzantin/, /\bcatacomb/, /\bearly christian\b/],
  altomedioevo: [/\blongobard/, /\blombard\b/, /\bostrogot/, /\bvisigot/, /\bcarolingi/, /\bbarbaric/, /\baltomedievale\b/, /\bpieve\b/],
  medioevo: [/\bmedioeval/, /\bmedieval/, /\bmedievale\b/, /\bcastello\b/, /\bcastle\b/, /\brocca\b/, /\bborgo fortificato\b/, /\babbazia\b/, /\babbey\b/, /\bmonastero\b/, /\bromanic[oaie]\b/, /\bromanesque\b/, /\bgotic[oaie]\b/, /\bgothic\b/, /\bfeudal/, /\bincastellamento\b/, /\bmotta\b/, /\btorre di guardia\b/],
  moderno: [/\brinascimental/, /\brenaissance\b/, /\bbarocc/, /\bbaroque\b/, /\bsettecent/, /\bottocent/, /\bseicent/, /\bcinquecent/, /\bborbonic/, /\bsabaud/, /\brisorgimento\b/, /\bbastione\b/, /\bfortezza\b/, /\bforte\b/],
  contemporaneo: [/\btrincea\b/, /\btrincee\b/, /\bbunker\b/, /\bnovecent/, /\bbellic[oa]\b/, /\bfascist/],
};

/** Punteggi per epoca dal testo: oggetto {idEpoca: punteggio} (solo >0). */
export function classifica(testo) {
  let t = normalizza(testo);
  const punti = {};
  const somma = (id, v) => { punti[id] = (punti[id] || 0) + v; };

  for (const [re, id, peso] of FRASI) {
    t = t.replace(re, () => { somma(id, peso); return " "; });
  }
  for (const [id, lista] of Object.entries(PAROLE)) {
    for (const re of lista) if (re.test(t)) somma(id, 1);
  }
  return punti;
}

/** Epoca dominante o null se il testo non ne indica nessuna. */
export function dominante(punti) {
  let best = null, max = 0;
  for (const [id, v] of Object.entries(punti)) {
    if (v > max) { best = id; max = v; }
  }
  return best;
}

/** Epoca da un anno (negativo = a.C.); null se ambigua (Etrusco/Greco/Romano si sovrappongono). */
export function epocaDaAnno(anno) {
  if (!Number.isFinite(anno)) return null;
  if (anno < -2300) return "preistoria";
  if (anno < -700) return "protostoria";
  if (anno < 476) return null;
  if (anno < 568) return "tardoantico";
  if (anno < 1000) return "altomedioevo";
  if (anno < 1492) return "medioevo";
  if (anno < 1914) return "moderno";
  return "contemporaneo";
}

/** Profilo percentuale di una lista di epoche dominanti (null = non classificato). */
export function profilo(listaEpoche) {
  const conteggi = {};
  let classificati = 0;
  for (const e of listaEpoche) {
    if (!e) continue;
    classificati++;
    conteggi[e] = (conteggi[e] || 0) + 1;
  }
  const percentuali = {};
  for (const [id, n] of Object.entries(conteggi)) percentuali[id] = (n / classificati) * 100;
  return {
    totale: listaEpoche.length,
    classificati,
    nonClassificati: listaEpoche.length - classificati,
    conteggi,
    percentuali,
  };
}
