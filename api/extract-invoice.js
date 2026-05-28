// Estrae le righe-vino da una fattura.
// Accetta:
//   - PDF / immagine/i (foto o scan cartaceo)  -> estrazione via Claude (vision/document)
//   - XML fattura elettronica SDI              -> parsing diretto dei DettaglioLinee
// Body JSON:
//   { kind:'pdf',   data:<base64> }
//   { kind:'image', images:[{data:<base64>, mediaType}] }   // 1..N pagine = UNA fattura
//   { kind:'image', data:<base64>, mediaType }              // singola pagina (compat)
//   { kind:'xml',   data:<testo xml> }
// Risposta: { items:[ {nome,descrizione,categoria,cl,quantita,prezzo_acquisto,iva,barcode} ], source }

const CATEGORIE = ['vino', 'bollicine', 'liquore', 'birra', 'soft'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // solo admin
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  const body = req.body || {};
  const kind = body.kind;

  try {
    if (kind === 'xml') {
      const items = parseSdiXml(body.data || '');
      return res.status(200).json({ items, source: 'xml' });
    }

    if (kind === 'pdf' || kind === 'image') {
      const API_KEY = process.env.ANTHROPIC_API_KEY;
      if (!API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY mancante' });
      // costruisci i blocchi documento/immagine (anche multi-pagina)
      let blocks;
      if (kind === 'pdf') {
        blocks = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.data } }];
      } else {
        const pages = Array.isArray(body.images) && body.images.length
          ? body.images
          : [{ data: body.data, mediaType: body.mediaType }];
        blocks = pages.map((p) => ({
          type: 'image',
          source: { type: 'base64', media_type: p.mediaType || 'image/jpeg', data: p.data },
        }));
      }
      const items = await extractWithClaude(API_KEY, blocks);
      return res.status(200).json({ items, source: kind, pages: blocks.length });
    }

    return res.status(400).json({ error: "kind deve essere 'pdf', 'image' o 'xml'" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ───────────────────────── Claude (PDF/foto) ─────────────────────────
async function extractWithClaude(apiKey, blocks) {
  const instructions = `Sei un assistente che legge le fatture di un fornitore di vini/bevande per un bar.
${blocks.length > 1 ? `Le immagini allegate (${blocks.length}) sono pagine/fogli della STESSA fattura: consideralo un unico documento.\n` : ''}Estrai SOLO le righe che sono prodotti vendibili (vini, bollicine, liquori/spirits, birre, analcolici).
IGNORA: trasporto, imballi, sconti, contributi CONAI, note, totali, bolli.
Per ogni prodotto restituisci un oggetto con questi campi:
- nome: nome del vino/prodotto (es. "Brunello di Montalcino"), pulito, senza codici articolo
- descrizione: produttore + denominazione + annata se presenti (es. "DOCG Toscana 2019 - Banfi")
- categoria: una tra ${CATEGORIE.join(', ')} (deduci dal nome; il default è "vino")
- cl: contenuto in centilitri come numero (deduci da "75cl", "0,75 L", "750ml"... default 75)
- quantita: numero di pezzi/bottiglie della riga (default 1)
- prezzo_acquisto: prezzo unitario IVA INCLUSA in euro come numero. Se in fattura il prezzo è al netto IVA, calcola il lordo aggiungendo l'aliquota.
- iva: aliquota IVA percentuale come numero (es. 22, 10). Default 22 per vini/alcolici.
- barcode: codice EAN se presente, altrimenti null
Rispondi ESCLUSIVAMENTE con un array JSON valido, senza testo prima o dopo, senza markdown.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: instructions }] }],
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error('Claude: ' + (data.error?.message || r.status));
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return normalizeItems(parseJsonArray(text));
}

function parseJsonArray(text) {
  let t = (text || '').trim();
  // togli eventuali code-fence ```json ... ```
  t = t.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Risposta AI non in formato JSON');
  return JSON.parse(t.slice(start, end + 1));
}

// ───────────────────────── XML SDI ─────────────────────────
function parseSdiXml(xml) {
  const items = [];
  const linee = xml.match(/<(?:\w+:)?DettaglioLinee>[\s\S]*?<\/(?:\w+:)?DettaglioLinee>/g) || [];
  for (const linea of linee) {
    const descr = tag(linea, 'Descrizione');
    if (!descr) continue;
    const qta = num(tag(linea, 'Quantita')) || 1;
    const prezzoNetto = num(tag(linea, 'PrezzoUnitario')) || 0;
    const iva = num(tag(linea, 'AliquotaIVA')) || 22;
    const prezzoLordo = round2(prezzoNetto * (1 + iva / 100));
    items.push({
      nome: cleanName(descr),
      descrizione: descr.trim(),
      categoria: guessCat(descr),
      cl: guessCl(descr),
      quantita: qta,
      prezzo_acquisto: prezzoLordo,
      iva,
      barcode: tag(linea, 'CodiceValore') || null,
    });
  }
  return normalizeItems(items);
}

function tag(s, name) {
  const m = s.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

// ───────────────────────── helper ─────────────────────────
function normalizeItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && (x.nome || x.descrizione))
    .map((x) => ({
      nome: String(x.nome || x.descrizione || '').slice(0, 120).trim(),
      descrizione: String(x.descrizione || '').slice(0, 200).trim(),
      categoria: CATEGORIE.includes(x.categoria) ? x.categoria : 'vino',
      cl: num(x.cl) || 75,
      quantita: num(x.quantita) || 1,
      prezzo_acquisto: round2(num(x.prezzo_acquisto) || 0),
      iva: num(x.iva) || 22,
      barcode: x.barcode ? String(x.barcode).trim() : null,
    }));
}

function cleanName(d) {
  return d.replace(/\b\d{1,2}[.,]?\d*\s?(cl|ml|lt|l)\b/gi, '').replace(/\s{2,}/g, ' ').trim().slice(0, 80);
}
function guessCat(d) {
  const s = d.toLowerCase();
  if (/(spuman|prosecc|champag|franciacort|metodo classico|brut|cremant)/.test(s)) return 'bollicine';
  if (/(grappa|vodka|gin|rum|whisk|liquor|amaro|brandy|cognac|tequila)/.test(s)) return 'liquore';
  if (/(birra|beer|lager|ipa|weiss)/.test(s)) return 'birra';
  if (/(acqua|succo|cola|analcol|soft|tonica|aranciata)/.test(s)) return 'soft';
  return 'vino';
}
function guessCl(d) {
  let m = d.match(/(\d{2,4})\s?ml/i);
  if (m) return Math.round(parseInt(m[1], 10) / 10);
  m = d.match(/(\d{1,2})\s?cl/i);
  if (m) return parseInt(m[1], 10);
  m = d.match(/0[.,](\d{2})\s?l/i);
  if (m) return parseInt(m[1], 10);
  m = d.match(/1[.,]5\s?l/i);
  if (m) return 150;
  return 75;
}
function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
