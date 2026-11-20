// Medidor "jsonld": dados estruturados (JSON-LD, microdata e RDFa), lidos SEPARADAMENTE no HTML CRU
// (sem JavaScript) e no DOM FINAL (depois do JavaScript). Só medidas; o conteúdo do site é DADO.
//
// FORMATO DE `dados` (JSON puro; páginas ordenadas por URL; listas ordenadas):
// {
//   tiposDeInteresse: ['Article','FAQPage','LocalBusiness','Offer','Organization','Product','VideoObject','WebPage','WebSite'],
//   paginas: [{
//     url, caminho,
//     cru:   <versao>|null,
//     final: <versao>|null,
//     tiposSoNoFinal: [...],   // tipos que só aparecem depois do JavaScript
//     tiposSoNoCru: [...],     // tipos que somem depois do JavaScript
//     temEmQualquerVersao: boolean
//   }],
//   site: {
//     cru:   { tipos[], paginasComDados[] (caminhos), temDadosEstruturados },
//     final: { tipos[], paginasComDados[],            temDadosEstruturados },
//     tiposSoNoFinal[], tiposSoNoCru[], paginasSoNoFinal[], temEmQualquerVersao,
//     interesse: { <Tipo>: { cru: boolean, final: boolean } }     // para cada tipo de interesse
//   }
// }
// <versao> = {
//   jsonld: {
//     blocos,                       // quantidade de <script type="application/ld+json">
//     blocosValidos,                // blocos que o JSON.parse aceitou
//     erros: [{ indice, erro, trecho, possivelTruncamento }],   // indice = posição do bloco (0-based); trecho = início do texto (200 car.)
//     raizesSemTipo,                // objetos de nível raiz sem @type e sem @graph
//     usaGraph,                     // algum bloco usa @graph
//     tipos[],                      // todos os @type encontrados em QUALQUER nível (inclui aninhados: Offer dentro de Product, Question...)
//     contagemPorTipo: { Tipo: n }, // quantas entidades de cada tipo
//     propriedadesPorTipo: { Tipo: { ocorrencias, propriedades[] } }   // união das chaves de primeiro nível (sem as que começam com "@")
//     interesse: { <Tipo de interesse>: { presente, ocorrencias, propriedades[] } }
//   },
//   microdata: { quantidade, tipos[] },   // atributos itemtype
//   rdfa:      { quantidade, tipos[] },   // atributos typeof
//   temJsonLd,                      // jsonld.tipos.length > 0
//   temMicrodata, temRdfa,
//   temDadosEstruturados            // temJsonLd || temMicrodata || temRdfa
// }
// Normalização de tipos: remove o prefixo "https://schema.org/" ou "schema:" ("https://schema.org/Product" -> "Product").
// Subtipos NÃO são resolvidos (Hotel não conta como LocalBusiness).
// Limite conhecido do extrator: cada bloco JSON-LD é cortado em 60000 caracteres e há no máximo 50 blocos;
// bloco cortado costuma virar erro de parse, sinalizado em `possivelTruncamento`.
//
// evidencias: [{ pagina, versao, seletor, trecho, valor, contagem, visivel }]  (visivel=null: itens do <head>/atributos)
export const id = 'jsonld';
export const VERSAO = '1';

export const TIPOS_DE_INTERESSE = ['Article', 'FAQPage', 'LocalBusiness', 'Offer', 'Organization', 'Product', 'VideoObject', 'WebPage', 'WebSite'];
const LIMITE_EXTRATOR = 60000;
const SELETOR_JSONLD = 'script[type="application/ld+json"]';

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordenarPorUrl = (paginas) => [...paginas].sort((a, b) => cmp(a.url, b.url));
const unicosOrdenados = (arr) => [...new Set(arr)].sort(cmp);

export function normalizarTipo(t) {
  return String(t).trim().replace(/^https?:\/\/(www\.)?schema\.org\//i, '').replace(/^schema:/i, '');
}

function coletarEntidades(valor, saida, profundidade = 0) {
  if (profundidade > 60 || valor === null || typeof valor !== 'object') return;
  if (Array.isArray(valor)) { for (const v of valor) coletarEntidades(v, saida, profundidade + 1); return; }
  if ('@type' in valor) {
    const tipos = [].concat(valor['@type']).filter((t) => typeof t === 'string' && t.trim()).map(normalizarTipo);
    const chaves = Object.keys(valor).filter((k) => !k.startsWith('@'));
    for (const tipo of tipos) saida.push({ tipo, chaves });
  }
  for (const v of Object.values(valor)) coletarEntidades(v, saida, profundidade + 1);
}

export function analisarBlocosJsonLd(textos) {
  const entidades = [];
  const erros = [];
  let validos = 0, raizesSemTipo = 0, usaGraph = false;
  (textos || []).forEach((texto, indice) => {
    let json;
    try { json = JSON.parse(texto); } catch (e) {
      erros.push({ indice, erro: String(e.message).slice(0, 200), trecho: String(texto).trim().slice(0, 200), possivelTruncamento: String(texto).length >= LIMITE_EXTRATOR });
      return;
    }
    validos++;
    for (const raiz of [].concat(json)) {
      if (raiz && typeof raiz === 'object' && !Array.isArray(raiz)) {
        if ('@graph' in raiz) usaGraph = true;
        else if (!('@type' in raiz)) raizesSemTipo++;
      }
    }
    coletarEntidades(json, entidades);
  });
  const contagemPorTipo = {};
  const props = {};
  for (const e of entidades) {
    contagemPorTipo[e.tipo] = (contagemPorTipo[e.tipo] || 0) + 1;
    (props[e.tipo] ||= new Set());
    for (const k of e.chaves) props[e.tipo].add(k);
  }
  const tipos = Object.keys(contagemPorTipo).sort(cmp);
  const propriedadesPorTipo = Object.fromEntries(tipos.map((t) => [t, { ocorrencias: contagemPorTipo[t], propriedades: [...props[t]].sort(cmp) }]));
  const interesse = Object.fromEntries(TIPOS_DE_INTERESSE.map((t) => [t, {
    presente: t in contagemPorTipo,
    ocorrencias: contagemPorTipo[t] || 0,
    propriedades: t in props ? [...props[t]].sort(cmp) : [],
  }]));
  return {
    blocos: (textos || []).length,
    blocosValidos: validos,
    erros,
    raizesSemTipo,
    usaGraph,
    tipos,
    contagemPorTipo: Object.fromEntries(tipos.map((t) => [t, contagemPorTipo[t]])),
    propriedadesPorTipo,
    interesse,
  };
}

function tiposDeAtributo(valores) {
  const todos = [];
  for (const v of valores || []) for (const parte of String(v ?? '').split(/\s+/).filter(Boolean)) todos.push(normalizarTipo(parte));
  return todos;
}

function medirVersao(bloco) {
  const extr = bloco && bloco.extr;
  if (!extr) return null;
  const jsonld = analisarBlocosJsonLd(extr.jsonld || []);
  const mdTipos = tiposDeAtributo(extr.microdata);
  const rdTipos = tiposDeAtributo(extr.rdfa);
  const temJsonLd = jsonld.tipos.length > 0;
  const temMicrodata = (extr.microdata || []).length > 0;
  const temRdfa = (extr.rdfa || []).length > 0;
  return {
    jsonld,
    microdata: { quantidade: (extr.microdata || []).length, tipos: unicosOrdenados(mdTipos) },
    rdfa: { quantidade: (extr.rdfa || []).length, tipos: unicosOrdenados(rdTipos) },
    temJsonLd,
    temMicrodata,
    temRdfa,
    temDadosEstruturados: temJsonLd || temMicrodata || temRdfa,
  };
}

// Todos os tipos (JSON-LD + microdata + RDFa) de uma versão.
const todosTipos = (v) => (v ? unicosOrdenados([...v.jsonld.tipos, ...v.microdata.tipos, ...v.rdfa.tipos]) : []);

function evidenciasDaVersao(pagina, versao, v) {
  const ev = [];
  const add = (seletor, trecho, valor, contagem) => ev.push({ pagina, versao, seletor, trecho: String(trecho ?? '').slice(0, 200), valor, contagem, visivel: null });
  add(SELETOR_JSONLD, '', v.jsonld.tipos.join(','), v.jsonld.blocos);
  for (const e of v.jsonld.erros) add(SELETOR_JSONLD, e.trecho, `erro de parse no bloco ${e.indice}: ${e.erro}`, 1);
  for (const t of TIPOS_DE_INTERESSE) {
    const i = v.jsonld.interesse[t];
    if (i.presente) add(SELETOR_JSONLD, `@type=${t}`, i.propriedades.join(','), i.ocorrencias);
  }
  if (v.microdata.quantidade) add('[itemtype]', '', v.microdata.tipos.join(','), v.microdata.quantidade);
  if (v.rdfa.quantidade) add('[typeof]', '', v.rdfa.tipos.join(','), v.rdfa.quantidade);
  return ev;
}

export async function medir(ctx) {
  const paginas = [];
  const evidencias = [];
  for (const p of ordenarPorUrl(ctx.paginas || [])) {
    const caminho = caminhoDe(p.url);
    const cru = medirVersao(p.cru);
    const final = medirVersao(p.final);
    const tCru = todosTipos(cru), tFinal = todosTipos(final);
    paginas.push({
      url: p.url, caminho, cru, final,
      tiposSoNoFinal: tFinal.filter((t) => !tCru.includes(t)),
      tiposSoNoCru: tCru.filter((t) => !tFinal.includes(t)),
      temEmQualquerVersao: !!((cru && cru.temDadosEstruturados) || (final && final.temDadosEstruturados)),
    });
    if (cru) evidencias.push(...evidenciasDaVersao(caminho, 'cru', cru));
    if (final) evidencias.push(...evidenciasDaVersao(caminho, 'final', final));
  }

  const siteVersao = (campo) => {
    const com = paginas.filter((p) => p[campo] && p[campo].temDadosEstruturados);
    return { tipos: unicosOrdenados(paginas.flatMap((p) => todosTipos(p[campo]))), paginasComDados: com.map((p) => p.caminho), temDadosEstruturados: com.length > 0 };
  };
  const sCru = siteVersao('cru'), sFinal = siteVersao('final');
  const site = {
    cru: sCru,
    final: sFinal,
    tiposSoNoFinal: sFinal.tipos.filter((t) => !sCru.tipos.includes(t)),
    tiposSoNoCru: sCru.tipos.filter((t) => !sFinal.tipos.includes(t)),
    paginasSoNoFinal: sFinal.paginasComDados.filter((c) => !sCru.paginasComDados.includes(c)),
    temEmQualquerVersao: sCru.temDadosEstruturados || sFinal.temDadosEstruturados,
    interesse: Object.fromEntries(TIPOS_DE_INTERESSE.map((t) => [t, { cru: sCru.tipos.includes(t), final: sFinal.tipos.includes(t) }])),
  };
  return { id, versao: VERSAO, dados: { tiposDeInteresse: TIPOS_DE_INTERESSE, paginas, site }, evidencias };
}
