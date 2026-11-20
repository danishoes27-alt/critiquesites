// Medidor "texto" (SPEC §6.4, PLAN M3.4): texto "genérico/batido".
//
// NUNCA afirma que um texto foi escrito por IA. Só mede sinais de texto genérico/batido e escolhe as frases
// para o "teste da troca" (que o MODELO responde: "se eu trocar o nome desta empresa pelo do concorrente,
// a frase continua verdadeira?"). Tudo determinístico (empates ordenados por texto).
//
// Entrada (medirTexto): páginas do ctx (usa o DOM final: nós com visivel && !clone, tags de bloco, sem nav/footer/
// blockquote/código) OU páginas sintéticas { pagina, texto } / { pagina, blocos:[...], ctas:[...] }.
//
// Campos de `dados`:
//   total / paginas[]   palavras, frases, legibilidade{flesch,faixa,...}, cliches{...}, travessoes, exclamacoes, especificidade,
//                       aberturasRepetidas, estruturas, tricolons, ctas, headlinesVagos, loremIpsum
//   cliches             { lista, ocorrencias[], porId[], porTipo }
//   fraseParaTesteDaTroca [{ pagina, frase, motivo, pontuacao }]   (as N frases mais genéricas, N=5)
import { readFileSync } from 'node:fs';
import { saidaMedidor } from '../contexto.mjs';

export const id = 'texto';
export const VERSAO = '1';

const ARQUIVO_CLICHES = new URL('../../regras/texto/cliches-pt-br.json', import.meta.url);
// Tipos da lista que entram na densidade de clichês (regra txt-densidade-cliches). "cta-generico" e "estrutura" são medidos à parte.
export const TIPOS_CLICHE = ['hype', 'vago', 'abertura-batida', 'fechamento-batido'];
export const MIN_REPETICAO = 3; // mesma abertura de 2 palavras em >= 3 frases = repetição

// ---------------------------------------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------------------------------------
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
const porMil = (n, palavras) => (palavras > 0 ? r2((n / palavras) * 1000) : 0);
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // comparação por código (sem locale): determinística em qualquer máquina
const tokensDe = (s) => String(s).split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));

const ABREVIACOES = /(?:^|[\s(])(?:dr|dra|sr|sra|srta|prof|profa|av|tel|ex|etc|cia|ltda|obs|art|vs|ed|min|aprox|pq)\.$/i;
const INICIAL = /(?:^|[\s(])\p{Lu}\.$/u; // "J. Silva" (só maiúscula: "é." no fim de frase não é inicial)

// Frases: quebra em . ! ? … seguidos de espaço, sem quebrar abreviações ("Dr.", "etc.") nem iniciais ("J. Silva").
export function dividirFrases(texto) {
  const brutas = String(texto ?? '').split(/(?<=[.!?…]["')\]”’»]*)\s+/u);
  const out = [];
  for (const b of brutas) {
    const s = b.trim();
    if (!s) continue;
    if (out.length && (ABREVIACOES.test(out[out.length - 1]) || INICIAL.test(out[out.length - 1]))) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// Contador de sílabas simples para português (heurística; erra em hiatos/ditongos ambíguos, ex.: "ideia", "dia").
// Regras: cada grupo de vogais conta 1; hiato separa (a) duas vogais fortes (a, e, o e acentuadas, exceto ã/õ),
// (b) vogal + í/ú acentuados (sa-í-da, pa-ís). "qu"/"gu" antes de e/i: o u é mudo.
const VOGAL = /[aeiouáéíóúâêôãõàü]/;
const FORTE = /[aeoáéóâêôà]/;
export function contarSilabas(palavra) {
  let w = String(palavra).toLowerCase().normalize('NFC').replace(/[^\p{L}]/gu, '');
  if (!w) return 0;
  w = w.replace(/([qg])u(?=[eiéêíè])/g, '$1');
  let n = 0;
  let ant = null;
  for (const c of w) {
    if (VOGAL.test(c)) {
      if (ant === null) n++;
      else if ((FORTE.test(ant) && FORTE.test(c)) || /[íú]/.test(c)) n++;
      ant = c;
    } else ant = null;
  }
  return Math.max(n, 1);
}

function silabasDoTexto(texto) {
  let total = 0;
  for (const t of tokensDe(texto)) {
    const partes = t.split(/[^\p{L}]+/u).filter(Boolean);
    total += partes.length ? partes.reduce((a, p) => a + contarSilabas(p), 0) : 1; // número puro: 1 sílaba (simplificação)
  }
  return total;
}

// Legibilidade: índice de Flesch adaptado ao português (Martins et al., 1996, ICMC-USP):
//   F = 248.835 − 1.015 × (palavras / frases) − 84.6 × (sílabas / palavras)
// Faixas usadas: 75–100 muito fácil, 50–75 fácil, 25–50 difícil, < 25 muito difícil. É sinal, não veredito.
export function fleschPt(palavras, frases, silabas) {
  if (!palavras || !frases) return null;
  return 248.835 - 1.015 * (palavras / frases) - 84.6 * (silabas / palavras);
}
const faixaFlesch = (f) => (f === null ? null : f >= 75 ? 'muito fácil' : f >= 50 ? 'fácil' : f >= 25 ? 'difícil' : 'muito difícil');

// ---------------------------------------------------------------------------------------------------------
// Listas de apoio (dados)
// ---------------------------------------------------------------------------------------------------------
// CTAs genéricos, já normalizados (minúsculas, sem acento, sem pontuação).
export const CTAS_GENERICOS = [
  'saiba mais', 'saiba mais sobre', 'saiba como', 'clique aqui', 'clique aqui para saber mais', 'clique para saber mais',
  'comece agora', 'comece ja', 'comece gratis', 'comecar agora', 'comecar', 'quero comecar', 'vamos comecar',
  'fale conosco', 'fale com a gente', 'fale com um especialista', 'entre em contato', 'contate nos',
  'veja mais', 'ver mais', 'ver detalhes', 'leia mais', 'continue lendo', 'mais informacoes', 'mais detalhes',
  'conheca', 'conheca mais', 'confira', 'descubra', 'descubra mais', 'quero saber mais', 'eu quero',
  'enviar', 'cadastre se', 'inscreva se', 'experimente gratis', 'experimente agora', 'teste gratis',
  'solicite um orcamento', 'peca um orcamento', 'agende uma demonstracao', 'compre agora', 'comprar agora', 'aproveite', 'acesse agora',
];

export const HEADLINES_VAGOS = [
  { id: 'bem-vindo', re: /^(seja\s+)?bem[- ]vind[oa]s?\b/i, descricao: 'abertura de boas-vindas' },
  { id: 'solucoes-adjetivo', re: /(solu[cç][oõ]es|servi[cç]os|produtos)\s+(inovador\w*|completos?|completas?|personalizad\w*|sob\s+medida|de\s+qualidade|de\s+excel[eê]ncia|de\s+ponta)/i, descricao: 'soluções/serviços + adjetivo genérico' },
  { id: 'verbo-de-hype', re: /^(transforme|turbine|impulsione|potencialize|alavanque|eleve|revolucione|reinvente|desbloqueie|libere)\s+(o|a|os|as|seu|sua|seus|suas|todo|todos)\s/i, descricao: 'verbo de hype + seu negócio/sua marca' },
  { id: 'proximo-nivel', re: /pr[oó]ximo\s+n[ií]vel|pr[oó]xima\s+gera[cç][aã]o/i, descricao: 'próximo nível/próxima geração' },
  { id: 'palavra-abstrata-sozinha', re: /^(qualidade|excel[eê]ncia|inova[cç][aã]o|confian[cç]a|compromisso|tecnologia|experi[eê]ncia|resultados?|sucesso|solu[cç][oõ]es|crescimento)[.!]?$/i, descricao: 'uma palavra abstrata sozinha' },
  { id: 'tricolon-de-adjetivos', re: /^\p{L}+,\s*\p{L}+\s+e\s+\p{L}+[.!]?$/iu, descricao: '"A, B e C" sem informação' },
  { id: 'tudo-que-precisa', re: /tudo\s+(o\s+)?que\s+(voc[eê]|sua\s+empresa|seu\s+neg[oó]cio)\s+precisa/i, descricao: '"tudo que você precisa"' },
  { id: 'melhor-escolha', re: /(a\s+)?(melhor|ideal|perfeit[ao])\s+(op[cç][aã]o|escolha|solu[cç][aã]o|parceir[oa])\s+para\s+(voc[eê]|seu|sua)/i, descricao: '"a melhor escolha para você"' },
  { id: 'negocio-crescer', re: /para\s+(o\s+)?(seu|sua)\s+(neg[oó]cio|empresa|marca)\s+(crescer|decolar|voar|alcan[cç]ar|ir\s+mais\s+longe)/i, descricao: '"para o seu negócio crescer"' },
  { id: 'qualidade-e-excelencia', re: /(excel[eê]ncia|qualidade|inova[cç][aã]o)\s+(e|,)\s+(excel[eê]ncia|qualidade|inova[cç][aã]o|compromisso|confian[cç]a)/i, descricao: 'pares de abstrações' },
];

const ABSTRATAS = new Set(['qualidade', 'excelencia', 'inovacao', 'inovador', 'inovadora', 'inovadores', 'inovadoras', 'solucoes', 'solucao', 'resultados', 'resultado', 'experiencia', 'tecnologia', 'sucesso', 'potencial', 'futuro', 'jornada', 'melhor', 'melhores', 'ideal', 'completo', 'completa', 'unico', 'unica', 'personalizado', 'personalizada', 'eficiente', 'eficiencia', 'transformar', 'transforma', 'crescimento', 'confianca', 'compromisso', 'paixao', 'profissionalismo', 'diferencial', 'negocio', 'negocios', 'empresa', 'marca', 'simples', 'facil', 'rapido', 'rapida', 'seguro', 'segura', 'moderno', 'moderna', 'incrivel', 'perfeito', 'perfeita', 'necessidades', 'mercado', 'estrategia', 'estrategias', 'valor', 'impacto', 'evolucao', 'performance']);

const LOREM = /lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing|sed\s+do\s+eiusmod|ipsum\s+dolor/i;

const NUMEROS_EXTENSO = /(?<![\p{L}])(dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|mil|milh[aã]o|milh[oõ]es|bilh[aã]o|bilh[oõ]es)(?![\p{L}])/iu;
const MOEDA = /R\$|US\$|€|£|(?<![\p{L}])(reais|real|d[oó]lares?|euros?|centavos)(?![\p{L}])/iu;
const UNIDADE = /%|°\s?[CF]\b|\bm²|\bkm²|(?<=\d\s?)(km|kg|g|mg|ml|l|litros?|metros?|cm|mm|gb|mb|tb|kcal|w|kw|mah|hz|ghz|h|min|horas?|minutos?|dias?|semanas?|meses|m[eê]s|anos?)(?![\p{L}])/iu;
const DATA = /(?<![\p{L}])(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|segunda-feira|ter[cç]a-feira|quarta-feira|quinta-feira|sexta-feira|s[aá]bado|domingo)(?![\p{L}])/iu;

// ---------------------------------------------------------------------------------------------------------
// Lista de clichês (dado): arquivo regras/texto/cliches-pt-br.json ou lista injetada
// ---------------------------------------------------------------------------------------------------------
export function carregarCliches() {
  try {
    const lista = JSON.parse(readFileSync(ARQUIVO_CLICHES, 'utf8'));
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// Compila a lista. Padrões com espaços sobrando no fim ("cansad[oa] de  ") são aparados e espaços duplos viram um.
function compilarCliches(lista, tipos) {
  const ativos = [];
  const invalidos = [];
  for (const c of lista) {
    if (!c || typeof c.padrao !== 'string' || !c.id) continue;
    if (tipos && c.tipo && !tipos.includes(c.tipo)) continue;
    const fonte = c.padrao.replace(/ {2,}/g, ' ').replace(/\s+$/, '');
    try {
      ativos.push({ id: c.id, tipo: c.tipo || 'sem-tipo', peso: Number.isFinite(c.peso) ? c.peso : 1, confianca: c.confianca || null, re: new RegExp(fonte, 'gi') });
    } catch { invalidos.push(c.id); }
  }
  return { ativos, invalidos };
}

// Acha clichês em UMA frase (sem sobreposição: vence quem começa antes, depois o mais longo, depois o de maior peso).
function acharCliches(texto, ativos) {
  const todos = [];
  for (const c of ativos) {
    c.re.lastIndex = 0;
    let m;
    while ((m = c.re.exec(texto))) {
      if (m[0].length === 0) { c.re.lastIndex++; continue; }
      todos.push({ c, ini: m.index, fim: m.index + m[0].length, trecho: m[0] });
    }
  }
  todos.sort((a, b) => a.ini - b.ini || b.fim - a.fim || b.c.peso - a.c.peso || cmp(a.c.id, b.c.id));
  const aceitos = [];
  let limite = -1;
  for (const t of todos) {
    if (t.ini < limite) continue;
    aceitos.push(t);
    limite = t.fim;
  }
  return aceitos.map((t) => ({ id: t.c.id, tipo: t.c.tipo, peso: t.c.peso, confianca: t.c.confianca, trecho: t.trecho }));
}

// ---------------------------------------------------------------------------------------------------------
// Preparação das páginas: unidades de texto, CTAs
// ---------------------------------------------------------------------------------------------------------
const EXCLUIR_TAGS = new Set(['nav', 'footer', 'pre', 'code', 'blockquote', 'button', 'a', 'select', 'option', 'script', 'style', 'noscript', 'template', 'textarea', 'svg', 'label']);
const INLINE = new Set(['span', 'strong', 'b', 'em', 'i', 'mark', 'small', 'u', 'sub', 'sup', 'abbr', 'cite', 'q', 'time', 's', 'del', 'ins', 'bdi', 'bdo', 'font']);
const tagsDoSeletor = (sel) => String(sel || '').split('>').map((s) => (/^[a-z][a-z0-9-]*/.exec(s) || [null])[0]).filter(Boolean);
const paiDoSeletor = (sel) => { const i = String(sel).lastIndexOf('>'); return i < 0 ? '' : sel.slice(0, i); };
const caminhoDe = (p) => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.pagina || p.url || '/'; } };

function unidadesDeExtr(extr) {
  const visiveis = (extr.nos || []).filter((n) => n.visivel && !n.clone && n.texto);
  const seletores = new Set(visiveis.map((n) => n.seletor));
  const unidades = [];
  for (const n of visiveis) {
    if (tagsDoSeletor(n.seletor).some((t) => EXCLUIR_TAGS.has(t))) continue;
    const fragmento = INLINE.has(n.tag) && seletores.has(paiDoSeletor(n.seletor));
    unidades.push({ texto: n.texto, tag: n.tag, seletor: n.seletor, tipo: fragmento ? 'fragmento' : 'bloco' });
  }
  const ctas = [];
  for (const l of extr.links || []) {
    if (!l.visivel || l.clone) continue;
    const t = (l.texto || l.ariaLabel || '').trim();
    if (t) ctas.push({ texto: t, seletor: l.seletor });
  }
  // botões: o texto pode estar em filhos (<button><span>Comece</span></button>); agrupa pelo seletor do <button>
  const botoes = new Map();
  for (const n of visiveis) {
    const segs = n.seletor.split('>');
    const i = segs.findIndex((x) => /^button(:|$)/.test(x));
    if (i < 0) continue;
    const chave = segs.slice(0, i + 1).join('>');
    botoes.set(chave, [...(botoes.get(chave) || []), n.texto]);
  }
  for (const [seletor, partes] of botoes) ctas.push({ texto: partes.join(' ').trim(), seletor });
  return { unidades, ctas };
}

function prepararEntrada(p) {
  const extr = p.final?.extr || p.dom250?.extr || p.cru?.extr || null;
  if (extr) {
    const versao = p.final?.extr ? 'final' : p.dom250?.extr ? 'dom250' : 'cru';
    return { pagina: caminhoDe(p), versao, ...unidadesDeExtr(extr) };
  }
  const blocos = typeof p.texto === 'string' ? p.texto.split(/\n+/) : (p.blocos || []);
  const unidades = blocos.map((b, i) => (typeof b === 'string' ? { texto: b, tag: 'p', seletor: `bloco:${i + 1}`, tipo: 'bloco' } : { tag: 'p', seletor: `bloco:${i + 1}`, tipo: 'bloco', ...b })).filter((u) => u.texto && u.texto.trim());
  const ctas = (p.ctas || []).map((c, i) => (typeof c === 'string' ? { texto: c, seletor: `cta:${i + 1}` } : c));
  return { pagina: p.pagina || p.url || '/', versao: 'sintetica', unidades, ctas };
}

const ehTitulo = (tag) => /^h[1-6]$/.test(tag);

// Especificidade de uma frase: número, nome próprio (capitalizada fora do início), moeda/unidade ou data.
function especificidadeDe(frase, tag) {
  const tokens = frase.split(/\s+/).filter(Boolean);
  const numero = /\d/.test(frase) || NUMEROS_EXTENSO.test(frase);
  const moeda = MOEDA.test(frase);
  const unidade = UNIDADE.test(frase);
  const data = DATA.test(frase);
  let nomeProprio = false;
  if (!ehTitulo(tag)) {
    const limpos = tokens.map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    const capitalizada = (t) => /^\p{Lu}\p{L}+/u.test(t);
    const capitalizadas = limpos.filter(capitalizada).length;
    const tituloCapitalizado = limpos.length >= 3 && capitalizadas / limpos.length > 0.5; // "Nossos Serviços Principais"
    if (!tituloCapitalizado) nomeProprio = limpos.slice(1).some(capitalizada);
  }
  const categorias = [numero && 'número', nomeProprio && 'nome próprio', moeda && 'moeda', unidade && 'unidade', data && 'data'].filter(Boolean);
  return { numero, nomeProprio, moeda, unidade, data, categorias, especifica: categorias.length > 0 };
}

const ITEM = '[\\p{L}\\p{N}][\\p{L}\\p{N}\'’-]*(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}\'’-]*)?';
const RE_TRICOLON = new RegExp(`(?<![\\p{L}\\p{N}])(${ITEM}),\\s+(${ITEM}),?\\s+(?:e|ou|&)\\s+(${ITEM})(?![\\p{L}\\p{N}])`, 'giu');
const RE_NAO_E_X_E_Y = /(?<![\p{L}])n[aã]o\s+(?:[eé]|s[aã]o|somos|foi|era|ser[aá])\s+(?:apenas\s+|s[oó]\s+|somente\s+|meramente\s+|simplesmente\s+)?[^.!?;\n]{2,60}?\s*(?:[,;:]|[—–]|\s-\s|\.\s+)\s*(?:mas\s+(?:sim\s+)?|e\s+sim\s+)?(?:[eé]|s[aã]o|somos|ser[aá])(?=\s|[.,!?]|$)/giu;
const RE_NAO_APENAS_MAS = /(?<![\p{L}])n[aã]o\s+(?:apenas|s[oó]|somente)\s+[^.!?\n]{2,60}?,?\s+mas\s+(?:tamb[eé]m|sim)(?=\s|[.,!?]|$)/giu;

function acharTricolons(frase) {
  const out = [];
  RE_TRICOLON.lastIndex = 0;
  let m;
  while ((m = RE_TRICOLON.exec(frase))) {
    const itens = [m[1], m[2], m[3]];
    if (itens.filter((t) => /\d/.test(t)).length >= 2) continue; // "10, 20 e 30 itens": enumeração numérica não é tricolon retórico
    out.push(m[0]);
  }
  return out;
}

function normalizarCta(t) {
  return semAcento(String(t).toLowerCase()).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Monta os registros por página: frases (com clichês e especificidade já calculados) e fragmentos.
function processarPagina(prep, ativos) {
  const frases = [];
  const fragmentos = [];
  const pecas = []; // todo texto de prosa (para palavras, travessão, exclamação, lorem)
  const estruturas = [];
  const headlines = [];
  for (const u of prep.unidades) {
    pecas.push(u);
    if (LOREM.test(u.texto)) u.lorem = true;
    if (u.tipo === 'fragmento') {
      fragmentos.push({ texto: u.texto, seletor: u.seletor, cliches: acharCliches(u.texto, ativos) });
      continue;
    }
    for (const re of [RE_NAO_E_X_E_Y, RE_NAO_APENAS_MAS]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(u.texto))) estruturas.push({ tipo: re === RE_NAO_E_X_E_Y ? 'nao-e-x-e-y' : 'nao-apenas-mas-tambem', trecho: m[0], seletor: u.seletor });
    }
    if (/^h[1-3]$/.test(u.tag)) {
      const t = u.texto.trim();
      const hit = HEADLINES_VAGOS.find((h) => h.re.test(t));
      if (hit && !/\d/.test(t)) headlines.push({ nivel: Number(u.tag[1]), texto: t, padraoId: hit.id, seletor: u.seletor });
    }
    for (const f of dividirFrases(u.texto)) {
      const toks = tokensDe(f);
      frases.push({
        texto: f, seletor: u.seletor, tag: u.tag, palavras: toks.length, silabas: silabasDoTexto(f),
        esp: especificidadeDe(f, u.tag), cliches: acharCliches(f, ativos), tricolons: acharTricolons(f),
        abertura: toks.length >= 3 ? toks.slice(0, 2).map((t) => semAcento(t.toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '')).join(' ') : null,
      });
    }
  }
  const palavrasFrag = fragmentos.reduce((a, f) => a + tokensDe(f.texto).length, 0);
  const silabasFrag = fragmentos.reduce((a, f) => a + silabasDoTexto(f.texto), 0);
  return { pagina: prep.pagina, versao: prep.versao, frases, fragmentos, pecas, estruturas, headlines, ctas: prep.ctas, palavrasFrag, silabasFrag };
}

// Calcula as métricas de um conjunto de páginas já processadas (usado por página e para o total).
function calcular(pags) {
  const frases = pags.flatMap((p) => p.frases.map((f) => ({ ...f, pagina: p.pagina })));
  const fragmentos = pags.flatMap((p) => p.fragmentos.map((f) => ({ ...f, pagina: p.pagina })));
  const pecas = pags.flatMap((p) => p.pecas.map((u) => ({ ...u, pagina: p.pagina })));
  const palavras = frases.reduce((a, f) => a + f.palavras, 0) + pags.reduce((a, p) => a + p.palavrasFrag, 0);
  const silabas = frases.reduce((a, f) => a + f.silabas, 0) + pags.reduce((a, p) => a + p.silabasFrag, 0);
  const nFrases = frases.length;

  // clichês
  const ocorrencias = [];
  for (const f of frases) for (const c of f.cliches) ocorrencias.push({ pagina: f.pagina, seletor: f.seletor, ...c, frase: f.texto });
  for (const f of fragmentos) for (const c of f.cliches) ocorrencias.push({ pagina: f.pagina, seletor: f.seletor, ...c, frase: f.texto });
  const pesoTotal = ocorrencias.reduce((a, o) => a + o.peso, 0);
  const porIdMap = new Map();
  const porTipo = {};
  for (const o of ocorrencias) {
    const x = porIdMap.get(o.id) || { id: o.id, tipo: o.tipo, peso: o.peso, vezes: 0 };
    x.vezes++;
    porIdMap.set(o.id, x);
    const t = (porTipo[o.tipo] ||= { vezes: 0, peso: 0 });
    t.vezes++;
    t.peso += o.peso;
  }
  const porId = [...porIdMap.values()].sort((a, b) => b.vezes - a.vezes || cmp(a.id, b.id));

  // travessão e exclamação (todas as peças de prosa)
  let travessoes = 0;
  let exclamacoes = 0;
  for (const u of pecas) {
    travessoes += (u.texto.match(/—/g) || []).length;
    exclamacoes += (u.texto.match(/!+/g) || []).length;
  }

  // especificidade
  const especificas = frases.filter((f) => f.esp.especifica).length;
  const contaCat = { numero: 0, nomeProprio: 0, moeda: 0, unidade: 0, data: 0 };
  for (const f of frases) for (const k of Object.keys(contaCat)) if (f.esp[k]) contaCat[k]++;

  // repetição: aberturas
  const aberturas = new Map();
  let elegiveis = 0;
  for (const f of frases) {
    if (!f.abertura) continue;
    elegiveis++;
    const x = aberturas.get(f.abertura) || { abertura: f.abertura, vezes: 0, exemplos: [] };
    x.vezes++;
    if (x.exemplos.length < 3) x.exemplos.push(f.texto);
    aberturas.set(f.abertura, x);
  }
  const aberturasRepetidas = [...aberturas.values()].filter((x) => x.vezes >= MIN_REPETICAO).sort((a, b) => b.vezes - a.vezes || cmp(a.abertura, b.abertura));
  const comAberturaRepetida = aberturasRepetidas.reduce((a, x) => a + x.vezes, 0);

  // estruturas e tricolons
  const estruturas = pags.flatMap((p) => p.estruturas.map((e) => ({ pagina: p.pagina, ...e })));
  const tricolons = [];
  let tricolonsEmSequencia = 0;
  for (const p of pags) {
    const tem = p.frases.map((f) => f.tricolons.length > 0);
    p.frases.forEach((f, i) => {
      for (const t of f.tricolons) tricolons.push({ pagina: p.pagina, seletor: f.seletor, trecho: t });
      if (tem[i] && (tem[i - 1] || tem[i + 1])) tricolonsEmSequencia++;
    });
  }

  // CTAs
  const listaCtas = new Set(CTAS_GENERICOS);
  const ctasAll = pags.flatMap((p) => p.ctas.map((c) => ({ ...c, pagina: p.pagina })));
  const ctasValidos = ctasAll.filter((c) => normalizarCta(c.texto));
  const genericos = ctasValidos.filter((c) => (c.ctasLista || listaCtas).has(normalizarCta(c.texto)));
  const contagemCta = new Map();
  for (const c of genericos) contagemCta.set(c.texto, (contagemCta.get(c.texto) || 0) + 1);

  const headlinesVagos = pags.flatMap((p) => p.headlines.map((h) => ({ pagina: p.pagina, ...h })));
  const lorem = pecas.filter((u) => u.lorem).map((u) => ({ pagina: u.pagina, seletor: u.seletor, trecho: (LOREM.exec(u.texto) || [''])[0] }));

  const flesch = fleschPt(palavras, nFrases, silabas);
  return {
    palavras,
    frases: nFrases,
    silabas,
    legibilidade: {
      flesch: flesch === null ? null : r2(flesch),
      faixa: faixaFlesch(flesch),
      palavrasPorFrase: nFrases ? r2(palavras / nFrases) : 0,
      silabasPorPalavra: palavras ? r2(silabas / palavras) : 0,
    },
    cliches: { quantidade: ocorrencias.length, pesoTotal, porMil: porMil(ocorrencias.length, palavras), indicePonderado: porMil(pesoTotal, palavras), amostraSuficiente: palavras >= 150 },
    travessoes: { quantidade: travessoes, porMil: porMil(travessoes, palavras) },
    exclamacoes: { quantidade: exclamacoes, porMil: porMil(exclamacoes, palavras) },
    especificidade: { frasesEspecificas: especificas, fracao: nFrases ? r4(especificas / nFrases) : 0, porCategoria: contaCat },
    repeticao: {
      frasesElegiveis: elegiveis,
      frasesComAberturaRepetida: comAberturaRepetida,
      fracaoAberturaRepetida: elegiveis ? r4(comAberturaRepetida / elegiveis) : 0,
      aberturasRepetidas,
      naoEXEY: estruturas.length,
      tricolons: tricolons.length,
      tricolonsEmSequencia,
    },
    ctas: {
      total: ctasValidos.length,
      genericos: genericos.length,
      fracaoGenericos: ctasValidos.length ? r4(genericos.length / ctasValidos.length) : 0,
      lista: [...contagemCta.entries()].map(([texto, vezes]) => ({ texto, vezes })).sort((a, b) => b.vezes - a.vezes || cmp(a.texto, b.texto)),
    },
    headlinesVagos: headlinesVagos.length,
    loremIpsum: lorem.length,
    _detalhes: { ocorrencias, porId, porTipo, estruturas, tricolons, headlinesVagos, lorem },
  };
}

// Seleção das frases mais genéricas (teste da troca): pontuação = soma dos pesos de clichê + 4 (sem especificidade)
// + brevidade (≤6 palavras: 3, ≤10: 2, ≤16: 1) + palavras abstratas (máx. 3). Frase específica sem clichê não entra.
function escolherFrasesParaTroca(pags, quantidade) {
  const vistas = new Set();
  const candidatas = [];
  for (const p of pags) {
    for (const f of p.frases) {
      if (f.palavras < 3 || f.palavras > 40) continue;
      if (f.esp.especifica && f.cliches.length === 0) continue;
      const chave = f.texto.toLowerCase().replace(/\s+/g, ' ');
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const pesoCliches = f.cliches.reduce((a, c) => a + c.peso, 0);
      const brev = f.palavras <= 6 ? 3 : f.palavras <= 10 ? 2 : f.palavras <= 16 ? 1 : 0;
      const abstratas = [...new Set(tokensDe(f.texto).map((t) => semAcento(t.toLowerCase()).replace(/[^a-z]/g, '')).filter((t) => ABSTRATAS.has(t)))];
      const pontuacao = pesoCliches + (f.esp.especifica ? 0 : 4) + brev + Math.min(3, abstratas.length);
      if (pontuacao < 3) continue;
      const motivos = [];
      if (f.cliches.length) motivos.push(`clichê (${[...new Set(f.cliches.map((c) => c.id))].join(', ')})`);
      if (!f.esp.especifica) motivos.push('sem número, nome próprio, unidade ou data');
      if (f.palavras <= 10) motivos.push(`frase curta (${f.palavras} palavras)`);
      if (abstratas.length) motivos.push(`palavras abstratas (${abstratas.join(', ')})`);
      candidatas.push({ pagina: p.pagina, frase: f.texto, motivo: motivos.join('; '), pontuacao, seletor: f.seletor });
    }
  }
  candidatas.sort((a, b) => b.pontuacao - a.pontuacao || cmp(a.frase.toLowerCase(), b.frase.toLowerCase()) || cmp(a.pagina, b.pagina));
  return candidatas.slice(0, quantidade);
}

// ---------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------
// paginas: páginas do ctx ou sintéticas. opcoes: { cliches (lista injetável), tipos, quantidade, ctas (lista de CTAs genéricos já normalizados) }.
export function medirTexto(paginas, opcoes = {}) {
  const origemLista = opcoes.cliches ? 'parametro' : 'arquivo';
  const lista = opcoes.cliches ?? carregarCliches();
  const tipos = opcoes.tipos === undefined ? TIPOS_CLICHE : opcoes.tipos; // null = todos os tipos
  const { ativos, invalidos } = compilarCliches(lista, tipos);
  const quantidade = opcoes.quantidade ?? 5;

  const preps = (paginas || []).map(prepararEntrada);
  if (opcoes.ctas) {
    const set = new Set(opcoes.ctas.map(normalizarCta));
    for (const p of preps) p.ctas = p.ctas.map((c) => ({ ...c, ctasLista: set }));
  }
  const pags = preps.map((p) => processarPagina(p, ativos));

  const total = calcular(pags);
  const porPagina = pags.map((p) => { const m = calcular([p]); delete m._detalhes; return { pagina: p.pagina, versaoLida: p.versao, ...m }; });
  const det = total._detalhes;
  delete total._detalhes;

  const dados = {
    paginasAnalisadas: pags.length,
    versaoLida: [...new Set(pags.map((p) => p.versao))].join('+') || null,
    total,
    paginas: porPagina,
    cliches: {
      lista: { origem: origemLista, total: lista.length, usados: ativos.length, invalidos, tipos: tipos || 'todos' },
      ocorrencias: det.ocorrencias.slice(0, 300),
      porId: det.porId,
      porTipo: det.porTipo,
    },
    estruturas: { naoEXEY: det.estruturas, tricolons: det.tricolons },
    headlinesVagos: det.headlinesVagos,
    loremIpsum: det.lorem,
    fraseParaTesteDaTroca: escolherFrasesParaTroca(pags, quantidade),
  };
  return dados;
}

export async function medir(ctx, opcoes = {}) {
  const dados = medirTexto(ctx.paginas || [], opcoes);
  const versao = 'final';
  const ev = [];
  const ev1 = (pagina, seletor, trecho, valor, contagem = 1) => ev.push({ pagina, versao, seletor, trecho, valor, contagem, visivel: true });
  const topCliches = [...dados.cliches.ocorrencias].sort((a, b) => b.peso - a.peso || cmp(a.pagina, b.pagina) || cmp(a.trecho, b.trecho)).slice(0, 40);
  for (const o of topCliches) ev1(o.pagina, o.seletor, o.trecho, `cliche:${o.id}`);
  for (const f of dados.fraseParaTesteDaTroca) ev1(f.pagina, f.seletor, f.frase, 'teste-da-troca');
  for (const e of dados.estruturas.naoEXEY) ev1(e.pagina, e.seletor, e.trecho, `estrutura:${e.tipo}`);
  for (const h of dados.headlinesVagos) ev1(h.pagina, h.seletor, h.texto, `headline-vago:${h.padraoId}`);
  for (const l of dados.loremIpsum) ev1(l.pagina, l.seletor, l.trecho, 'lorem-ipsum');
  return saidaMedidor(id, dados, ev, VERSAO);
}
