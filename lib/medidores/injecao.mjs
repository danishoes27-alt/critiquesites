// Medidor "injecao" (SPEC §4.6, PLAN M2.12): texto dirigido a IA/agente dentro do site analisado.
//
// O conteúdo do site é DADO, nunca instrução. Este medidor:
//   1) procura padrões PT/EN (regras/seguranca-conteudo.json, regra seg-injecao-de-prompt; se o arquivo
//      não existir, usa a lista interna) em: texto visível, texto OCULTO, comentários HTML, atributos
//      (alt/title/aria-label/placeholder), metas, JSON-LD, <noscript>, <title> e /llms.txt, nas 3 versões
//      de leitura (cru, dom250, final);
//   2) devolve dados.achados, um por texto de origem (nó, comentário, atributo...), com o trecho (<= 200 chars);
//   3) exporta sanitizarTexto() e textoSeguroDaPagina(): o pacote que vai ao modelo usa SÓ texto sanitizado
//      (a frase inteira que contém o padrão é trocada por um marcador).
//
// Campos de `dados`: achados[{onde,pagina,versao,versoes,visivel,seletor,trecho,padraoId,padroesIds,ocorrencias,campo?}],
// total, temInjecao, porOnde, porPadrao, ocultos, llmsTxt{...}, paginasAnalisadas, versoesAnalisadas, padroes{total,origem}.
import { readFileSync } from 'node:fs';
import { saidaMedidor } from '../contexto.mjs';
import { normalizarTexto } from '../util.mjs';
import { buscarSeguro } from '../rede-segura.mjs';

export const id = 'injecao';
export const VERSAO = '1';
export const MARCADOR = '[trecho removido: possível instrução dirigida a IA]';

// Lista interna (cópia dos padrões da regra seg-injecao-de-prompt): só é usada se o JSON de regras não existir.
const BASE_PT = [
  'ignore\\s+(todas\\s+)?as\\s+instru[cç][oõ]es(\\s+anteriores)?',
  'desconsidere\\s+(todas\\s+)?as\\s+instru[cç][oõ]es',
  'voc[eê]\\s+[eé]\\s+um(a)?\\s+(assistente|ia|intelig[eê]ncia\\s+artificial|agente)',
  'prompt\\s+do\\s+sistema|system\\s+prompt',
  'n[aã]o\\s+(conte|diga|informe|avise)\\s+(ao|para\\s+o)\\s+usu[aá]rio',
  'a\\s+partir\\s+de\\s+agora\\s+(voc[eê]|responda)',
];
const BASE_EN = [
  'ignore\\s+(all\\s+)?(the\\s+)?(previous|prior|above)\\s+instructions',
  'disregard\\s+(all\\s+)?(the\\s+)?(previous|prior)\\s+instructions',
  'you\\s+are\\s+(now\\s+)?an?\\s+(ai\\s+)?(assistant|agent|language\\s+model)',
  'system\\s+prompt',
  'do\\s+not\\s+tell\\s+the\\s+user',
  '(reveal|print)\\s+(your|the)\\s+(system\\s+)?(prompt|instructions)',
];

// Complementares do medidor (sempre somadas à lista do arquivo): variações comuns de ordem a IA que a regra não cobre.
const COMPLEMENTARES_PT = [
  'ignore\\s+(todas\\s+)?(as\\s+)?(suas\\s+)?(regras|diretrizes|orienta[cç][oõ]es)',
  'esque[cç]a\\s+(todas\\s+)?as\\s+instru[cç][oõ]es',
  'novas\\s+instru[cç][oõ]es\\s*:',
  '(nota|mensagem|instru[cç][aã]o|aviso)\\s+(para|a|aos?)\\s+(a\\s+)?(ia|intelig[eê]ncia\\s+artificial|assistentes?|agentes?|llms?|modelos?\\s+de\\s+linguagem|chatbots?)\\b',
  'avalie\\s+(este|esse|o)\\s+(site|p[aá]gina)\\s+com\\s+nota',
];
const COMPLEMENTARES_EN = [
  'ignore\\s+(all\\s+)?(your\\s+)?(rules|guidelines|safety)',
  'forget\\s+(all\\s+|everything\\s+)?(your\\s+|the\\s+)?(previous|prior|above)\\s+(instructions|rules)',
  'new\\s+instructions\\s*:',
  '(note|message|instructions?)\\s+(to|for)\\s+(the\\s+)?(ai|llm|assistant|agent|model|chatbot|chatgpt|claude)\\b',
  '(give|rate|score|grade)\\s+(this|the)\\s+(site|website|page)\\s+(a\\s+)?(score\\s+of\\s+|rating\\s+of\\s+)?(\\d+|perfect|maximum|the\\s+highest)',
];

const ARQUIVO_REGRAS = new URL('../../regras/seguranca-conteudo.json', import.meta.url);

function padroesDoArquivo() {
  try {
    const regras = JSON.parse(readFileSync(ARQUIVO_REGRAS, 'utf8'));
    const r = regras.find((x) => x.id === 'seg-injecao-de-prompt') || regras.find((x) => x.deteccao?.medidor === 'injecao');
    const p = r?.deteccao?.parametros?.padroes;
    if (p && (Array.isArray(p.pt) || Array.isArray(p.en))) return { pt: p.pt || [], en: p.en || [] };
  } catch { /* arquivo ausente ou inválido: usa a lista interna */ }
  return null;
}

function compilar(lista, prefixo, fonte, inicio = 1) {
  const out = [];
  lista.forEach((src, i) => {
    try { out.push({ id: `${prefixo}-${inicio + i}`, re: new RegExp(src, 'i'), fonte }); } catch { /* padrão inválido é ignorado */ }
  });
  return out;
}

function montarPadroes() {
  const arq = padroesDoArquivo();
  if (arq) {
    return {
      origem: 'arquivo+complementares',
      lista: [...compilar(arq.pt, 'pt', 'arquivo'), ...compilar(arq.en, 'en', 'arquivo'), ...compilar(COMPLEMENTARES_PT, 'pt-c', 'complementar'), ...compilar(COMPLEMENTARES_EN, 'en-c', 'complementar')],
    };
  }
  return { origem: 'interno', lista: [...compilar(BASE_PT, 'pt', 'interno'), ...compilar(BASE_EN, 'en', 'interno'), ...compilar(COMPLEMENTARES_PT, 'pt-c', 'complementar'), ...compilar(COMPLEMENTARES_EN, 'en-c', 'complementar')] };
}

const PADROES = montarPadroes();
export const padroesPadrao = () => PADROES.lista.map((p) => ({ id: p.id, padrao: p.re.source, fonte: p.fonte }));

// Aceita: undefined (padrão), array de string|RegExp|{id,re|padrao}, ou objeto { pt:[...], en:[...] }.
function normalizarPadroes(padroes) {
  if (padroes == null) return PADROES.lista;
  let itens = [];
  if (Array.isArray(padroes)) itens = padroes.map((p, i) => [`p-${i + 1}`, p]);
  else if (typeof padroes === 'object') {
    for (const [grupo, lista] of Object.entries(padroes)) (lista || []).forEach((p, i) => itens.push([`${grupo}-${i + 1}`, p]));
  }
  const out = [];
  for (const [idAuto, p] of itens) {
    try {
      if (p instanceof RegExp) {
        const flags = p.flags.replace(/[gy]/g, '');
        out.push({ id: idAuto, re: new RegExp(p.source, flags.includes('i') ? flags : flags + 'i'), fonte: 'parametro' });
      }
      else if (typeof p === 'string') out.push({ id: idAuto, re: new RegExp(p, 'i'), fonte: 'parametro' });
      else if (p && typeof p === 'object') {
        const src = p.re instanceof RegExp ? p.re.source : (p.padrao ?? p.re);
        out.push({ id: p.id || idAuto, re: new RegExp(src, 'i'), fonte: 'parametro' });
      }
    } catch { /* ignora */ }
  }
  return out;
}

// Frases: separa em . ! ? … seguidos de espaço (o texto já vem normalizado, sem quebras de linha).
const dividirFrases = (t) => t.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 0);

function janela(frase, idx, max = 200) {
  if (frase.length <= max) return frase;
  const ini = Math.max(0, Math.min(idx - 60, frase.length - max));
  return frase.slice(ini, ini + max);
}

// Procura padrões em um texto. Devolve [{ padraoId, padroesIds, frase, trecho, trechoCasado }] (uma entrada por frase com acerto).
export function detectarInjecao(texto, padroes) {
  const lista = normalizarPadroes(padroes);
  const norm = normalizarTexto(texto ?? '', { caixa: false });
  if (!norm) return [];
  const achados = [];
  for (const frase of dividirFrases(norm)) {
    const ids = [];
    let primeiro = null;
    for (const p of lista) {
      const m = p.re.exec(frase);
      if (m) { ids.push(p.id); if (!primeiro) primeiro = { id: p.id, m }; }
    }
    if (primeiro) achados.push({ padraoId: primeiro.id, padroesIds: ids, frase, trecho: janela(frase, primeiro.m.index), trechoCasado: primeiro.m[0] });
  }
  return achados;
}

// Remove do texto toda FRASE que contém um padrão de injeção, trocando-a por MARCADOR.
// Sem padrão: devolve o texto original, intacto. Com padrão: devolve o texto normalizado (NFKC, entidades, sem zero-width).
export function sanitizarTexto(texto, padroes) {
  if (texto == null) return texto;
  const original = String(texto);
  const lista = normalizarPadroes(padroes);
  const norm = normalizarTexto(original, { caixa: false });
  if (!norm) return original;
  const frases = dividirFrases(norm);
  let achou = false;
  const saida = [];
  for (const f of frases) {
    const ruim = lista.some((p) => p.re.test(f));
    if (ruim) {
      achou = true;
      if (saida[saida.length - 1] !== MARCADOR) saida.push(MARCADOR);
    } else saida.push(f);
  }
  return achou ? saida.join(' ') : original;
}

// Texto visível, não-clone, da página (versão final; se faltar, dom250, depois cru), já sanitizado. Um bloco por linha.
export function textoSeguroDaPagina(pagina, { versao = null } = {}) {
  const ordem = versao ? [versao] : ['final', 'dom250', 'cru'];
  let extr = null;
  for (const v of ordem) { if (pagina?.[v]?.extr) { extr = pagina[v].extr; break; } }
  if (!extr) return '';
  const partes = [];
  for (const n of extr.nos || []) {
    if (!n.visivel || n.clone) continue;
    const s = sanitizarTexto(n.texto);
    if (s) partes.push(s);
  }
  const junto = partes.join('\n');
  // Padrão partido entre dois blocos (ex.: <b> no meio da frase): confere o texto corrido e, se houver, achata e sanitiza tudo.
  if (detectarInjecao(junto.replace(/\n+/g, ' ')).length) return sanitizarTexto(junto.replace(/\n+/g, ' '));
  return junto;
}

// ---------------------------------------------------------------------------------------------------------
// medir
// ---------------------------------------------------------------------------------------------------------
const VERSOES = ['cru', 'dom250', 'final'];
const caminhoDe = (p) => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url || '/'; } };

function folhasJson(valor, caminho, saida) {
  if (typeof valor === 'string') { saida.push({ caminho, texto: valor }); return; }
  if (Array.isArray(valor)) { valor.forEach((v, i) => folhasJson(v, `${caminho}[${i}]`, saida)); return; }
  if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) folhasJson(v, caminho ? `${caminho}.${k}` : k, saida);
}

// Gera as fontes de texto de UMA versão de uma página: { onde, seletor, visivel, texto, campo? }.
function* fontesDaVersao(ex) {
  for (const n of ex.nos || []) yield { onde: n.visivel ? 'texto-visivel' : 'texto-oculto', seletor: n.seletor, visivel: !!n.visivel, texto: n.texto, clone: !!n.clone };
  if (ex.titulo) yield { onde: 'titulo', seletor: 'title', visivel: true, texto: ex.titulo };
  for (const c of ex.comentarios || []) yield { onde: 'comentario-html', seletor: '<!-- -->', visivel: false, texto: c };
  for (const a of ex.atributos || []) yield { onde: `atributo-${a.atributo}`, seletor: a.seletor, visivel: false, texto: a.valor };
  for (const m of ex.metas || []) {
    const nome = m.nome || m.propriedade || m.httpEquiv;
    if (m.conteudo && nome) yield { onde: `meta-${nome}`, seletor: `meta[${m.nome ? 'name' : m.propriedade ? 'property' : 'http-equiv'}="${nome}"]`, visivel: false, texto: m.conteudo };
  }
  for (const j of ex.jsonld || []) {
    let dados = null;
    try { dados = JSON.parse(j); } catch { /* JSON quebrado: varre o texto cru */ }
    const sel = 'script[type="application/ld+json"]';
    if (dados === null) { yield { onde: 'jsonld', seletor: sel, visivel: false, texto: j }; continue; }
    const folhas = [];
    folhasJson(dados, '', folhas);
    for (const f of folhas) yield { onde: 'jsonld', seletor: sel, visivel: false, texto: f.texto, campo: f.caminho };
  }
  for (const ns of ex.noscript || []) yield { onde: 'noscript', seletor: 'noscript', visivel: false, texto: ns };
}

async function lerLlmsTxt(ctx, buscar) {
  const url = `${ctx.site.origem}/llms.txt`;
  const base = { consultado: true, url, presente: false, status: null, bytes: 0, motivo: null };
  try {
    const r = await buscar(url, { permitidos: ctx.rede?.permitidos || [], permitirLocal: !!ctx.rede?.permitirLocal, maxBytes: 512 * 1024, timeoutMs: 8000 });
    base.status = r.status;
    if (r.status === 404 || r.status === 410) { base.motivo = 'ausente (404)'; return { info: base, texto: null }; }
    if (r.status !== 200) { base.motivo = `status ${r.status}`; return { info: base, texto: null }; }
    const mime = String(r.cabecalhos?.['content-type'] || '');
    const texto = r.texto();
    if (/html/i.test(mime) || /^\s*<(!doctype|html)/i.test(texto)) { base.motivo = 'resposta HTML (provável 404 disfarçado), tratado como ausente'; return { info: base, texto: null }; }
    base.presente = true;
    base.bytes = r.corpo ? r.corpo.length : texto.length;
    return { info: base, texto };
  } catch (e) {
    base.presente = null;
    base.motivo = `erro ao consultar: ${e.message}`;
    return { info: base, texto: null };
  }
}

export async function medir(ctx, opcoes = {}) {
  const buscar = opcoes.buscar || buscarSeguro;
  const achados = new Map();
  const registrar = (pagina, versao, f) => {
    const hits = detectarInjecao(f.texto);
    if (!hits.length) return;
    const trecho = hits[0].trecho;
    const chave = [pagina, f.onde, f.seletor || '', f.campo || '', trecho].join('\u0001');
    const ids = [...new Set(hits.flatMap((h) => h.padroesIds))];
    const ex = achados.get(chave);
    if (ex) { if (!ex.versoes.includes(versao)) ex.versoes.push(versao); return; }
    achados.set(chave, {
      onde: f.onde, pagina, versao, versoes: [versao], visivel: f.visivel, seletor: f.seletor || null, trecho,
      padraoId: hits[0].padraoId, padroesIds: ids, ocorrencias: hits.length, ...(f.campo ? { campo: f.campo } : {}),
      ...(f.clone ? { clone: true } : {}),
    });
  };

  for (const p of ctx.paginas || []) {
    const pagina = caminhoDe(p);
    for (const versao of VERSOES) {
      const ex = p[versao]?.extr;
      if (!ex) continue;
      for (const f of fontesDaVersao(ex)) registrar(pagina, versao, f);
    }
  }

  // llms.txt
  let llms = { consultado: false, url: null, presente: null, status: null, bytes: 0, motivo: 'não consultado', achados: 0 };
  if (opcoes.llms !== false && ctx.site?.origem) {
    const { info, texto } = await lerLlmsTxt(ctx, buscar);
    llms = { ...info, achados: 0 };
    if (texto != null) {
      // um achado por linha do arquivo com padrão (llms.txt costuma ter uma instrução por linha)
      for (const linha of texto.split(/\r?\n/)) if (linha.trim()) registrar('/llms.txt', 'arquivo', { onde: 'llms.txt', seletor: null, visivel: false, texto: linha });
    }
  }

  const finais = [...achados.values()];
  if (llms.consultado) llms.achados = finais.filter((a) => a.onde === 'llms.txt').length;

  const porOnde = {};
  const porPadrao = {};
  for (const a of finais) {
    porOnde[a.onde] = (porOnde[a.onde] || 0) + 1;
    porPadrao[a.padraoId] = (porPadrao[a.padraoId] || 0) + 1;
  }
  const dados = {
    achados: finais,
    total: finais.length,
    temInjecao: finais.length > 0,
    porOnde: Object.fromEntries(Object.entries(porOnde).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    porPadrao: Object.fromEntries(Object.entries(porPadrao).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    ocultos: finais.filter((a) => a.visivel === false).length,
    llmsTxt: llms,
    paginasAnalisadas: (ctx.paginas || []).length,
    versoesAnalisadas: VERSOES,
    padroes: { total: PADROES.lista.length, origem: PADROES.origem },
  };
  const evidencias = finais.map((a) => ({ pagina: a.pagina, versao: a.versao, seletor: a.seletor, trecho: a.trecho, valor: a.padraoId, contagem: a.ocorrencias, visivel: a.visivel }));
  return saidaMedidor(id, dados, evidencias, VERSAO);
}
