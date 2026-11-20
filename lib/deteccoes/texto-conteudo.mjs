// DETECTORES de texto genérico (regras/texto-generico.json) e de conteúdo e confiança (regras/conteudo-confianca.json).
//
// Contrato (lib/motor.mjs): cada detector recebe { ctx, med, regra } e devolve
//   null                                  = não avaliável (medidor ausente/com erro, amostra pequena demais, página não lida);
//                                           NUNCA significa "ok";
//   { disparou, intensidade 0..1, achados:[{ pagina, mensagem, evidencias, citacoes, numeros_permitidos? }] }.
//
// Princípios (SPEC §4 e DECISOES.md):
//   - o script mede, o modelo julga: aqui só há FATOS (trecho, contagem, limiar cruzado). Nenhuma mensagem afirma autoria
//     (nunca "escrito por IA"): o veredito é "genérico/batido";
//   - todo trecho citado existe num único nó de texto VISÍVEL e NÃO-clone do DOM final (é o que o verificador confere);
//   - texto oculto e clones de carrossel (aria-hidden) NUNCA entram em nenhuma contagem ou comparação;
//   - números calculados (densidade, proporções) vão em `numeros_permitidos`; mensagens não trazem números soltos.
//
// Fontes de dados: o medidor declarado na regra (texto, html, css) é exigido (ausente/erro => null) e usado quando já
// entrega o fato (densidade, especificidade, "não é X, é Y", tricolons, estilos de botão). Onde a regra pede algo que o
// medidor não entrega (alvos por posição, classes CSS, janelas de 120/150 caracteres, comparação entre páginas), o detector lê
// o próprio ctx: nós de texto do extrator + uma árvore do HTML final (parseHtml), ligada aos nós pelo seletor do extrator.
//
// Ressalvas conhecidas (documentadas por detector abaixo): o extrator não guarda classes CSS nem tamanho de fonte por nó;
// por isso "classe testimonial/stat/accordion" vem do HTML final e "fonte 1,5x maior" é aproximado por "nó com só um número".
import { carregarCliches, dividirFrases } from '../medidores/texto.mjs';
import { cnpjValido } from '../medidores/lei.mjs';
import { normalizarTexto, decodificarEntidades, extrairNumeros } from '../util.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// LIMIARES (os da regra quando ela traz número; "limiar inicial, a calibrar" nos demais)
// ---------------------------------------------------------------------------------------------------------------------
export const LIMIARES = {
  // txt-densidade-cliches: da regra (minimo_de_palavras 150, disparo 8, saturação 30)
  densidade: { minimoPalavras: 150, disparoAPartirDe: 8, intensidadeMaximaEm: 30 },
  // txt-lorem-ipsum: da regra (1 ocorrência, intensidade 1)
  lorem: { minimoOcorrencias: 1 },
  // txt-nomes-e-dados-de-exemplo: da regra (1 ocorrência; intensidade ocorrências/3)
  nomesExemplo: { minimoOcorrencias: 1, saturaEm: 3 },
  // txt-headline-vago: da regra (peso >= 3, h1 + até 40 palavras abaixo + 1º h2; intensidade ocorrências/2)
  headline: { pesoMinimoDaEntrada: 3, palavrasAbaixoDoH1: 40, saturaEm: 2 },
  // txt-ctas-genericos: da regra (mínimo de 1 CTA; 100% genéricos)
  ctas: { minimoDeCtas: 1 },
  // txt-especificidade-baixa: da regra (>= 20 frases; proporção mínima 0,10)
  especificidade: { minimoDeFrases: 20, proporcaoMinima: 0.1 },
  // txt-rebatida-nao-e-x-e-y: da regra (2 na página; satura em 4)
  rebatida: { minimoNaPagina: 2, saturaEm: 4 },
  // txt-frases-curtas-em-serie: da regra (2 na página; satura em 4)
  frasesCurtas: { minimoNaPagina: 2, saturaEm: 4 },
  // txt-travessao-densidade: da regra (150 palavras, 3 ocorrências, 3 por mil; satura em 10 por mil)
  travessao: { minimoPalavras: 150, minimoOcorrencias: 3, porMilMinimo: 3, saturaPorMilEm: 10 },
  // txt-exclamacoes-em-excesso: da regra (100 palavras; "!!" ou > 6 por mil; satura em 15). O piso de intensidade para
  // "!!" sem densidade alta é limiar inicial, a calibrar (a regra só dá a fórmula da densidade).
  exclamacoes: { minimoPalavras: 100, porMilMinimo: 6, saturaPorMilEm: 15, pisoDeExclamacaoDupla: 0.3 },
  // txt-abertura-batida: da regra (40 palavras abaixo do h1; satura em 2)
  abertura: { palavrasDoBloco: 40, saturaEm: 2 },
  // txt-fechamento-batido: da regra (satura em 2). Sem nenhuma <section>, usa os últimos N blocos de texto (limiar inicial).
  fechamento: { saturaEm: 2, blocosSemSecao: 4 },
  // txt-rotulo-ia-vazio: da regra (100 primeiras palavras; satura em 3)
  rotuloIa: { primeirasPalavras: 100, saturaEm: 3 },
  // txt-mesmo-fato-repetido: da regra (frase >= 6 palavras, 4 seções, eco 80%, satura em (seções-3)/4).
  // Eco só dispara sozinho com 4 seções (limiar inicial) e exige título com 3 palavras de conteúdo ou mais (limiar inicial).
  mesmoFato: { fraseMinimaEmPalavras: 6, disparoEmSecoes: 4, ecoDoTitulo: 0.8, ecoMinimoDeSecoes: 4, tituloMinimoEmPalavras: 3 },
  // cont-depoimento-sem-identificacao: da regra (2 sinais; mínimo de 2 depoimentos). Disparo com 1 bloco fraco (limiar inicial).
  depoimentos: { minimoDeDepoimentos: 2, sinaisParaIdentificar: 2, minimoDeBlocosFracos: 1 },
  // cont-prova-social-generica: da regra (janela de 150 caracteres; satura em 3)
  provaSocial: { janela: 150, saturaEm: 3, minimoDeLogosNaFaixa: 3 },
  // cont-numero-sem-contexto: sem limiar de disparo na regra; dispara com 1 número sem contexto (limiar inicial).
  // Número em destaque = nó só com número (>= 10 ou com %, +, k, mil) ou classe stat/counter/number/metric/numero/contador.
  numeroSemContexto: { minimoSemContexto: 1, palavrasDoRotulo: 6, valorMinimoSemSufixo: 10 },
  // cont-promessa-absoluta: da regra (1 ocorrência; satura em 3)
  promessa: { minimoOcorrencias: 1, saturaEm: 3 },
  // cont-cta-claro: da regra (ausente = 1, rótulo genérico = 0,5; "excesso" = 0,6 NÃO é medido: o medidor css só entrega
  // o total de botões e o primário). Rótulo curto = menos de 2 palavras.
  ctaClaro: { pesoAusente: 1, pesoRotuloGenerico: 0.5, minimoDePalavrasDoRotulo: 2 },
  // cont-preco-claro: da regra (120 caracteres; média das falhas)
  preco: { distanciaDaCondicao: 120 },
  // cont-faq: da regra (4 pares, 12 palavras; nenhuma = 1, poucos pares = 0,5, respostas curtas = 0,5)
  faq: { minimoDePares: 4, respostaMinimaEmPalavras: 12 },
  // cont-consistencia-precos-e-nomes: da regra (2 páginas, distância de edição até 2, nome até 80 caracteres do valor).
  // Intensidade = divergências/2 (limiar inicial).
  consistencia: { minimoDePaginas: 2, distanciaDeEdicaoDaMarca: 2, saturaEm: 2, palavrasDoNome: 4 },
  // cont-quem-esta-por-tras: da regra (2 dos 3 itens)
  quemEstaPorTras: { itensParaPassar: 2, totalDeItens: 3 },
};

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const soma = (a) => a.reduce((x, y) => x + y, 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (n) => String(r2(n)).replace('.', ',');
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(normalizarTexto(s)).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
const palavrasDe = (s) => String(s ?? '').split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
const unicos = (arr, chave) => { const v = new Set(); return arr.filter((x) => { const k = chave(x); if (v.has(k)) return false; v.add(k); return true; }); };
const corte = (s, max = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const i = c.lastIndexOf(' ');
  return (i > max * 0.6 ? c.slice(0, i) : c).trim();
};
// Trecho ao redor de uma ocorrência (sempre substring do texto original).
function janela(texto, ini, fim, raio = 35) {
  let a = Math.max(0, ini - raio);
  let b = Math.min(texto.length, fim + raio);
  if (a > 0 && texto[a - 1] !== ' ') { const i = texto.indexOf(' ', a); if (i >= 0 && i < ini) a = i + 1; }
  if (b < texto.length && texto[b] !== ' ') { const i = texto.lastIndexOf(' ', b); if (i > fim) b = i; }
  return texto.slice(a, b).trim();
}
// Expressão com "borda de palavra" que aceita acentos (o \b do JS não aceita).
const P = (src, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, flags);
const tagsDoSeletor = (sel) => String(sel || '').split('>').map((s) => (/^[a-z][a-z0-9-]*/.exec(s) || [null])[0]).filter(Boolean);
const paiDoSeletor = (sel) => { const i = String(sel).lastIndexOf('>'); return i < 0 ? '' : sel.slice(0, i); };
const ultimaTag = (sel) => { const t = tagsDoSeletor(sel); return t[t.length - 1] || ''; };
const ehTituloTag = (t) => /^h[1-6]$/.test(t);

const EXCLUIR_PROSA = new Set(['nav', 'footer', 'pre', 'code', 'blockquote', 'button', 'a', 'select', 'option', 'script', 'style', 'noscript', 'template', 'textarea', 'svg', 'label']);
const ehProsa = (n) => !tagsDoSeletor(n.seletor).some((t) => EXCLUIR_PROSA.has(t));

// ---------------------------------------------------------------------------------------------------------------------
// Árvore do HTML final (o extrator não guarda classes nem atributos; o HTML final é o outerHTML do mesmo DOM)
// ---------------------------------------------------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript']);
const RE_TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][^\s>\/]*)\s*>|<([a-zA-Z][^\s>\/]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|<|[^<]+/g;
const RE_ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

// Devolve { raiz, elementos, porSeletor } ; elemento = { tag, attrs, filhos:[elemento|{texto,raw?}], pai }.
export function parseHtml(html) {
  const raiz = { tag: '#raiz', attrs: {}, filhos: [], pai: null };
  const elementos = [];
  let atual = raiz;
  const re = new RegExp(RE_TOKEN.source, 'g');
  const src = String(html ?? '');
  let m;
  while ((m = re.exec(src))) {
    const [tok, fecha, abre, attrsTxt, autoFecha] = m;
    if (fecha) {
      const t = fecha.toLowerCase();
      let e = atual;
      while (e && e.tag !== t) e = e.pai;
      if (e && e.pai) atual = e.pai;
      continue;
    }
    if (abre) {
      const tag = abre.toLowerCase();
      const attrs = {};
      for (const a of (attrsTxt || '').matchAll(RE_ATTR)) attrs[a[1].toLowerCase()] = decodificarEntidades(a[2] ?? a[3] ?? a[4] ?? '');
      const el = { tag, attrs, filhos: [], pai: atual };
      atual.filhos.push(el);
      elementos.push(el);
      if (VOID.has(tag) || autoFecha) continue;
      if (RAW.has(tag)) {
        const fim = new RegExp(`</${tag}\\s*>`, 'ig');
        fim.lastIndex = re.lastIndex;
        const f = fim.exec(src);
        const corpo = src.slice(re.lastIndex, f ? f.index : src.length);
        if (corpo) el.filhos.push({ texto: corpo, raw: true });
        re.lastIndex = f ? f.index : src.length;
        atual = el;
        continue;
      }
      atual = el;
      continue;
    }
    if (tok.startsWith('<!')) continue;
    atual.filhos.push({ texto: decodificarEntidades(tok) });
  }
  const ids = new Map();
  for (const e of elementos) if (e.attrs.id) ids.set(e.attrs.id, (ids.get(e.attrs.id) || 0) + 1);
  const porSeletor = new Map();
  for (const e of elementos) {
    const s = seletorDe(e, ids);
    if (s && !porSeletor.has(s)) porSeletor.set(s, e);
  }
  return { raiz, elementos, porSeletor, ids };
}

// Mesmo algoritmo de seletorDe() do extrator (lib/extrator-dom.mjs): #id único, tag:nth-of-type(n), no máximo 8 níveis.
function seletorDe(el, ids) {
  if (el._sel !== undefined) return el._sel;
  const partes = [];
  let e = el;
  while (e && e.tag !== 'html' && e.tag !== '#raiz' && partes.length < 8) {
    if (e.attrs.id && /^[A-Za-z][\w-]*$/.test(e.attrs.id) && ids.get(e.attrs.id) === 1) { partes.unshift('#' + e.attrs.id); break; }
    let p = e.tag;
    if (e.pai) {
      const irm = e.pai.filhos.filter((x) => x.tag === e.tag);
      if (irm.length > 1) p += ':nth-of-type(' + (irm.indexOf(e) + 1) + ')';
    }
    partes.unshift(p);
    e = e.pai;
  }
  el._sel = partes.join('>');
  return el._sel;
}

const filhosEl = (el) => el.filhos.filter((f) => f.tag);
function textosDe(el) {
  const out = [];
  const rec = (e) => { for (const f of e.filhos) { if (f.tag) { if (!RAW.has(f.tag)) rec(f); } else if (!f.raw) { const t = f.texto.replace(/\s+/g, ' ').trim(); if (t) out.push(t); } } };
  rec(el);
  return out;
}
const textoDe = (el) => textosDe(el).join(' ');
function descendentes(el, pred) {
  const out = [];
  const rec = (e) => { for (const f of e.filhos) if (f.tag) { if (pred(f)) out.push(f); rec(f); } };
  rec(el);
  return out;
}
function* ancestrais(el) { let e = el.pai; while (e && e.tag !== '#raiz') { yield e; e = e.pai; } }
const estaDentro = (el, anc) => { for (const a of ancestrais(el)) if (a === anc) return true; return false; };
const classeDe = (el) => String(el.attrs.class || '');
const sobAncestral = (el, pred) => { if (pred(el)) return el; for (const a of ancestrais(el)) if (pred(a)) return a; return null; };

// ---------------------------------------------------------------------------------------------------------------------
// Páginas do ctx (versão final do DOM; só nós visíveis e não-clone)
// ---------------------------------------------------------------------------------------------------------------------
const CACHE_PAGINAS = new WeakMap();
function paginasDoCtx(ctx) {
  if (!ctx || !Array.isArray(ctx.paginas)) return [];
  if (CACHE_PAGINAS.has(ctx.paginas)) return CACHE_PAGINAS.get(ctx.paginas);
  const lista = ctx.paginas.filter((p) => p?.final?.extr).map((p) => {
    const extr = p.final.extr;
    const visiveis = (extr.nos || []).filter((n) => n.visivel && !n.clone && n.texto);
    return { p, url: p.url, caminho: caminhoDe(p.url), extr, html: p.final.html || '', visiveis, _arvore: null, _nos: null };
  });
  CACHE_PAGINAS.set(ctx.paginas, lista);
  return lista;
}
function arvore(pag) { return (pag._arvore ||= parseHtml(pag.html)); }
// nós visíveis ligados ao elemento da árvore (por seletor)
function nosComEl(pag) {
  if (!pag._nos) { const T = arvore(pag); pag._nos = pag.visiveis.map((n) => ({ ...n, el: T.porSeletor.get(n.seletor) || null })); }
  return pag._nos;
}
const nosSob = (pag, el) => nosComEl(pag).filter((n) => n.el && (n.el === el || estaDentro(n.el, el)));
function imagensPorSeletor(pag) { return new Map((pag.extr.imagens || []).map((i) => [i.seletor, i])); }

// ---------------------------------------------------------------------------------------------------------------------
// Lista de clichês (regras/texto/cliches-pt-br.json)
// ---------------------------------------------------------------------------------------------------------------------
let _lista = null;
const listaCliches = () => (_lista ||= carregarCliches());
const _compilados = new Map();
function compilar(chave, filtro) {
  if (_compilados.has(chave)) return _compilados.get(chave);
  const ativos = [];
  for (const c of listaCliches()) {
    if (!c || typeof c.padrao !== 'string' || !c.id || !filtro(c)) continue;
    const fonte = c.padrao.replace(/ {2,}/g, ' ').replace(/\s+$/, '');
    try { ativos.push({ id: c.id, tipo: c.tipo || 'sem-tipo', peso: Number.isFinite(c.peso) ? c.peso : 1, re: new RegExp(fonte, 'gi') }); } catch { /* padrão inválido: o medidor texto reporta */ }
  }
  _compilados.set(chave, ativos);
  return ativos;
}
const porIds = (ids) => compilar('ids:' + ids.join(','), (c) => ids.includes(c.id));
const porTipos = (tipos, pesoMin = 0, excluirIds = []) => compilar(`tipos:${tipos.join(',')}:${pesoMin}:${excluirIds.join(',')}`, (c) => tipos.includes(c.tipo) && (c.peso ?? 1) >= pesoMin && !excluirIds.includes(c.id));

// Acerta os padrões num texto (sem sobreposição: vence quem começa antes, depois o mais longo, depois o de maior peso).
function acharNoTexto(texto, ativos) {
  const todos = [];
  for (const a of ativos) {
    for (const m of texto.matchAll(a.re)) {
      if (!m[0]) continue;
      todos.push({ id: a.id, tipo: a.tipo, peso: a.peso, ini: m.index, fim: m.index + m[0].length, trecho: m[0].trim() });
    }
  }
  todos.sort((x, y) => x.ini - y.ini || y.fim - x.fim || y.peso - x.peso || cmp(x.id, y.id));
  const out = [];
  let limite = -1;
  for (const t of todos) { if (t.ini < limite) continue; out.push(t); limite = t.fim; }
  return out;
}
// Por frase: os padrões ancorados (^) da lista valem para o começo de cada frase, como no medidor.
function acharPorFrase(texto, ativos) {
  const out = [];
  for (const f of dividirFrases(texto)) for (const a of acharNoTexto(f, ativos)) out.push({ ...a, frase: f });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Construção de achados e citações
// ---------------------------------------------------------------------------------------------------------------------
const citT = (pag, valor) => ({ tipo: 'trecho', valor: String(valor), onde: 'visivel', versoes: ['final'], ...(pag?.url ? { pagina: pag.url } : {}) });
const evid = (pag, seletor, trecho, valor = null, contagem = null) => ({ pagina: pag.caminho, versao: 'final', seletor: seletor ?? undefined, trecho: corte(trecho, 200), ...(valor !== null ? { valor } : {}), ...(contagem !== null ? { contagem } : {}), visivel: true });

// Trecho de referência da página (título principal ou primeiro texto visível): usado quando o achado é uma AUSÊNCIA e o
// selo "opinião" exige ao menos um trecho que exista no site.
function refTrecho(pag) {
  const v = pag.visiveis;
  const n = v.find((x) => ultimaTag(x.seletor) === 'h1') || v.find((x) => palavrasDe(x.texto).length >= 3) || v[0];
  return n ? corte(n.texto, 80) : null;
}
function ach(pag, mensagem, { cit = [], ev = [], numeros = [], ref = true } = {}) {
  const citacoes = [...cit];
  if (ref && !citacoes.some((c) => c.tipo === 'trecho')) { const r = refTrecho(pag); if (r) citacoes.push(citT(pag, r)); }
  return { pagina: pag.caminho, mensagem, evidencias: ev, citacoes, numeros_permitidos: numeros.map(String) };
}
const res = (disparou, intensidade, achados = []) => (disparou ? { disparou: true, intensidade: clamp01(intensidade), achados } : { disparou: false, intensidade: 0, achados: [] });
const lista = (itens, max = 4) => itens.slice(0, max).map((t) => `«${corte(t, 70)}»`).join(', ');

// Envoltório: exige o medidor declarado na regra (ausente/erro => null) e ao menos uma página lida.
function detector(medidor, fn) {
  return (args) => {
    const m = args?.med?.[medidor];
    if (!m || m.erro || !m.dados) return null;
    const pags = paginasDoCtx(args.ctx);
    if (!pags.length) return null;
    return fn({ ...args, dados: m.dados, pags });
  };
}
const pagPorCaminho = (pags, caminho) => pags.find((p) => p.caminho === caminho) || null;
const agrupar = (itens, chave) => { const m = new Map(); for (const x of itens) { const k = chave(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };

// Bloco de texto "abaixo do h1" (até N palavras), sem links, botões, navegação e rodapé; para no próximo título.
function abaixoDoH1(pag, maxPalavras) {
  const h1 = (pag.extr.headings || []).find((h) => h.nivel === 1 && h.visivel && !h.clone);
  if (!h1) return null;
  const v = pag.visiveis;
  const dentro = (n) => n.seletor === h1.seletor || n.seletor.startsWith(h1.seletor + '>');
  let i = v.findIndex(dentro);
  if (i < 0) i = v.findIndex((n) => norm(n.texto) === norm(h1.texto));
  if (i < 0) return null;
  while (i < v.length && dentro(v[i])) i++;
  const out = [];
  let pal = 0;
  for (; i < v.length && pal < maxPalavras; i++) {
    const n = v[i];
    const tags = tagsDoSeletor(n.seletor);
    if (ehTituloTag(tags[tags.length - 1])) break;
    if (tags.some((t) => ['a', 'button', 'nav', 'footer'].includes(t))) continue;
    const toks = n.texto.split(/\s+/).filter(Boolean);
    const pega = toks.slice(0, maxPalavras - pal);
    pal += pega.length;
    out.push({ no: n, texto: pega.join(' ') });
  }
  return { h1, nos: out };
}
const nosDoElemento = (v, seletor) => v.filter((n) => n.seletor === seletor || n.seletor.startsWith(seletor + '>'));

// Chave da "seção" de um nó: caminho até o último <section> do seletor (ou null).
function chaveDeSecao(seletor) {
  const segs = String(seletor).split('>');
  let idx = -1;
  segs.forEach((s, i) => { if (/^section(:|$)/.test(s)) idx = i; });
  return idx < 0 ? null : segs.slice(0, idx + 1).join('>');
}

// ---------------------------------------------------------------------------------------------------------------------
// ===================================== TEXTO GENÉRICO =====================================
// ---------------------------------------------------------------------------------------------------------------------

// txt-densidade-cliches ------------------------------------------------------------------------------------------------
// Usa a densidade do medidor texto (peso dos clichês / palavras x 1000) sobre as páginas com amostra suficiente.
// Páginas curtas (< 150 palavras) não entram; se nenhuma entra, a regra é "não avaliada".
const densidadeDeCliches = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.densidade;
  const paginas = (dados.paginas || []).filter((p) => p.cliches && p.palavras >= L.minimoPalavras);
  if (!paginas.length) return null;
  const palavras = soma(paginas.map((p) => p.palavras));
  const peso = soma(paginas.map((p) => p.cliches.pesoTotal));
  const indice = r2((peso / palavras) * 1000);
  if (indice < L.disparoAPartirDe) return res(false, 0);
  const intensidade = (indice - L.disparoAPartirDe) / (L.intensidadeMaximaEm - L.disparoAPartirDe);
  const ocorrencias = dados.cliches?.ocorrencias || [];
  const achados = [];
  for (const p of paginas.filter((x) => x.cliches.indicePonderado >= L.disparoAPartirDe)) {
    const pag = pagPorCaminho(pags, p.pagina) || { caminho: p.pagina, url: null, visiveis: [] };
    const oc = ocorrencias.filter((o) => o.pagina === p.pagina).sort((a, b) => b.peso - a.peso || cmp(a.trecho, b.trecho));
    const ex = unicos(oc, (o) => o.id).slice(0, 4);
    achados.push(ach(pag,
      `Muitas expressões batidas para o tamanho do texto: ${fmt(p.cliches.indicePonderado)} pontos de clichê a cada mil palavras (o alerta começa em ${L.disparoAPartirDe}). Exemplos: ${lista(ex.map((o) => o.trecho))}.`,
      { cit: ex.map((o) => citT(pag, o.trecho)), ev: ex.map((o) => evid(pag, o.seletor, o.trecho, `cliche:${o.id}`)), numeros: [p.cliches.indicePonderado, indice] }));
  }
  return res(true, intensidade, achados);
});

// txt-lorem-ipsum ------------------------------------------------------------------------------------------------------
// Procura os três padrões da regra em TODO texto visível e não-clone (inclusive rodapé e botões) e registra se o trecho
// também existe no HTML cru.
const RE_LOREM = /lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing/i;
const loremIpsum = detector('texto', ({ pags }) => {
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const hits = pag.visiveis.map((n) => ({ n, m: RE_LOREM.exec(n.texto) })).filter((x) => x.m);
    if (!hits.length) continue;
    total += hits.length;
    const cruNorm = normalizarTexto(pag.p.cru?.html || '');
    const cit = [];
    const ev = [];
    let noCru = 0;
    for (const { n, m } of hits.slice(0, 3)) {
      const t = corte(n.texto.slice(m.index), 80);
      cit.push(citT(pag, t));
      ev.push(evid(pag, n.seletor, t, 'lorem-ipsum'));
      if (cruNorm.includes(normalizarTexto(m[0]))) { noCru++; cit.push({ tipo: 'trecho', valor: m[0], onde: 'html', versoes: ['cru'], pagina: pag.url }); }
    }
    achados.push(ach(pag, `Texto de enchimento (lorem ipsum) à mostra no texto visível: ${lista(hits.slice(0, 3).map((h) => corte(h.n.texto.slice(h.m.index), 50)))}. ${noCru ? 'O mesmo trecho já está no HTML cru, antes de qualquer script rodar.' : 'No HTML cru o trecho não aparece: ele surge depois que os scripts rodam.'}`, { cit, ev }));
  }
  return total >= LIMIARES.lorem.minimoOcorrencias ? res(true, 1, achados) : res(false, 0);
});

// txt-nomes-e-dados-de-exemplo -----------------------------------------------------------------------------------------
const nomesEDadosDeExemplo = detector('texto', ({ pags }) => {
  const ativos = porIds(['vago-nomes-de-exemplo', 'vago-dados-falsos']);
  if (!ativos.length) return null;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const hits = unicos(pag.visiveis.flatMap((n) => acharPorFrase(n.texto, ativos).map((a) => ({ ...a, seletor: n.seletor }))), (h) => h.seletor + '|' + h.trecho);
    if (!hits.length) continue;
    total += hits.length;
    achados.push(ach(pag, `Nome ou dado de exemplo no texto visível: ${lista(hits.map((h) => h.trecho), 5)}.`,
      { cit: hits.slice(0, 5).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 5).map((h) => evid(pag, h.seletor, h.trecho, `cliche:${h.id}`)) }));
  }
  const L = LIMIARES.nomesExemplo;
  return total >= L.minimoOcorrencias ? res(true, Math.min(1, total / L.saturaEm), achados) : res(false, 0);
});

// txt-headline-vago ----------------------------------------------------------------------------------------------------
// Entradas hype/vago de peso >= 3 aplicadas ao 1º h1, ao texto logo abaixo dele (até 40 palavras) e ao 1º h2.
// As duas entradas de "dados de exemplo" ficam de fora (têm regra própria).
const headlineVago = detector('texto', ({ pags }) => {
  const L = LIMIARES.headline;
  const ativos = porTipos(['hype', 'vago'], L.pesoMinimoDaEntrada, ['vago-nomes-de-exemplo', 'vago-dados-falsos', 'vago-lorem-ipsum']);
  if (!ativos.length) return null;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const alvos = [];
    const h1 = (pag.extr.headings || []).find((h) => h.nivel === 1 && h.visivel && !h.clone);
    if (h1) for (const n of nosDoElemento(pag.visiveis, h1.seletor)) alvos.push({ onde: 'título principal (h1)', n, texto: n.texto });
    const ab = abaixoDoH1(pag, L.palavrasAbaixoDoH1);
    if (ab) for (const x of ab.nos) alvos.push({ onde: 'texto logo abaixo do título', n: x.no, texto: x.texto });
    const h2 = (pag.extr.headings || []).find((h) => h.nivel === 2 && h.visivel && !h.clone);
    if (h2) for (const n of nosDoElemento(pag.visiveis, h2.seletor)) alvos.push({ onde: 'primeiro subtítulo (h2)', n, texto: n.texto });
    const hits = unicos(alvos.flatMap((a) => acharPorFrase(a.texto, ativos).map((h) => ({ ...h, onde: a.onde, seletor: a.n.seletor }))), (h) => h.seletor + '|' + h.trecho);
    if (!hits.length) continue;
    total += hits.length;
    achados.push(ach(pag, `Expressão batida no começo da página: ${hits.slice(0, 4).map((h) => `«${corte(h.trecho, 70)}» (${h.onde})`).join('; ')}.`,
      { cit: hits.slice(0, 4).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 4).map((h) => evid(pag, h.seletor, h.trecho, `cliche:${h.id}`)) }));
  }
  return total >= 1 ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// txt-ctas-genericos ---------------------------------------------------------------------------------------------------
// CTAs = <button>, [role=button], <a> com "btn"/"cta"/"button" na classe (a classe vem do HTML final). <input type=submit> fica
// de fora: o texto está no atributo value, que não é nó de texto citável. Dispara com 100% dos CTAs do site na lista.
const RE_CLASSE_CTA = /btn|cta|button/i;
function ctasDaPagina(pag) {
  const ehCta = (e) => e.tag === 'button' || e.attrs.role === 'button' || (e.tag === 'a' && RE_CLASSE_CTA.test(classeDe(e)));
  const mapa = new Map();
  for (const n of nosComEl(pag)) {
    if (!n.el) continue;
    const alvo = sobAncestral(n.el, ehCta);
    if (alvo) mapa.set(alvo, [...(mapa.get(alvo) || []), n]);
  }
  return [...mapa.values()].map((nos) => ({ texto: nos.map((n) => n.texto).join(' ').replace(/\s+/g, ' ').trim(), nos })).filter((c) => norm(c.texto));
}
const ctasGenericos = detector('texto', ({ pags }) => {
  const ativos = porTipos(['cta-generico']);
  if (!ativos.length) return null;
  const todos = pags.flatMap((pag) => ctasDaPagina(pag).map((c) => ({ pag, ...c, generico: ativos.some((a) => c.texto.search(a.re) >= 0) })));
  if (todos.length < LIMIARES.ctas.minimoDeCtas) return null;
  if (!todos.every((c) => c.generico)) return res(false, 0);
  const achados = [];
  for (const [, grupo] of agrupar(todos, (c) => c.pag)) {
    const pag = grupo[0].pag;
    const textos = unicos(grupo, (c) => norm(c.texto));
    const citaveis = textos.map((c) => { const maior = [...c.nos].sort((a, b) => b.texto.length - a.texto.length)[0]; return { c, no: maior }; });
    achados.push(ach(pag, `Todos os botões de chamada da página usam rótulos genéricos: ${lista(textos.map((c) => c.texto), 5)}.`,
      { cit: citaveis.slice(0, 5).map((x) => citT(pag, x.no.texto)), ev: citaveis.slice(0, 5).map((x) => evid(pag, x.no.seletor, x.c.texto, 'cta-generico')) }));
  }
  return res(true, 1, achados);
});

// txt-especificidade-baixa ---------------------------------------------------------------------------------------------
const especificidadeBaixa = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.especificidade;
  const t = dados.total;
  if (!t || t.frases < L.minimoDeFrases) return null;
  const prop = t.especificidade.fracao;
  if (prop >= L.proporcaoMinima) return res(false, 0);
  const intensidade = Math.max(0, 1 - prop / L.proporcaoMinima);
  const pag = pags[0];
  // exemplos: frases escolhidas para o teste da troca que o medidor marcou como "sem número, nome próprio, unidade ou data"
  const exemplos = (dados.fraseParaTesteDaTroca || []).filter((f) => /sem n[uú]mero/.test(f.motivo || '')).slice(0, 2);
  const citacoes = exemplos.map((f) => citT(pagPorCaminho(pags, f.pagina) || pag, f.frase));
  const pct = Math.round(prop * 1000) / 10;
  return res(true, intensidade, [ach(pag,
    `Poucas frases do texto trazem número, nome próprio, unidade ou data: ${t.especificidade.frasesEspecificas} de ${t.frases} frases (${fmt(pct)}%; o alerta é abaixo de 10%).${exemplos.length ? ` Exemplos de frases sem nenhum desses dados: ${lista(exemplos.map((f) => f.frase), 2)}.` : ''}`,
    { cit: citacoes, ev: exemplos.map((f) => evid(pagPorCaminho(pags, f.pagina) || pag, f.seletor, f.frase, 'sem-especificidade')), numeros: [t.especificidade.frasesEspecificas, t.frases, pct] })]);
});

// txt-rebatida-nao-e-x-e-y ---------------------------------------------------------------------------------------------
const rebatidaNaoEXEY = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.rebatida;
  const por = agrupar(dados.estruturas?.naoEXEY || [], (e) => e.pagina);
  const achados = [];
  let total = 0;
  for (const [caminho, itens] of por) {
    if (itens.length < L.minimoNaPagina) continue;
    const pag = pagPorCaminho(pags, caminho);
    if (!pag) continue;
    total += itens.length;
    achados.push(ach(pag, `O molde «não é X, é Y» se repete no texto da página: ${lista(itens.map((i) => i.trecho), 4)}.`,
      { cit: itens.slice(0, 4).map((i) => citT(pag, i.trecho)), ev: itens.slice(0, 4).map((i) => evid(pag, i.seletor, i.trecho, `estrutura:${i.tipo}`)), numeros: [itens.length] }));
  }
  if (!pags.length) return null;
  return total ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// txt-frases-curtas-em-serie -------------------------------------------------------------------------------------------
// (a) 3 frases de até 3 palavras seguidas, pelo padrão estr-tres-fragmentos da lista, no texto de prosa de um mesmo nó;
// (b) listas de 3 itens de até 2 palavras (tricolons do medidor) dentro de h1 ou h2.
const fraseCurtasEmSerie = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.frasesCurtas;
  const ativos = porIds(['estr-tres-fragmentos']);
  if (!ativos.length) return null;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const hits = [];
    for (const n of pag.visiveis.filter(ehProsa)) {
      for (const m of n.texto.matchAll(ativos[0].re)) {
        const t = m[0].replace(/^[.!?]\s+/, '').trim();
        if (t) hits.push({ n, trecho: t, tipo: 'tres-frases-curtas' });
      }
    }
    for (const t of dados.estruturas?.tricolons || []) {
      if (t.pagina !== pag.caminho) continue;
      if (!tagsDoSeletor(t.seletor).some((x) => x === 'h1' || x === 'h2')) continue;
      hits.push({ n: { seletor: t.seletor }, trecho: t.trecho, tipo: 'tres-itens-em-titulo' });
    }
    if (hits.length < L.minimoNaPagina) continue;
    total += hits.length;
    achados.push(ach(pag, `Séries de frases ou itens muito curtos se repetem na página: ${lista(hits.map((h) => h.trecho), 4)}.`,
      { cit: hits.slice(0, 4).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 4).map((h) => evid(pag, h.n.seletor, h.trecho, h.tipo)), numeros: [hits.length] }));
  }
  return total ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// txt-travessao-densidade ----------------------------------------------------------------------------------------------
// Conta "—" e " – " (travessão com espaços) nos nós de prosa (mesma exclusão do medidor texto: nav, rodapé, botões, links,
// código, citação); faixas como "R$ 10 – R$ 20" e "2019 – 2024" não contam. Denominador = palavras da prosa (medidor texto).
const RE_TRAVESSAO = /—|(?<=\s)–(?=\s)/g;
const RE_FAIXA = /[\d$]\s*[—–]\s*(?:R\$\s*)?\d/;
function travessoesDaPagina(pag) {
  const out = [];
  for (const n of pag.visiveis.filter(ehProsa)) {
    for (const m of n.texto.matchAll(RE_TRAVESSAO)) {
      if (RE_FAIXA.test(n.texto.slice(Math.max(0, m.index - 3), m.index + 8))) continue;
      out.push({ n, trecho: janela(n.texto, m.index, m.index + 1, 25) });
    }
  }
  return out;
}
const travessaoDensidade = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.travessao;
  const palavras = dados.total?.palavras ?? 0;
  if (palavras < L.minimoPalavras) return null;
  const hits = pags.flatMap((pag) => travessoesDaPagina(pag).map((h) => ({ ...h, pag })));
  const porMil = r2((hits.length / palavras) * 1000);
  if (hits.length < L.minimoOcorrencias || porMil < L.porMilMinimo) return res(false, 0);
  const intensidade = (porMil - L.porMilMinimo) / (L.saturaPorMilEm - L.porMilMinimo);
  const pag = [...agrupar(hits, (h) => h.pag)].sort((a, b) => b[1].length - a[1].length)[0][0];
  const dessa = hits.filter((h) => h.pag === pag).slice(0, 3);
  return res(true, intensidade, [ach(pag,
    `Travessões em quantidade acima do normal: ${hits.length} no texto, ${fmt(porMil)} a cada mil palavras (o alerta começa em 3). Exemplos: ${lista(dessa.map((h) => h.trecho), 3)}.`,
    { cit: dessa.map((h) => citT(pag, h.trecho)), ev: dessa.map((h) => evid(pag, h.n.seletor, h.trecho, 'travessao')), numeros: [hits.length, porMil] })]);
});

// txt-exclamacoes-em-excesso -------------------------------------------------------------------------------------------
// "!!" (ou "! !") em qualquer texto visível, fora de código; ou densidade de exclamações da prosa > 6 por mil palavras.
const RE_EXCL_DUPLA = /!\s?!/;
const exclamacoesEmExcesso = detector('texto', ({ dados, pags }) => {
  const L = LIMIARES.exclamacoes;
  const palavras = dados.total?.palavras ?? 0;
  const ex = dados.total?.exclamacoes || { quantidade: 0, porMil: 0 };
  const duplas = [];
  for (const pag of pags) for (const n of pag.visiveis) {
    if (tagsDoSeletor(n.seletor).some((t) => t === 'pre' || t === 'code')) continue;
    const m = RE_EXCL_DUPLA.exec(n.texto);
    if (m) duplas.push({ pag, n, trecho: janela(n.texto, m.index, m.index + m[0].length, 30) });
  }
  const densa = palavras >= L.minimoPalavras && ex.porMil > L.porMilMinimo;
  if (!duplas.length && palavras < L.minimoPalavras) return null;
  if (!duplas.length && !densa) return res(false, 0);
  const intensidade = Math.max(clamp01(ex.porMil / L.saturaPorMilEm), duplas.length ? L.pisoDeExclamacaoDupla : 0);
  const pag = duplas[0]?.pag || pags[0];
  const exemplos = duplas.slice(0, 3);
  const partes = [];
  if (duplas.length) partes.push(`há exclamações seguidas: ${lista(exemplos.map((d) => d.trecho), 3)}`);
  if (densa) partes.push(`são ${ex.quantidade} exclamações, ${fmt(ex.porMil)} a cada mil palavras (o alerta é acima de 6)`);
  return res(true, intensidade, [ach(pag, `Pontos de exclamação em excesso: ${partes.join('; ')}.`,
    { cit: exemplos.map((d) => citT(d.pag, d.trecho)), ev: exemplos.map((d) => evid(d.pag, d.n.seletor, d.trecho, 'exclamacao-dupla')), numeros: [ex.quantidade, ex.porMil] })]);
});

// txt-abertura-batida --------------------------------------------------------------------------------------------------
// Entradas "abertura-batida" nas 40 primeiras palavras abaixo do h1 e no 1º parágrafo da seção Sobre / Quem somos.
const RE_SOBRE_TITULO = /sobre|quem\s+somos|nossa\s+hist[oó]ria/i;
function primeiroParagrafoDeSobre(pag) {
  const h = (pag.extr.headings || []).find((x) => x.visivel && !x.clone && RE_SOBRE_TITULO.test(x.texto) && x.nivel > 0);
  if (!h) return null;
  const v = pag.visiveis;
  const dentro = (n) => n.seletor === h.seletor || n.seletor.startsWith(h.seletor + '>');
  let i = v.findIndex(dentro);
  if (i < 0) return null;
  while (i < v.length && dentro(v[i])) i++;
  for (; i < v.length; i++) {
    const tags = tagsDoSeletor(v[i].seletor);
    if (ehTituloTag(tags[tags.length - 1])) return null;
    if (tags.some((t) => ['a', 'button', 'nav', 'footer'].includes(t))) continue;
    if (palavrasDe(v[i].texto).length >= 4) return v[i];
  }
  return null;
}
const aberturaBatida = detector('texto', ({ pags }) => {
  const L = LIMIARES.abertura;
  const ativos = porTipos(['abertura-batida']);
  if (!ativos.length) return null;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const alvos = [];
    const ab = abaixoDoH1(pag, L.palavrasDoBloco);
    if (ab) for (const x of ab.nos) alvos.push({ onde: 'começo do texto abaixo do título', n: x.no, texto: x.texto });
    const sobre = primeiroParagrafoDeSobre(pag);
    if (sobre) alvos.push({ onde: 'primeiro parágrafo da seção Sobre', n: sobre, texto: sobre.texto });
    const hits = unicos(alvos.flatMap((a) => acharPorFrase(a.texto, ativos).map((h) => ({ ...h, onde: a.onde, seletor: a.n.seletor }))), (h) => h.seletor + '|' + h.trecho);
    if (!hits.length) continue;
    total += hits.length;
    achados.push(ach(pag, `Abertura com fórmula batida: ${hits.slice(0, 3).map((h) => `«${corte(h.trecho, 70)}» (${h.onde})`).join('; ')}.`,
      { cit: hits.slice(0, 3).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 3).map((h) => evid(pag, h.seletor, h.trecho, `cliche:${h.id}`)) }));
  }
  return total ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// txt-fechamento-batido ------------------------------------------------------------------------------------------------
// Entradas "fechamento-batido" na última <section> antes do rodapé (sem <section>: últimos blocos de texto de prosa).
function ultimaSecao(pag) {
  const candidatos = pag.visiveis.filter((n) => !tagsDoSeletor(n.seletor).some((t) => t === 'footer' || t === 'nav'));
  for (let i = candidatos.length - 1; i >= 0; i--) {
    const k = chaveDeSecao(candidatos[i].seletor);
    if (k) return { nos: candidatos.filter((n) => chaveDeSecao(n.seletor) === k), tipo: 'última seção da página' };
  }
  const prosa = candidatos.filter(ehProsa);
  return prosa.length ? { nos: prosa.slice(-LIMIARES.fechamento.blocosSemSecao), tipo: 'últimos blocos de texto da página' } : null;
}
const fechamentoBatido = detector('texto', ({ pags }) => {
  const ativos = porTipos(['fechamento-batido']);
  if (!ativos.length) return null;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const alvo = ultimaSecao(pag);
    if (!alvo) continue;
    const hits = unicos(alvo.nos.flatMap((n) => acharPorFrase(n.texto, ativos).map((h) => ({ ...h, seletor: n.seletor }))), (h) => h.seletor + '|' + h.trecho);
    if (!hits.length) continue;
    total += hits.length;
    achados.push(ach(pag, `Fechamento com fórmula batida na ${alvo.tipo}: ${lista(hits.map((h) => h.trecho), 3)}.`,
      { cit: hits.slice(0, 3).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 3).map((h) => evid(pag, h.seletor, h.trecho, `cliche:${h.id}`)) }));
  }
  return total ? res(true, total / LIMIARES.fechamento.saturaEm, achados) : res(false, 0);
});

// txt-rotulo-ia-vazio --------------------------------------------------------------------------------------------------
// h1 a h3, botões, links e as primeiras 100 palavras: "com IA", "impulsionado por IA", "AI-powered", nomes de modelos/empresas
// de IA e botões só com "IA".
const PADROES_IA = [
  P('(?:com|via|usando)\\s+(?:ia|intelig[eê]ncia\\s+artificial)'),
  P('gpt|chatgpt|claude|anthropic|openai|gemini|copilot|llm'),
  /^\s*(?:ia|ai)\s*$/i,
];
const rotuloIaVazio = detector('texto', ({ pags }) => {
  const ativos = porIds(['hype-poder-da-ia']);
  const L = LIMIARES.rotuloIa;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    let acum = 0;
    const hits = [];
    for (const n of pag.visiveis) {
      const tags = tagsDoSeletor(n.seletor);
      const nosAlvos = tags.some((t) => ['h1', 'h2', 'h3', 'button', 'a'].includes(t));
      const nasPrimeiras = acum < L.primeirasPalavras;
      acum += palavrasDe(n.texto).length;
      if (!nosAlvos && !nasPrimeiras) continue;
      for (const a of acharNoTexto(n.texto, ativos)) hits.push({ n, trecho: a.trecho });
      for (const re of PADROES_IA) {
        const m = re.exec(n.texto);
        if (m) hits.push({ n, trecho: m[0].trim() });
      }
    }
    const u = unicos(hits, (h) => h.n.seletor + '|' + norm(h.trecho));
    if (!u.length) continue;
    total += u.length;
    achados.push(ach(pag, `Recurso apresentado pelo rótulo de IA, não pelo benefício: ${lista(u.map((h) => h.trecho), 4)}.`,
      { cit: u.slice(0, 4).map((h) => citT(pag, h.trecho)), ev: u.slice(0, 4).map((h) => evid(pag, h.n.seletor, h.trecho, 'rotulo-ia')) }));
  }
  return total ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// txt-mesmo-fato-repetido (misto) --------------------------------------------------------------------------------------
// Seção = <section> (do seletor) ou, sem section, o grupo de blocos sob um h2. Conta em quantas seções a mesma frase
// (>= 6 palavras, normalizada) ou o mesmo par número+unidade aparece; compara o título com o último parágrafo da seção.
const UNIDADES_PAR = 'anos?|dias?|horas?|meses|m[eê]s|clientes?|projetos?|pessoas?|empresas?|usu[aá]rios?|alunos?|lojas?|vendas?|pedidos?|entregas?|pa[ií]ses|cidades?|produtos?|contratos?|casos?|atendimentos?|parceiros?|colaboradores?|funcion[aá]rios?|seguidores?|unidades?|itens?|sites?|membros?|pacientes?|cursos?|aulas?|kg|km|m²|reais';
const RE_PAR_NUM = new RegExp(`(?<![\\p{L}\\p{N}])(?:R\\$\\s?\\d[\\d.,]*|\\d[\\d.,]*\\+?\\s?(?:%|(?:${UNIDADES_PAR})(?![\\p{L}\\p{N}])))`, 'giu');
const STOP_ECO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'um', 'uma', 'que', 'ao', 'aos', 'seu', 'sua', 'nosso', 'nossa']);
function secoesDaPagina(pag) {
  const secoes = new Map();
  let h2 = 0;
  for (const n of pag.visiveis) {
    const tags = tagsDoSeletor(n.seletor);
    if (tags.some((t) => ['nav', 'footer', 'pre', 'code'].includes(t))) continue;
    if (ultimaTag(n.seletor) === 'h2') h2++;
    const k = chaveDeSecao(n.seletor) || `grupo-h2-${h2}`;
    (secoes.get(k) || secoes.set(k, []).get(k)).push(n);
  }
  return secoes;
}
const mesmoFatoRepetido = detector('texto', ({ pags }) => {
  const L = LIMIARES.mesmoFato;
  const achados = [];
  let maxSecoes = 0;
  let ecoTotal = 0;
  for (const pag of pags) {
    const secoes = secoesDaPagina(pag);
    if (secoes.size < 2) continue;
    const fatos = new Map(); // chave normalizada -> { exemplo, secoes:Set, nos:[] }
    for (const [sk, nos] of secoes) {
      for (const n of nos) {
        const ehTit = ehTituloTag(ultimaTag(n.seletor));
        const itens = [];
        if (!ehTit) for (const f of dividirFrases(n.texto)) if (palavrasDe(f).length >= L.fraseMinimaEmPalavras) itens.push({ chave: 'f:' + norm(f), exemplo: f });
        for (const m of n.texto.matchAll(RE_PAR_NUM)) itens.push({ chave: 'n:' + norm(m[0]).replace(/\s+/g, ''), exemplo: m[0].trim() });
        for (const it of itens) {
          const x = fatos.get(it.chave) || { exemplo: it.exemplo, secoes: new Set(), nos: [] };
          x.secoes.add(sk);
          if (x.nos.length < 3 && !x.nos.some((o) => o.seletor === n.seletor)) x.nos.push(n);
          fatos.set(it.chave, x);
        }
      }
    }
    const repetidos = [...fatos.values()].filter((x) => x.secoes.size >= L.disparoEmSecoes).sort((a, b) => b.secoes.size - a.secoes.size || cmp(a.exemplo, b.exemplo));
    for (const x of repetidos.slice(0, 3)) {
      maxSecoes = Math.max(maxSecoes, x.secoes.size);
      achados.push(ach(pag, `O mesmo trecho aparece em ${x.secoes.size} seções da página: «${corte(x.exemplo, 90)}». Falta confirmar se é o mesmo fato repetido ou coincidência.`,
        { cit: [citT(pag, x.exemplo)], ev: x.nos.slice(0, 3).map((n) => evid(pag, n.seletor, x.exemplo, 'fato-repetido', x.secoes.size)), numeros: [x.secoes.size] }));
    }
    // eco: título da seção x último parágrafo
    const ecos = [];
    for (const [, nos] of secoes) {
      const titulo = nos.find((n) => ehTituloTag(ultimaTag(n.seletor)));
      const paragrafos = nos.filter((n) => ultimaTag(n.seletor) === 'p');
      const ultimo = paragrafos[paragrafos.length - 1];
      if (!titulo || !ultimo) continue;
      const tw = [...new Set(norm(titulo.texto).split(' ').filter((w) => w.length >= 3 && !STOP_ECO.has(w)))];
      if (tw.length < L.tituloMinimoEmPalavras) continue;
      const pw = new Set(norm(ultimo.texto).split(' '));
      if (tw.filter((w) => pw.has(w)).length / tw.length >= L.ecoDoTitulo) ecos.push({ titulo, ultimo });
    }
    if (ecos.length >= L.ecoMinimoDeSecoes) {
      ecoTotal += ecos.length;
      achados.push(ach(pag, `O último parágrafo de ${ecos.length} seções repete quase todas as palavras do título da própria seção. Exemplo: «${corte(ecos[0].titulo.texto, 70)}». Falta confirmar se há informação nova nesses parágrafos.`,
        { cit: [citT(pag, ecos[0].titulo.texto), citT(pag, corte(ecos[0].ultimo.texto, 90))], ev: ecos.slice(0, 3).map((e) => evid(pag, e.titulo.seletor, e.titulo.texto, 'eco-do-titulo')), numeros: [ecos.length] }));
    }
  }
  if (!achados.length) return res(false, 0);
  const intensidade = maxSecoes >= L.disparoEmSecoes ? (maxSecoes - (L.disparoEmSecoes - 1)) / 4 : 0.25;
  return res(true, intensidade, achados);
});

// ---------------------------------------------------------------------------------------------------------------------
// ===================================== CONTEÚDO E CONFIANÇA =====================================
// ---------------------------------------------------------------------------------------------------------------------

// cont-depoimento-sem-identificacao ------------------------------------------------------------------------------------
// Blocos candidatos: <blockquote>, <figure> com <figcaption> e elementos cuja classe COMEÇA uma palavra com
// testimonial|depoimento|review|avaliac (assim "preview" não conta; a regra usa [class*=] puro). Se um candidato contém
// 2+ outros candidatos é só um contêiner e vale o item de dentro. Sinais: nome (2 palavras com inicial maiúscula), foto
// (img visível, não decorativa, não placeholder), cargo/empresa/cidade e link/fonte.
const RE_CLASSE_DEPOIMENTO = /(?:^|[\s_-])(?:testimonial|depoimento|review|avaliac)/i;
const RE_NOME_PESSOA = /(?<![\p{L}])\p{Lu}\p{Ll}{2,}(?:\s+(?:d[aeo]s?|e)\s+|\s+)\p{Lu}\p{Ll}{2,}/u;
const RE_CARGO = /(?<![\p{L}])(?:ceo|cto|cfo|diretor(?:a)?|gerente|fundador(?:a)?|s[oó]cio|s[oó]cia|propriet[aá]ri[oa]|dono|dona|coordenador(?:a)?|analista|engenheir[oa]|m[eé]dic[oa]|advogad[oa]|professor(?:a)?|chef|arquitet[oa]|designer|desenvolvedor(?:a)?|empres[aá]ri[oa]|cliente|aluno|aluna|ltda|s\.a\.|empresa)(?![\p{L}])/iu;
const RE_PLACEHOLDER_IMG = /placeholder|placehold|dummyimage|picsum|1x1|blank|spacer|default[-_]?(?:avatar|user)|avatar[-_]?default/i;
function blocosDeDepoimento(pag) {
  const T = arvore(pag);
  const cand = T.elementos.filter((e) => e.tag === 'blockquote' || RE_CLASSE_DEPOIMENTO.test(classeDe(e)) || (e.tag === 'figure' && descendentes(e, (d) => d.tag === 'figcaption').length));
  const conj = new Set(cand);
  const topoDentro = (c) => descendentes(c, (d) => conj.has(d)).filter((d) => ![...ancestrais(d)].some((a) => a !== c && conj.has(a) && estaDentro(a, c)));
  const out = [];
  const visitar = (c) => {
    const filhos = topoDentro(c);
    if (filhos.length >= 2) filhos.forEach(visitar);
    else out.push(c);
  };
  for (const c of cand.filter((x) => ![...ancestrais(x)].some((a) => conj.has(a)))) visitar(c);
  return out.map((el) => ({ el, nos: nosSob(pag, el) })).filter((b) => b.nos.length > 0);
}
function sinaisDoDepoimento(pag, bloco) {
  const T = arvore(pag);
  const mapaImg = imagensPorSeletor(pag);
  const textos = bloco.nos.map((n) => n.texto);
  const junto = textos.join(' ');
  const nome = RE_NOME_PESSOA.test(junto);
  const foto = descendentes(bloco.el, (d) => d.tag === 'img').some((img) => {
    const i = mapaImg.get(seletorDe(img, T.ids));
    const alt = img.attrs.alt;
    return i && i.visivel && !i.clone && alt !== '' && !RE_PLACEHOLDER_IMG.test(img.attrs.src || '');
  });
  const cargo = RE_CARGO.test(junto) || textos.some((t) => /\p{Lu}\p{Ll}+\s*(?:,|—|–|-)\s*\p{Lu}\p{L}+/u.test(t));
  const link = descendentes(bloco.el, (d) => d.tag === 'a' && d.attrs.href && !/^(#|javascript:)/i.test(d.attrs.href)).length > 0
    || !!bloco.el.attrs.cite || /@\w{2,}/.test(junto);
  return { nome, foto, cargo, link, total: [nome, foto, cargo, link].filter(Boolean).length };
}
const depoimentoSemIdentificacao = detector('html', ({ pags }) => {
  const L = LIMIARES.depoimentos;
  const achados = [];
  let total = 0;
  let fracos = 0;
  for (const pag of pags) {
    const blocos = blocosDeDepoimento(pag).map((b) => ({ ...b, sinais: sinaisDoDepoimento(pag, b) }));
    total += blocos.length;
    const f = blocos.filter((b) => b.sinais.total < L.sinaisParaIdentificar);
    fracos += f.length;
    if (!f.length) continue;
    const trechos = f.slice(0, 3).map((b) => b.nos[0]);
    achados.push(ach(pag, `Depoimentos com pouca identificação (menos de dois entre nome, foto, cargo/cidade e link): ${f.length} de ${blocos.length} blocos. Exemplos: ${lista(trechos.map((n) => n.texto), 3)}.`,
      { cit: trechos.map((n) => citT(pag, corte(n.texto, 100))), ev: trechos.map((n, i) => evid(pag, n.seletor, n.texto, `sinais:${f[i].sinais.total}`)), numeros: [f.length, blocos.length] }));
  }
  if (total < L.minimoDeDepoimentos) return null;
  return fracos >= L.minimoDeBlocosFracos ? res(true, fracos / total, achados) : res(false, 0);
});

// cont-prova-social-generica -------------------------------------------------------------------------------------------
// Entrada vago-prova-social-sem-fonte + "mais de N clientes/empresas/usuários/pessoas", "nota 4,9" e "★★★". Há fonte se, até
// 150 caracteres antes/depois (nós vizinhos incluídos), aparecer plataforma de avaliação, ano/período ou link externo.
// Faixa de logos: contêiner de classe logo/cliente/parceiro/brand/marca com 3+ imagens sem link e sem alt.
const PLATAFORMAS = /google|reclame\s*aqui|trustpilot|facebook|instagram|tripadvisor|yelp|ebit|trustvox|app\s*store|play\s*store|glassdoor|youtube|linkedin|\bg2\b|capterra/i;
const RE_FONTE_TEMPO = /\b(?:19|20)\d{2}\b|per[ií]odo|desde\s|[uú]ltimos?\s+\d+\s+(?:meses|anos)/i;
const EXTRAS_PROVA = [
  /mais de [0-9.]+ (?:clientes|empresas|usu[aá]rios|pessoas)/i,
  /(?:nota|avalia[cç][aã]o) [0-9],?[0-9]?/i,
  /[★⭐]{3,}/u,
];
const RE_CLASSE_LOGOS = /logo|cliente|parceir|partner|brand|marca|trust|confian/i;
function janelaDeNos(v, i, raio) {
  let antes = '';
  for (let j = i - 1; j >= 0 && antes.length < raio; j--) antes = v[j].texto + ' ' + antes;
  let depois = '';
  for (let j = i + 1; j < v.length && depois.length < raio; j++) depois += ' ' + v[j].texto;
  return { antes: antes.slice(-raio), depois: depois.slice(0, raio) };
}
function linkExternoPerto(pag, nos, hostSite) {
  return nos.some((n) => {
    const a = n.el && sobAncestral(n.el, (e) => e.tag === 'a' && e.attrs.href);
    if (!a) return false;
    try { const u = new URL(a.attrs.href, pag.url); return /^https?:$/.test(u.protocol) && u.host !== hostSite; } catch { return false; }
  });
}
const provaSocialGenerica = detector('texto', ({ ctx, pags }) => {
  const L = LIMIARES.provaSocial;
  const ativos = porIds(['vago-prova-social-sem-fonte']);
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const v = nosComEl(pag);
    let host = ctx.site?.host || '';
    try { host ||= new URL(pag.url).host; } catch { /* sem host */ }
    const hits = [];
    v.forEach((n, i) => {
      const achadosNo = [...acharPorFrase(n.texto, ativos).map((h) => h.trecho)];
      for (const re of EXTRAS_PROVA) { const m = re.exec(n.texto); if (m) achadosNo.push(m[0].trim()); }
      for (const trecho of unicos(achadosNo, (t) => norm(t))) {
        const w = janelaDeNos(v, i, L.janela);
        const ao = `${w.antes} ${n.texto} ${w.depois}`;
        const vizinhos = v.slice(Math.max(0, i - 3), i + 4);
        const temFonte = PLATAFORMAS.test(ao) || RE_FONTE_TEMPO.test(ao.replace(trecho, ' ')) || linkExternoPerto(pag, vizinhos, host);
        if (!temFonte) hits.push({ n, trecho });
      }
    });
    // faixas de logos
    const T = arvore(pag);
    const mapaImg = imagensPorSeletor(pag);
    const ids = T.ids;
    const faixas = T.elementos.filter((e) => RE_CLASSE_LOGOS.test(classeDe(e))).map((e) => {
      const imgs = descendentes(e, (d) => d.tag === 'img').filter((img) => { const i = mapaImg.get(seletorDe(img, ids)); return i && i.visivel && !i.clone; });
      const semLink = imgs.filter((img) => !sobAncestral(img, (x) => x.tag === 'a') && (img.attrs.alt == null || img.attrs.alt.trim() === ''));
      return { e, imgs, semLink };
    }).filter((f) => f.semLink.length >= L.minimoDeLogosNaFaixa);
    const faixasTopo = faixas.filter((f) => !faixas.some((o) => o !== f && estaDentro(f.e, o.e)));
    if (!hits.length && !faixasTopo.length) continue;
    total += hits.length + faixasTopo.length;
    const partes = [];
    if (hits.length) partes.push(`frases de prova social sem fonte por perto: ${lista(hits.map((h) => h.trecho), 4)}`);
    if (faixasTopo.length) partes.push(`${faixasTopo.length} faixa(s) de logos sem link e sem texto alternativo com o nome da empresa`);
    achados.push(ach(pag, `Prova social genérica: ${partes.join('; ')}. Fonte aceita: plataforma de avaliação, ano ou período, link externo.`,
      { cit: hits.slice(0, 4).map((h) => citT(pag, h.trecho)), ev: hits.slice(0, 4).map((h) => evid(pag, h.n.seletor, h.trecho, 'prova-social-sem-fonte')), numeros: [hits.length, faixasTopo.length] }));
  }
  return total >= 1 ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// cont-numero-sem-contexto ---------------------------------------------------------------------------------------------
// O extrator não guarda tamanho de fonte por nó; "número em destaque" é aproximado por (a) nó que é SÓ um número
// (>= 10, ou com %, +, k, mil) ou (b) nó que começa por número dentro de elemento com classe stat|counter|number|metric|numero|
// contador|kpi. Contexto = unidade, período ou comparação no próprio nó ou no rótulo vizinho (nó anterior/seguinte, até 6 palavras).
const RE_SO_NUMERO = /^[+\-−]?\s?\d[\d.,]*\s?(%|\+|k|mil|mi|bi|x)?\+?$/i;
const RE_CLASSE_STAT = /stat|counter|number|metric|numero|contador|kpi/i;
const RE_UNIDADE_CTX = P(`${UNIDADES_PAR}|visitas?|downloads?|avalia[cç][oõ]es|franquias?|im[oó]veis|ve[ií]culos?|certifica[cç][oõ]es|v[ií]deos?|equipes?|p[aá]ginas?`);
const RE_PERIODO_CTX = /por\s+(?:m[eê]s|ano|dia|semana)|ao\s+(?:m[eê]s|ano|dia)|\/\s?(?:m[eê]s|ano|dia)|desde\s+\d{4}|em\s+\d{4}|\b(?:19|20)\d{2}\b|mensal|anual|di[aá]ri[oa]|[uú]ltimos?\s|\bhoje\b/i;
const RE_COMPARACAO_CTX = /\bvs\.?\b|versus|em\s+rela[cç][aã]o|comparad[oa]|\bcontra\b|que\s+o\s+(?:ano|m[eê]s)|a\s+mais\s+que|vari[aç][aã]o/i;
const numeroSemContexto = detector('css', ({ pags }) => {
  const L = LIMIARES.numeroSemContexto;
  const achados = [];
  let destaques = 0;
  let sem = 0;
  for (const pag of pags) {
    const v = nosComEl(pag).filter((n) => !tagsDoSeletor(n.seletor).some((t) => ['nav', 'footer', 'a', 'button', 'pre', 'code', 'script', 'style'].includes(t)));
    const itens = [];
    v.forEach((n, i) => {
      const t = n.texto.trim();
      const sufixo = /(%|\+|k|mil)\s?\+?$/i.test(t);
      const valor = extrairNumeros(t)[0];
      const soNumero = RE_SO_NUMERO.test(t) && (sufixo || (valor ?? 0) >= L.valorMinimoSemSufixo) && !/^(?:19|20)\d{2}$/.test(t);
      const porClasse = !!n.el && /^[+\-−]?\s?\d/.test(t) && t.length <= 24 && !!sobAncestral(n.el, (e) => RE_CLASSE_STAT.test(classeDe(e)));
      if (!soNumero && !porClasse) return;
      const rotulos = [v[i - 1], v[i + 1]].filter((x) => x && palavrasDe(x.texto).length <= L.palavrasDoRotulo && !RE_SO_NUMERO.test(x.texto.trim()));
      const resto = t.replace(/^[+\-−]?\s?\d[\d.,]*\s?(%|\+|k|mil|mi|bi|x)?\+?/i, ' ');
      const contexto = [resto, ...rotulos.map((r) => r.texto)].some((s) => RE_UNIDADE_CTX.test(s) || RE_PERIODO_CTX.test(s) || RE_COMPARACAO_CTX.test(s));
      itens.push({ n, texto: t, contexto });
    });
    destaques += itens.length;
    const falhas = itens.filter((x) => !x.contexto);
    sem += falhas.length;
    if (!falhas.length) continue;
    achados.push(ach(pag, `Números em destaque sem unidade, período ou comparação ao lado: ${lista(falhas.map((f) => f.texto), 4)}.`,
      { cit: falhas.slice(0, 4).map((f) => citT(pag, f.texto)), ev: falhas.slice(0, 4).map((f) => evid(pag, f.n.seletor, f.texto, 'numero-sem-contexto')), numeros: [falhas.length, itens.length] }));
  }
  if (!destaques) return null;
  return sem >= L.minimoSemContexto ? res(true, sem / destaques, achados) : res(false, 0);
});

// cont-promessa-absoluta -----------------------------------------------------------------------------------------------
const PADROES_PROMESSA_ABSOLUTA = [
  /100\s?% (?:garantid|seguro|eficaz|natural|sem risco)/i,
  /(?:resultado|sucesso|lucro|retorno|aprova[cç][aã]o) garantid[oa]/i,
  /sem (?:nenhum )?risco/i,
  /(?:ganhe|fature|lucre|receba) (?:at[eé] )?r\$ ?[0-9]/i,
  P('nunca mais|para sempre|definitivamente|milagr[oe]s?'),
  /voc[eê] vai (?:ganhar|lucrar|emagrecer|aprender) /i,
];
const promessaAbsoluta = detector('texto', ({ pags }) => {
  const L = LIMIARES.promessa;
  const achados = [];
  let total = 0;
  for (const pag of pags) {
    const hits = [];
    for (const n of pag.visiveis) for (const re of PADROES_PROMESSA_ABSOLUTA) {
      const m = re.exec(n.texto);
      if (m) hits.push({ n, trecho: m[0].trim() });
    }
    const u = unicos(hits, (h) => h.n.seletor + '|' + norm(h.trecho));
    if (!u.length) continue;
    total += u.length;
    achados.push(ach(pag, `Promessa de certeza ou de resultado garantido no texto: ${lista(u.map((h) => h.trecho), 4)}.`,
      { cit: u.slice(0, 4).map((h) => citT(pag, h.trecho)), ev: u.slice(0, 4).map((h) => evid(pag, h.n.seletor, h.trecho, 'promessa-absoluta')) }));
  }
  return total >= L.minimoOcorrencias ? res(true, total / L.saturaEm, achados) : res(false, 0);
});

// cont-cta-claro (misto, PARCIAL) --------------------------------------------------------------------------------------
// O medidor css só entrega, por viewport (1440x900 e 390x844), o total de botões, os fundos e o botão primário. Medido aqui:
// (1) nenhum botão com fundo preenchido => ação de destaque ausente (peso 1); (2) rótulo do botão primário genérico (tipo
// cta-generico) ou com menos de 2 palavras (peso 0,5). NÃO medido: "3 ou mais botões de destaque no mesmo bloco" (excesso).
// O modelo confirma qual é a ação principal.
const ctaClaro = detector('css', ({ pags }) => {
  const L = LIMIARES.ctaClaro;
  const generico = porTipos(['cta-generico']);
  const achados = [];
  const pesos = [];
  let avaliou = false;
  for (const pag of pags) {
    const vistas = [['desktop', pag.p.final?.estilos?.cores?.botoes], ['celular', pag.p.mobile?.estilos?.cores?.botoes]];
    const falhas = [];
    for (const [vp, b] of vistas) {
      if (!b) continue;
      avaliou = true;
      const semFundo = !b.total || Object.keys(b.porFundo || {}).every((k) => k === 'transparente');
      if (semFundo) { falhas.push({ vp, tipo: 'ausente', peso: L.pesoAusente }); continue; }
      const texto = b.primario?.texto || '';
      if (!texto) continue;
      if (generico.some((a) => texto.search(a.re) >= 0)) falhas.push({ vp, tipo: 'rotulo-generico', peso: L.pesoRotuloGenerico, texto, seletor: b.primario.seletor });
      else if (palavrasDe(texto).length < L.minimoDePalavrasDoRotulo) falhas.push({ vp, tipo: 'rotulo-curto', peso: L.pesoRotuloGenerico, texto, seletor: b.primario.seletor });
    }
    if (!falhas.length) continue;
    const unicas = unicos(falhas, (f) => f.tipo + '|' + (f.texto || ''));
    pesos.push(...unicas.map((f) => f.peso));
    const cit = [];
    const ev = [];
    for (const f of unicas.filter((x) => x.texto)) {
      const no = pag.visiveis.find((n) => norm(n.texto) === norm(f.texto)) || pag.visiveis.find((n) => norm(n.texto).includes(norm(f.texto)));
      if (no) { cit.push(citT(pag, no.texto)); ev.push(evid(pag, no.seletor, no.texto, f.tipo)); }
    }
    const frases = unicas.map((f) => (f.tipo === 'ausente' ? `nenhum botão de destaque (com fundo preenchido) no ${f.vp}` : `o botão principal diz «${corte(f.texto, 40)}», rótulo ${f.tipo === 'rotulo-generico' ? 'genérico' : 'curto'} (${f.vp})`));
    achados.push(ach(pag, `Chamada para ação pouco clara: ${frases.join('; ')}. O modelo confirma qual é a ação principal da página.`, { cit, ev }));
  }
  if (!avaliou) return null;
  return pesos.length ? res(true, soma(pesos) / pesos.length, achados) : res(false, 0);
});

// cont-contato-visivel -------------------------------------------------------------------------------------------------
// Itens: (1) link de contato (texto contato|fale conosco|fale com|atendimento, em qualquer lugar da página: o extrator não
// separa cabeçalho de rodapé de forma confiável); (2) canal direto: tel:, mailto:, wa.me / api.whatsapp.com, <address>,
// PostalAddress no JSON-LD, telefone ou e-mail no texto visível. Dispara se faltar 1 dos 2 (intensidade 0,5) ou os 2 (1).
// O "peso extra" para loja/página de vendas/agendamento da regra não é aplicado aqui.
const RE_LINK_CONTATO = P('contato|fale conosco|fale com(?:\\s+a\\s+gente|\\s+um\\s+especialista|\\s+nossa\\s+equipe)?|atendimento');
const RE_TELEFONE = [/\(\s*\d{2}\s*\)\s*9?\s*\d{4}[\s.-]?\d{4}/g, /(?:\+55\s?)?\b\d{2}\s9?\d{4}[-\s]\d{4}\b/g, /\b0800[\s-]?\d{3}[\s-]?\d{4}\b/g];
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g;
const RE_CNPJ = /(?<![\d./-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;
const telefonesDe = (texto) => { const sem = texto.replace(RE_CNPJ, ' '); return RE_TELEFONE.flatMap((re) => [...sem.matchAll(re)].map((m) => m[0].trim())); };
const emailsDe = (texto) => [...texto.matchAll(RE_EMAIL)].map((m) => m[0]).filter((e) => !/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(e));
function temPostalAddress(extr) {
  const achou = (o) => Array.isArray(o) ? o.some(achou) : o && typeof o === 'object' ? ([].concat(o['@type'] || []).includes('PostalAddress') || Object.values(o).some(achou)) : false;
  return (extr.jsonld || []).some((j) => { try { return achou(JSON.parse(j)); } catch { return false; } });
}
const contatoVisivel = detector('html', ({ pags }) => {
  let linkContato = false;
  let canal = false;
  for (const pag of pags) {
    if ((pag.extr.links || []).some((l) => l.visivel && !l.clone && RE_LINK_CONTATO.test(l.texto || l.ariaLabel || ''))) linkContato = true;
    if ((pag.extr.links || []).some((l) => l.visivel && !l.clone && /^(?:tel:|mailto:)|wa\.me|api\.whatsapp\.com/i.test(l.hrefAttr || ''))) canal = true;
    if (pag.visiveis.some((n) => tagsDoSeletor(n.seletor).includes('address') || telefonesDe(n.texto).length || emailsDe(n.texto).length)) canal = true;
    if (temPostalAddress(pag.extr)) canal = true;
  }
  const atendidos = [linkContato, canal].filter(Boolean).length;
  if (atendidos === 2) return res(false, 0);
  const pag = pags[0];
  const faltas = [!linkContato && 'link de «Contato» ou «Fale conosco»', !canal && 'canal direto (telefone, e-mail, WhatsApp ou endereço)'].filter(Boolean);
  const cit = [];
  if (!linkContato) for (const t of ['contato', 'fale conosco']) cit.push({ tipo: 'contagem', contagem: { fn: 'links-com-texto', texto: t, esperado: 0 }, versoes: ['final'] });
  return res(true, 1 - atendidos / 2, [ach(pag, `Contato difícil de achar nas páginas lidas: faltou ${faltas.join(' e ')}.`, { cit })]);
});

// cont-preco-claro -----------------------------------------------------------------------------------------------------
// Valores em R$ no texto visível; condição (por mês, à vista, parcelas, a partir de, taxa, frete, impostos, inclui,
// recorrência) até 120 caracteres antes/depois (nós vizinhos incluídos); "*" colado ao valor precisa de nota "*" na página.
// "Preço ausente": nenhum valor nas páginas lidas, e o tipo de site é de venda ou há botão de compra/contratação.
const RE_PRECO = /R\$\s?\d[\d.]*(?:,\d{2})?/g;
const RE_CONDICAO_PRECO = /por m[eê]s|\/\s?m[eê]s|[aà] vista|parcel|a partir de|taxa|frete|impostos?|inclui|recorr[eê]ncia/i;
const RE_COMPRA = /comprar|assinar|contratar|garantir\s+(?:minha\s+)?vaga|adicionar ao carrinho|finalizar compra|checkout|matricular|quero\s+(?:comprar|garantir|assinar|adquirir)|adquirir/i;
const TIPOS_DE_VENDA = ['loja', 'pagina-de-vendas', 'catalogo', 'cardapio', 'agendamento'];
const precoClaro = detector('texto', ({ ctx, pags }) => {
  const L = LIMIARES.preco;
  const achados = [];
  const sem = [];
  const asteriscos = [];
  let total = 0;
  for (const pag of pags) {
    const v = pag.visiveis;
    const semCondPag = [];
    v.forEach((n, i) => {
      for (const m of n.texto.matchAll(RE_PRECO)) {
        total++;
        const valor = m[0].replace(/\.$/, '');
        const fim = m.index + m[0].length;
        const w = janelaDeNos(v, i, L.distanciaDaCondicao);
        const redor = `${w.antes} ${n.texto.slice(0, m.index)} ${n.texto.slice(fim)} ${w.depois}`;
        const item = { pag, n, valor, trecho: janela(n.texto, m.index, fim, 20) };
        if (!RE_CONDICAO_PRECO.test(redor)) { sem.push(item); semCondPag.push(item); }
        if (/^\s?\*/.test(n.texto.slice(fim))) {
          const idxAst = n.texto.indexOf('*', fim);
          const nota = v.some((o) => o !== n && /^\s*\*\s*\S/.test(o.texto)) || n.texto.indexOf('*', idxAst + 1) >= 0;
          if (!nota) asteriscos.push(item);
          item.asterisco = true;
          item.comNota = nota;
        }
      }
    });
    if (semCondPag.length) {
      achados.push(ach(pag, `Valor sem condição de pagamento por perto (por mês, à vista, parcelas, taxa, frete, o que inclui): ${lista(semCondPag.map((s) => s.valor), 4)}.`,
        { cit: semCondPag.slice(0, 4).map((s) => citT(pag, s.valor)), ev: semCondPag.slice(0, 4).map((s) => evid(pag, s.n.seletor, s.trecho, s.valor)), numeros: [semCondPag.length] }));
    }
  }
  const comAsterisco = [];
  for (const pag of pags) pag.visiveis.forEach((n) => { for (const m of n.texto.matchAll(RE_PRECO)) if (/^\s?\*/.test(n.texto.slice(m.index + m[0].length))) comAsterisco.push({ pag, n, valor: m[0].replace(/\.$/, '') }); });
  if (asteriscos.length) {
    const pag = asteriscos[0].pag;
    achados.push(ach(pag, `Valor com asterisco sem nota correspondente na página: ${lista(asteriscos.map((a) => a.valor + '*'), 3)}.`,
      { cit: asteriscos.slice(0, 3).map((a) => citT(a.pag, a.valor)), ev: asteriscos.slice(0, 3).map((a) => evid(a.pag, a.n.seletor, a.trecho, a.valor)) }));
  }
  let ausente = false;
  if (total === 0) {
    const tipo = ctx.site?.tipoDeSite || null;
    const comprar = pags.flatMap((pag) => pag.visiveis.filter((n) => tagsDoSeletor(n.seletor).some((t) => t === 'button' || t === 'a') && RE_COMPRA.test(n.texto)).map((n) => ({ pag, n })));
    if ((tipo && TIPOS_DE_VENDA.includes(tipo)) || comprar.length) {
      ausente = true;
      const pag = comprar[0]?.pag || pags[0];
      const cit = [{ tipo: 'contagem', contagem: { fn: 'ocorrencias-visiveis', texto: 'R$', esperado: 0 }, versoes: ['final'] }];
      if (comprar[0]) cit.push(citT(comprar[0].pag, comprar[0].n.texto));
      achados.push(ach(pag, `Preço ausente: nenhum valor em reais aparece no texto visível das páginas lidas${comprar[0] ? `, mas há chamada de compra ou contratação («${corte(comprar[0].n.texto, 50)}»)` : ' (site de venda)'}.`, { cit }));
    }
  }
  const comps = [];
  if (total) comps.push(sem.length / total);
  if (comAsterisco.length) comps.push(asteriscos.length / comAsterisco.length);
  if (ausente) comps.push(1);
  if (!total && !ausente) return res(false, 0);
  const media = comps.length ? soma(comps) / comps.length : 0;
  return media > 0 ? res(true, media, achados) : res(false, 0);
});

// cont-faq -------------------------------------------------------------------------------------------------------------
// Seção de FAQ = heading (perguntas frequentes|dúvidas|faq), <details><summary>, acordeão (classe accordion/acordeão/faq) ou
// JSON-LD FAQPage. Pares: details/summary; itens de acordeão (1º texto = pergunta); perguntas terminadas em "?" dentro da seção
// do heading com a resposta no irmão seguinte; FAQPage. A PERGUNTA precisa estar visível e não-clone; a resposta pode estar
// recolhida (é o estado normal de um acordeão). Intensidade: nenhuma = 1; poucos pares = 0,5; respostas curtas = 0,5 (soma, até 1).
const RE_HEADING_FAQ = P('perguntas\\s+frequentes|d[uú]vidas(?:\\s+frequentes|\\s+comuns)?|faq|tire\\s+suas\\s+d[uú]vidas|perguntas\\s+e\\s+respostas');
const RE_CLASSE_ACORDEAO = /(?:^|[\s_-])(?:accordion|acordeao|acordeon|faq|faqs)(?:$|[\s_])/i;
function semTags(s) { return decodificarEntidades(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function paresDeFaq(pag) {
  const T = arvore(pag);
  const visJunto = norm(pag.visiveis.map((n) => n.texto).join(' '));
  const pares = [];
  const vistos = new Set();
  const add = (pergunta, resposta, origem) => {
    const k = norm(pergunta);
    if (!k || vistos.has(k) || !visJunto.includes(k)) return;
    vistos.add(k);
    pares.push({ pergunta: pergunta.trim(), resposta: resposta.trim(), palavras: palavrasDe(resposta).length, origem });
  };
  let temSecao = false;
  // heading de FAQ
  const heading = (pag.extr.headings || []).find((h) => h.visivel && !h.clone && RE_HEADING_FAQ.test(h.texto));
  if (heading) temSecao = true;
  // details > summary
  for (const d of T.elementos.filter((e) => e.tag === 'details')) {
    const s = filhosEl(d).find((f) => f.tag === 'summary');
    if (!s) continue;
    temSecao = true;
    const q = textoDe(s);
    const resposta = filhosEl(d).filter((f) => f !== s).map(textoDe).join(' ') || d.filhos.filter((f) => !f.tag && !f.raw).map((f) => f.texto).join(' ');
    add(q, resposta, 'details');
  }
  // acordeão
  for (const c of T.elementos.filter((e) => RE_CLASSE_ACORDEAO.test(classeDe(e)))) {
    const itens = filhosEl(c).filter((f) => !RAW.has(f.tag));
    for (const it of itens) {
      const chunks = textosDe(it);
      if (chunks.length >= 2 && palavrasDe(chunks[0]).length <= 25) { temSecao = true; add(chunks[0], chunks.slice(1).join(' '), 'acordeao'); }
    }
    if (itens.length) temSecao = true;
  }
  // perguntas com "?" na seção do heading
  if (heading) {
    const el = T.porSeletor.get(heading.seletor);
    const cont = el && [...ancestrais(el)].find((a) => ['section', 'div', 'article', 'main'].includes(a.tag) && descendentes(a, (d) => /\?$/.test(textoDe(d)) && textoDe(d).length <= 200).length);
    if (cont) {
      for (const q of descendentes(cont, (d) => /\?$/.test(textoDe(d)) && textoDe(d).length <= 200 && !filhosEl(d).some((f) => /\?$/.test(textoDe(f))))) {
        const irmaos = q.pai ? filhosEl(q.pai) : [];
        const prox = irmaos[irmaos.indexOf(q) + 1];
        if (prox) add(textoDe(q), textoDe(prox), 'heading');
      }
    }
  }
  // JSON-LD FAQPage
  for (const j of pag.extr.jsonld || []) {
    let o; try { o = JSON.parse(j); } catch { continue; }
    const grupo = [].concat(o?.['@graph'] || o);
    for (const g of grupo) {
      if (![].concat(g?.['@type'] || []).includes('FAQPage')) continue;
      temSecao = true;
      for (const q of [].concat(g.mainEntity || [])) add(String(q?.name || ''), semTags(q?.acceptedAnswer?.text), 'jsonld');
    }
  }
  return { temSecao, pares, heading };
}
const faq = detector('html', ({ pags }) => {
  const L = LIMIARES.faq;
  const lidas = pags.map((pag) => ({ pag, ...paresDeFaq(pag) }));
  const melhor = [...lidas].sort((a, b) => b.pares.length - a.pares.length || Number(b.temSecao) - Number(a.temSecao))[0];
  const temSecao = lidas.some((x) => x.temSecao);
  if (!temSecao) {
    const pag = pags[0];
    return res(true, 1, [ach(pag, 'Não foi achada seção de perguntas frequentes nas páginas lidas (nem título de FAQ, nem lista de perguntas com resposta recolhível, nem dados estruturados de FAQ).')]);
  }
  const falhas = [];
  let intensidade = 0;
  if (melhor.pares.length < L.minimoDePares) { falhas.push(`só ${melhor.pares.length} pergunta(s) com resposta visível (o esperado é ${L.minimoDePares} ou mais)`); intensidade += 0.5; }
  const curtas = melhor.pares.filter((p) => p.palavras < L.respostaMinimaEmPalavras);
  if (melhor.pares.length && curtas.length > melhor.pares.length / 2) { falhas.push(`${curtas.length} de ${melhor.pares.length} respostas têm menos de ${L.respostaMinimaEmPalavras} palavras`); intensidade += 0.5; }
  if (!falhas.length) return res(false, 0);
  const pag = melhor.pag;
  const cit = [];
  if (melhor.heading) cit.push(citT(pag, melhor.heading.texto));
  for (const p of melhor.pares.slice(0, 2)) cit.push(citT(pag, p.pergunta));
  return res(true, intensidade, [ach(pag, `FAQ fraco: ${falhas.join('; ')}.`, { cit, numeros: [melhor.pares.length, curtas.length] })]);
});

// cont-garantia-e-trocas -----------------------------------------------------------------------------------------------
// Termos da regra, por trecho de palavra (sem borda), no texto visível e nos links (texto e href) de todas as páginas lidas.
// A ausência é citada por contagens de "ocorrencias-visiveis" iguais a zero.
const TERMOS_GARANTIA = ['garantia', 'troca', 'devolução', 'devolucao', 'reembolso', 'arrependimento', 'cancelamento'];
const RE_TERMOS_GARANTIA = /garantia|troca|devolu[cç][aã]o|reembolso|arrependimento|cancelamento|pol[ií]tica de (?:troca|devolu[cç][aã]o|reembolso)/i;
const garantiaETrocas = detector('texto', ({ pags }) => {
  for (const pag of pags) {
    if (pag.visiveis.some((n) => RE_TERMOS_GARANTIA.test(n.texto))) return res(false, 0);
    if ((pag.extr.links || []).some((l) => !l.clone && (RE_TERMOS_GARANTIA.test(l.texto || '') || RE_TERMOS_GARANTIA.test(l.hrefAttr || '')))) return res(false, 0);
  }
  const cit = TERMOS_GARANTIA.map((t) => ({ tipo: 'contagem', contagem: { fn: 'ocorrencias-visiveis', texto: t, esperado: 0 }, versoes: ['final'] }));
  return res(true, 1, [ach(pags[0], 'Nenhum dos termos garantia, troca, devolução, reembolso, arrependimento ou cancelamento aparece no texto visível nem nos links das páginas lidas.', { cit, ref: false })]);
});

// cont-consistencia-precos-e-nomes -------------------------------------------------------------------------------------
// Só nós visíveis e não-clone (texto oculto nunca entra). Compara ENTRE páginas: (a) valor em R$ de um mesmo nome de plano
// ou produto (nome até 80 caracteres antes do valor, no mesmo nó ou no nó anterior); (b) grafia da marca (rodapé ©, og:site_name,
// JSON-LD) com distância de edição de 1 a 2; (c) e-mail, telefone ou CNPJ: divergência quando duas páginas têm o tipo de
// contato e os conjuntos não têm nada em comum. A linguagem é "divergência entre páginas", nunca "preço errado".
const QUALIFICADORES = /(?:a partir de|por apenas|apenas|somente|s[oó]|por|de|agora|hoje|at[eé]|em|à vista|a vista|ao m[eê]s|por m[eê]s|mensal|anual|com|e)$/i;
const NOMES_GENERICOS = new Set(['preco', 'valor', 'total', 'mes', 'ano', 'plano', 'pacote', 'produto', 'oferta', 'promocao', 'de', 'por', 'a partir', 'unidade', 'cada']);
function valorEmReais(txt) {
  const m = /R\$\s?(\d[\d.]*)(?:,(\d{2}))?/.exec(txt);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
}
function precosNomeados(pag) {
  const v = pag.visiveis;
  const out = [];
  v.forEach((n, i) => {
    for (const m of n.texto.matchAll(RE_PRECO)) {
      const valorTxt = m[0].replace(/\.$/, '');
      const valor = valorEmReais(valorTxt);
      if (valor === null) continue;
      let prefixo = n.texto.slice(0, m.index).replace(/[\s:–—\-|·•(\[/]+$/, '');
      for (let k = 0; k < 4 && QUALIFICADORES.test(prefixo); k++) prefixo = prefixo.replace(QUALIFICADORES, '').replace(/[\s:–—\-|·•(\[/]+$/, '');
      let nome = palavrasDe(prefixo).slice(-LIMIARES.consistencia.palavrasDoNome).join(' ');
      let origem = 'mesmo-no';
      if (!norm(nome)) {
        const ant = v[i - 1];
        const irmao = ant && (ant.seletor === paiDoSeletor(n.seletor) || paiDoSeletor(ant.seletor) === paiDoSeletor(n.seletor));
        if (ant && irmao && palavrasDe(ant.texto).length <= 6 && !/\d/.test(ant.texto)) { nome = ant.texto.trim(); origem = 'no-anterior'; }
      }
      const chave = norm(nome);
      if (!chave || chave.length < 3 || NOMES_GENERICOS.has(chave) || /^\d/.test(chave)) continue;
      out.push({ pag, n, chave, nome: nome.trim(), valor, valorTxt, origem, trecho: origem === 'mesmo-no' ? n.texto.slice(n.texto.indexOf(nome.trim()), m.index + m[0].length).trim() : valorTxt, ancora: valorTxt });
    }
  });
  return out;
}
function distanciaDeEdicao(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const RE_COPYRIGHT = /(?:©|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*[-–:.]?\s*([^.|•·\n]{2,60}?)(?=\.|\s{2,}|\s*[|•·]|\s+todos os direitos|\s+all rights|,|$)/iu;
function nomesDeMarca(pag) {
  const out = [];
  for (const n of pag.visiveis) {
    const m = RE_COPYRIGHT.exec(n.texto);
    if (m && norm(m[1])) out.push({ fonte: 'rodapé (©)', raw: m[1].trim(), onde: 'visivel', n });
  }
  for (const mt of pag.extr.metas || []) if ((mt.propriedade || '').toLowerCase() === 'og:site_name' && mt.conteudo) out.push({ fonte: 'og:site_name', raw: mt.conteudo.trim(), onde: 'html' });
  const achar = (o) => { if (Array.isArray(o)) o.forEach(achar); else if (o && typeof o === 'object') { if (/Organization|LocalBusiness|Corporation|Store|Restaurant|Brand/.test([].concat(o['@type'] || []).join(' ')) && typeof o.name === 'string') out.push({ fonte: 'JSON-LD', raw: o.name.trim(), onde: 'jsonld' }); Object.values(o).forEach(achar); } };
  for (const j of pag.extr.jsonld || []) { try { achar(JSON.parse(j)); } catch { /* inválido */ } }
  return out;
}
function contatosDaPagina(pag) {
  const emails = new Map();
  const telefones = new Map();
  const cnpjs = new Map();
  for (const n of pag.visiveis) {
    for (const e of emailsDe(n.texto)) emails.set(e.toLowerCase(), { raw: e, onde: 'visivel' });
    for (const t of telefonesDe(n.texto)) { const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').replace(/^0(?=\d{10,11}$)/, ''); if (d.length >= 10) telefones.set(d, { raw: t, onde: 'visivel' }); }
    for (const m of n.texto.replace(/(?<=\d)\s+(?=\d)/g, ' ').matchAll(RE_CNPJ)) { const d = m[0].replace(/\D/g, ''); if (cnpjValido(d)) cnpjs.set(d, { raw: m[0], onde: 'visivel' }); }
  }
  for (const l of pag.extr.links || []) {
    if (!l.visivel || l.clone || !l.hrefAttr) continue;
    const mail = /^mailto:([^?]+)/i.exec(l.hrefAttr);
    if (mail && !emails.has(mail[1].toLowerCase())) emails.set(mail[1].toLowerCase(), { raw: l.hrefAttr, onde: 'html' });
    const tel = /^tel:(.+)/i.exec(l.hrefAttr);
    if (tel) { const d = tel[1].replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); if (d.length >= 10 && !telefones.has(d)) telefones.set(d, { raw: l.hrefAttr, onde: 'html' }); }
  }
  return { emails, telefones, cnpjs };
}
const citacaoDoValor = (pag, onde, raw) => ({ tipo: 'trecho', valor: raw, onde: onde === 'visivel' ? 'visivel' : onde, versoes: ['final'], pagina: pag.url });
const consistenciaPrecosENomes = detector('texto', ({ pags }) => {
  const L = LIMIARES.consistencia;
  if (pags.length < L.minimoDePaginas) return null;
  const divs = []; // { pag, mensagem, cit, ev, numeros }
  // (a) preços por nome
  const porNome = new Map();
  for (const pag of pags) for (const x of precosNomeados(pag)) { const g = porNome.get(x.chave) || porNome.set(x.chave, new Map()).get(x.chave); (g.get(pag) || g.set(pag, []).get(pag)).push(x); }
  for (const [, mapa] of porNome) {
    const paginas = [...mapa.keys()];
    let par = null;
    for (let i = 0; i < paginas.length && !par; i++) for (let j = i + 1; j < paginas.length && !par; j++) {
      const A = new Set(mapa.get(paginas[i]).map((x) => x.valor));
      const B = new Set(mapa.get(paginas[j]).map((x) => x.valor));
      if (![...A].some((v) => B.has(v))) par = [paginas[i], paginas[j]];
    }
    if (!par) continue;
    const [pa, pb] = par;
    const a = mapa.get(pa)[0];
    const b = mapa.get(pb)[0];
    divs.push({ pag: pa, mensagem: `Divergência entre páginas: «${corte(a.nome, 40)}» aparece com ${a.valorTxt} em ${pa.caminho} e com ${b.valorTxt} em ${pb.caminho}.`,
      cit: [citT(pa, a.trecho), citT(pb, b.trecho)], ev: [evid(pa, a.n.seletor, a.trecho, a.valorTxt), evid(pb, b.n.seletor, b.trecho, b.valorTxt)] });
  }
  // (b) grafias da marca
  const marcas = pags.flatMap((pag) => nomesDeMarca(pag).map((m) => ({ ...m, pag, chave: norm(m.raw) })));
  const porFonte = agrupar(marcas, (m) => m.fonte);
  for (const [fonte, itens] of porFonte) {
    let achou = null;
    for (let i = 0; i < itens.length && !achou; i++) for (let j = i + 1; j < itens.length && !achou; j++) {
      const a = itens[i], b = itens[j];
      if (a.pag === b.pag || a.chave === b.chave || !a.chave || !b.chave) continue;
      const d = distanciaDeEdicao(a.chave, b.chave);
      if (d >= 1 && d <= L.distanciaDeEdicaoDaMarca) achou = [a, b];
    }
    if (!achou) continue;
    const [a, b] = achou;
    divs.push({ pag: a.pag, mensagem: `Divergência entre páginas na grafia do nome (${fonte}): «${corte(a.raw, 50)}» em ${a.pag.caminho} e «${corte(b.raw, 50)}» em ${b.pag.caminho}.`,
      cit: [citacaoDoValor(a.pag, a.onde, a.raw), citacaoDoValor(b.pag, b.onde, b.raw)], ev: [] });
  }
  // (c) contatos
  const contatos = pags.map((pag) => ({ pag, ...contatosDaPagina(pag) }));
  for (const [tipo, rotulo] of [['emails', 'e-mail'], ['telefones', 'telefone'], ['cnpjs', 'CNPJ']]) {
    const com = contatos.filter((c) => c[tipo].size > 0);
    let par = null;
    for (let i = 0; i < com.length && !par; i++) for (let j = i + 1; j < com.length && !par; j++) {
      if (![...com[i][tipo].keys()].some((k) => com[j][tipo].has(k))) par = [com[i], com[j]];
    }
    if (!par) continue;
    const [a, b] = par;
    const va = [...a[tipo].values()][0];
    const vb = [...b[tipo].values()][0];
    divs.push({ pag: a.pag, mensagem: `Divergência entre páginas no ${rotulo}: ${va.onde === 'html' ? va.raw : `«${va.raw}»`} em ${a.pag.caminho} e ${vb.onde === 'html' ? vb.raw : `«${vb.raw}»`} em ${b.pag.caminho}, sem nenhum valor em comum.`,
      cit: [citacaoDoValor(a.pag, va.onde, va.raw), citacaoDoValor(b.pag, vb.onde, vb.raw)], ev: [] });
  }
  if (!divs.length) return res(false, 0);
  const achados = divs.slice(0, 8).map((d) => ach(d.pag, d.mensagem, { cit: d.cit, ev: d.ev, ref: false }));
  return res(true, divs.length / L.saturaEm, achados);
});

// cont-quem-esta-por-tras ----------------------------------------------------------------------------------------------
// Página Sobre (URL com sobre|quem-somos|equipe|time|about|nossa-historia) entre as páginas lidas OU seção (heading com
// sobre|quem somos|nossa história|equipe|time). Itens: nome de pessoa; foto própria (img visível, alt não vazio, sem URL de
// banco de imagens nem placeholder); fato verificável (ano ou "em/de/na <Cidade>"). Dispara com menos de 2 dos 3 itens ou com
// a página/seção ausente. Se só há LINK para um Sobre que não foi lido: não avaliável.
const RE_PAGINA_SOBRE = /(?:sobre|quem-somos|equipe|time|about|nossa-historia)/i;
const RE_HEADING_SOBRE = /sobre|quem\s+somos|nossa\s+hist[oó]ria|equipe|\btime\b/i;
const RE_BANCO_IMG = /unsplash|pexels|shutterstock|istock|stock|pixabay|freepik|gettyimages/i;
const NAO_NOME = new Set(['sao', 'santa', 'santo', 'rua', 'avenida', 'av', 'nossa', 'nosso', 'nossos', 'nossas', 'sobre', 'quem', 'somos', 'equipe', 'missao', 'visao', 'valores', 'historia', 'brasil', 'porto', 'rio', 'belo', 'nova', 'novo', 'casa', 'grupo', 'instituto', 'empresa', 'agencia', 'estudio', 'studio', 'clinica', 'escritorio', 'consultoria', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'fundada', 'fundado', 'desde', 'todos', 'direitos', 'reservados', 'politica', 'privacidade', 'termos', 'contato']);
function acharNomeDePessoa(textos) {
  const re = new RegExp(RE_NOME_PESSOA.source, 'gu');
  for (const t of textos) for (const m of t.matchAll(re)) {
    const ws = norm(m[0]).split(' ').filter((w) => !['da', 'de', 'do', 'das', 'dos', 'e'].includes(w));
    if (ws.length >= 2 && !ws.some((w) => NAO_NOME.has(w))) return m[0];
  }
  return null;
}
const RE_ANO = /(?<![\d.,])(?:19[5-9]\d|20[0-4]\d)(?![\d])/;
const RE_CIDADE = /(?:\b(?:em|de|na cidade de|sediad[ao] em|localizad[ao] em|atuamos em)\s+)(\p{Lu}\p{Ll}{2,})/u;
function temFatoVerificavel(textos) {
  const junto = textos.join(' ');
  if (RE_ANO.test(junto)) return true;
  const m = RE_CIDADE.exec(junto);
  return !!m && !NAO_NOME.has(norm(m[1]));
}
const quemEstaPorTras = detector('html', ({ pags }) => {
  const L = LIMIARES.quemEstaPorTras;
  // 1) página Sobre lida
  let escopo = null;
  const paginaSobre = pags.find((pag) => RE_PAGINA_SOBRE.test(decodeURIComponentSeguro(caminhoDe(pag.url).split('?')[0])) && caminhoDe(pag.url) !== '/');
  if (paginaSobre) {
    const nos = nosComEl(paginaSobre).filter((n) => !tagsDoSeletor(n.seletor).some((t) => t === 'nav' || t === 'footer'));
    const imgs = (paginaSobre.extr.imagens || []).filter((i) => i.visivel && !i.clone && !tagsDoSeletor(i.seletor).some((t) => t === 'nav' || t === 'footer' || t === 'header'));
    escopo = { pag: paginaSobre, nos, imgs, origem: 'página Sobre', titulo: null };
  } else {
    // 2) seção com heading de Sobre
    for (const pag of pags) {
      const h = (pag.extr.headings || []).find((x) => x.visivel && !x.clone && RE_HEADING_SOBRE.test(x.texto));
      if (!h) continue;
      const T = arvore(pag);
      const el = T.porSeletor.get(h.seletor);
      const todosNos = nosComEl(pag);
      const dentroDoH = (n) => n.seletor === h.seletor || n.seletor.startsWith(h.seletor + '>');
      let cont = null;
      if (el) {
        for (const a of ancestrais(el)) {
          if (!['section', 'article', 'div', 'aside', 'main'].includes(a.tag)) continue;
          const nos = nosSob(pag, a).filter((n) => !dentroDoH(n));
          if (nos.length && (soma(nos.map((n) => n.texto.length)) >= 40 || descendentes(a, (d) => d.tag === 'img').length)) { cont = a; break; }
        }
      }
      let nos;
      if (cont) nos = nosSob(pag, cont);
      else {
        const i = todosNos.findIndex(dentroDoH);
        nos = [];
        for (let k = i + 1; k < todosNos.length && !ehTituloTag(ultimaTag(todosNos[k].seletor)); k++) nos.push(todosNos[k]);
      }
      const ids = T.ids;
      const mapa = imagensPorSeletor(pag);
      const imgs = cont ? descendentes(cont, (d) => d.tag === 'img').map((img) => mapa.get(seletorDe(img, ids))).filter((i) => i && i.visivel && !i.clone) : [];
      escopo = { pag, nos, imgs, origem: 'seção Sobre', titulo: h };
      break;
    }
  }
  if (!escopo) {
    const linkSobre = pags.some((pag) => (pag.extr.links || []).some((l) => l.visivel && !l.clone && RE_HEADING_SOBRE.test(l.texto || '') && l.interno));
    if (linkSobre) return null; // a página existe (há link), mas não foi lida: não dá para avaliar
    const pag = pags[0];
    return res(true, 1, [ach(pag, `Não foi achada página nem seção «Sobre», «Quem somos» ou «Equipe» nas páginas lidas: não fica claro quem está por trás do site.`)]);
  }
  const textos = escopo.nos.filter((n) => !ehTituloTag(ultimaTag(n.seletor))).map((n) => n.texto);
  const nome = acharNomeDePessoa(textos);
  const fotoOk = escopo.imgs.some((i) => i.alt !== '' && !RE_BANCO_IMG.test(i.src || '') && !RE_PLACEHOLDER_IMG.test(i.src || ''));
  const fato = temFatoVerificavel(textos);
  const atendidos = [nome, fotoOk, fato].filter(Boolean).length;
  if (atendidos >= L.itensParaPassar) return res(false, 0);
  const faltas = [!nome && 'nome de pessoa', !fotoOk && 'foto própria (sem banco de imagens)', !fato && 'fato verificável (ano ou cidade)'].filter(Boolean);
  const ref = escopo.titulo ? escopo.titulo.texto : escopo.nos[0]?.texto;
  const cit = ref ? [citT(escopo.pag, corte(ref, 80))] : [];
  return res(true, 1 - atendidos / L.totalDeItens, [ach(escopo.pag, `Pouca informação sobre quem está por trás do site na ${escopo.origem}: faltou ${faltas.join(', ')}.`, { cit, numeros: [atendidos] })]);
});
function decodeURIComponentSeguro(s) { try { return decodeURIComponent(s); } catch { return s; } }

// ---------------------------------------------------------------------------------------------------------------------
export const detectores = {
  // texto-generico (14 de 17; as outras 3 são de julgamento: txt-teste-da-troca, txt-voz-propria, txt-diz-o-que-e-em-5-segundos)
  'txt-densidade-cliches': densidadeDeCliches,
  'txt-lorem-ipsum': loremIpsum,
  'txt-nomes-e-dados-de-exemplo': nomesEDadosDeExemplo,
  'txt-headline-vago': headlineVago,
  'txt-ctas-genericos': ctasGenericos,
  'txt-especificidade-baixa': especificidadeBaixa,
  'txt-rebatida-nao-e-x-e-y': rebatidaNaoEXEY,
  'txt-frases-curtas-em-serie': fraseCurtasEmSerie,
  'txt-travessao-densidade': travessaoDensidade,
  'txt-exclamacoes-em-excesso': exclamacoesEmExcesso,
  'txt-abertura-batida': aberturaBatida,
  'txt-fechamento-batido': fechamentoBatido,
  'txt-rotulo-ia-vazio': rotuloIaVazio,
  'txt-mesmo-fato-repetido': mesmoFatoRepetido,
  // conteudo-confianca (11 de 12; cont-prova-verificavel-julgamento é de julgamento)
  'cont-depoimento-sem-identificacao': depoimentoSemIdentificacao,
  'cont-prova-social-generica': provaSocialGenerica,
  'cont-numero-sem-contexto': numeroSemContexto,
  'cont-promessa-absoluta': promessaAbsoluta,
  'cont-cta-claro': ctaClaro,
  'cont-contato-visivel': contatoVisivel,
  'cont-preco-claro': precoClaro,
  'cont-faq': faq,
  'cont-garantia-e-trocas': garantiaETrocas,
  'cont-consistencia-precos-e-nomes': consistenciaPrecosENomes,
  'cont-quem-esta-por-tras': quemEstaPorTras,
};
