// Medidor "seo": sinais técnicos de SEO por página e do site. SÓ MEDIDAS: nada de "bom/ruim".
// Mede no HTML CRU e no DOM FINAL (o que o visitante vê); o conteúdo do site é DADO.
//
// FORMATO DE `dados` (JSON puro; páginas ordenadas por URL):
// {
//   paginas: [{
//     url, caminho,
//     status,                       // status HTTP da resposta crua (cru.status)
//     statusNavegador,              // status visto pelo navegador (nav.status) ou null
//     urlFinal, redirecionou,       // urlFinal = URL depois do carregamento; redirecionou = urlFinal diferente de url
//     xRobotsTag, noindexNoCabecalho,   // cabeçalho X-Robots-Tag da resposta crua
//     urlAmigavel: { profundidade, segmentos[], parametros[] (nomes, ordenados), quantidadeParametros, comprimento,
//                    temMaiusculas, temUnderscore, temEspacoCodificado, extensao|null },
//     cru:   <versao>|null,
//     final: <versao>|null,
//   }],
//   site: {
//     origem,
//     resumo: { paginas, status: {"200": n, ...}, redirecionadas,
//               semTitle, semDescription, semH1, variosH1, comNoindex, semCanonical, canonicalApontaParaOutra,
//               imagensSemAlt, palavrasVisiveis: {min, max, total} },          // sobre o DOM final
//     duplicados: { cru: {titulos:[...], descricoes:[...]}, final: {titulos:[...], descricoes:[...]} },
//                 // cada item: { texto, paginas:[caminhos ordenados] } só quando 2+ páginas têm o MESMO texto normalizado
//     sitemap: { url, status, presente, bytes, tipoMime, erro, tipo: 'urlset'|'sitemapindex'|'desconhecido'|null,
//                quantidade, locsAmostra[], paginasAmostradas:[{caminho, listadaNoSitemap: true|false|null}] },
//     robotsTxt: { url, status, presente, bytes, tipoMime, erro, reconhecido, linhas, sitemapsDeclarados[] },
//   }
// }
// <versao> = {
//   titulo:     { presente, texto, comprimento },
//   descricao:  { presente, quantidade, texto, comprimento },
//   h1:         { visiveisNaoClone, total, textos[], seletores[] },      // contagem 0 / 1 / vários = visiveisNaoClone
//   canonical:  { presente, quantidade, href, absoluto, apontaPara: 'si'|'outra'|null },
//   robotsMeta: { presente, metas:[{nome, conteudo}], noindex, nofollow },   // noindex: token noindex ou none
//   hreflang:   [{ hreflang, href }],  (ordenado por hreflang, href)  + hreflangXDefault: boolean
//   imagens:    { total, semAlt (atributo alt ausente), altVazio, semAltVisiveisNaoClone },
//   links:      { visiveisNaoClone, internos, externos, outros (mailto:, tel:...), internosUnicos, externosUnicos },
//   palavrasVisiveis, nosTruncados,   // palavras nos nós visíveis não-clone; nosTruncados = nós que o extrator cortou (600 caracteres)
// }
// Rede: faz HTTP via buscarSeguro (anti-SSRF) só para /sitemap.xml e /robots.txt da origem (timeout 8 s, nunca lança exceção);
// por isso o servidor do site (ou a rede) precisa estar acessível quando o medidor roda.
// Limite conhecido: o extrator corta o texto de cada nó em 600 caracteres e em 6000 nós; `nosTruncados` e
// `nosNoLimite` avisam quando a contagem de palavras pode estar subestimada.
//
// evidencias: [{ pagina, versao, seletor, trecho, valor, contagem, visivel }]
import { buscarSeguro } from '../rede-segura.mjs';
import { normalizarTexto, normalizarUrl, decodificarEntidades } from '../util.mjs';

export const id = 'seo';
export const VERSAO = '1';
export const TIMEOUT_ARQUIVOS_MS = 8000;
const MAX_BYTES_ARQUIVO = 2 * 1024 * 1024;

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const ehVisivel = (x) => x.visivel === true && x.clone !== true;
const compr = (s) => [...String(s ?? '')].length;
const tokens = (s) => String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordenarPorUrl = (paginas) => [...paginas].sort((a, b) => cmp(a.url, b.url));
const semHash = (url) => { try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return String(url); } };

function resolverUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

export function analisarUrlAmigavel(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const segmentos = u.pathname.split('/').filter(Boolean);
  const ultimo = segmentos.length ? segmentos[segmentos.length - 1] : '';
  const ext = (ultimo.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
  const parametros = [...new Set([...u.searchParams.keys()])].sort();
  return {
    profundidade: segmentos.length,
    segmentos,
    parametros,
    quantidadeParametros: [...u.searchParams.keys()].length,
    comprimento: url.length,
    temMaiusculas: /[A-Z]/.test(u.pathname),
    temUnderscore: u.pathname.includes('_'),
    temEspacoCodificado: /%20|\+/.test(u.pathname),
    extensao: ext ? ext.toLowerCase() : null,
  };
}

export function analisarSitemapXml(xml) {
  const texto = String(xml ?? '');
  const tipo = /<sitemapindex[\s>]/i.test(texto) ? 'sitemapindex' : /<urlset[\s>]/i.test(texto) ? 'urlset' : 'desconhecido';
  const locs = [];
  for (const m of texto.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)) locs.push(decodificarEntidades(m[1]));
  return { tipo, locs };
}

async function buscarArquivo(ctx, caminho) {
  const url = new URL(caminho, ctx.site.origem).toString();
  const base = { url, status: null, presente: false, bytes: null, tipoMime: null, erro: null };
  try {
    const r = await buscarSeguro(url, { timeoutMs: TIMEOUT_ARQUIVOS_MS, maxBytes: MAX_BYTES_ARQUIVO, permitidos: ctx.rede?.permitidos || [], permitirLocal: !!ctx.rede?.permitirLocal });
    return { ...base, status: r.status, presente: r.status >= 200 && r.status < 300, bytes: r.corpo.length, tipoMime: String(r.cabecalhos['content-type'] || ''), texto: r.texto() };
  } catch (e) {
    return { ...base, erro: String(e.message || e).slice(0, 200) };
  }
}

function medirVersao(p, versao) {
  const bloco = p[versao];
  const extr = bloco && bloco.extr;
  if (!extr) return null;
  const metas = extr.metas || [];
  const linksHead = extr.linksHead || [];
  const base = versao === 'cru' ? (p.cru.urlFinal || p.url) : (extr.url || p.url);

  const descs = metas.filter((m) => (m.nome || '').toLowerCase() === 'description');
  const canonicais = linksHead.filter((l) => tokens(l.rel).includes('canonical'));
  const canHref = canonicais.length ? canonicais[0].href : null;
  const canAbs = canHref ? resolverUrl(canHref, base) : null;
  let apontaPara = null;
  if (canAbs) {
    const a = normalizarUrl(canAbs);
    const alvos = [normalizarUrl(base), normalizarUrl(p.url)].filter(Boolean);
    apontaPara = a && alvos.includes(a) ? 'si' : 'outra';
  }

  const robotsMetas = metas.filter((m) => ['robots', 'googlebot', 'bingbot'].includes((m.nome || '').toLowerCase()))
    .map((m) => ({ nome: m.nome.toLowerCase(), conteudo: m.conteudo ?? '' }));
  const dirs = robotsMetas.flatMap((m) => m.conteudo.toLowerCase().split(/[,\s]+/).filter(Boolean));

  const hreflang = linksHead.filter((l) => tokens(l.rel).includes('alternate') && l.hreflang)
    .map((l) => ({ hreflang: l.hreflang, href: l.href }))
    .sort((a, b) => cmp(a.hreflang, b.hreflang) || cmp(String(a.href), String(b.href)));

  const hs = extr.headings || [];
  const h1Vis = hs.filter((h) => h.nivel === 1 && ehVisivel(h));

  const imgs = extr.imagens || [];
  const links = (extr.links || []).filter(ehVisivel);
  let internos = 0, externos = 0, outros = 0;
  const internosU = new Set(), externosU = new Set();
  for (const l of links) {
    let proto = '';
    try { proto = new URL(l.href).protocol; } catch { /* href estranho */ }
    if (proto !== 'http:' && proto !== 'https:') { outros++; continue; }
    if (l.interno) { internos++; internosU.add(semHash(l.href)); } else { externos++; externosU.add(semHash(l.href)); }
  }

  const nos = extr.nos || [];
  const nosVis = nos.filter(ehVisivel);
  const palavras = nosVis.reduce((soma, n) => soma + String(n.texto || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);

  return {
    titulo: { presente: !!extr.titulo, texto: extr.titulo || '', comprimento: compr(extr.titulo) },
    descricao: { presente: descs.length > 0, quantidade: descs.length, texto: descs.length ? (descs[0].conteudo ?? '') : '', comprimento: descs.length ? compr(descs[0].conteudo) : 0 },
    h1: { visiveisNaoClone: h1Vis.length, total: hs.filter((h) => h.nivel === 1).length, textos: h1Vis.map((h) => h.texto), seletores: h1Vis.map((h) => h.seletor) },
    canonical: { presente: canonicais.length > 0, quantidade: canonicais.length, href: canHref, absoluto: canAbs, apontaPara },
    robotsMeta: { presente: robotsMetas.length > 0, metas: robotsMetas, noindex: dirs.includes('noindex') || dirs.includes('none'), nofollow: dirs.includes('nofollow') || dirs.includes('none') },
    hreflang,
    hreflangXDefault: hreflang.some((h) => h.hreflang.toLowerCase() === 'x-default'),
    imagens: {
      total: imgs.length,
      semAlt: imgs.filter((i) => i.alt === null).length,
      altVazio: imgs.filter((i) => i.alt === '').length,
      semAltVisiveisNaoClone: imgs.filter((i) => i.alt === null && ehVisivel(i)).length,
    },
    links: { visiveisNaoClone: links.length, internos, externos, outros, internosUnicos: internosU.size, externosUnicos: externosU.size },
    palavrasVisiveis: palavras,
    nosTruncados: nosVis.filter((n) => String(n.texto || '').length >= 600).length,
    nosNoLimite: nos.length >= 6000,
  };
}

function duplicados(paginas, versao, campo) {
  const grupos = new Map();
  for (const p of paginas) {
    const v = p[versao];
    if (!v || !v[campo].presente) continue;
    const chave = normalizarTexto(v[campo].texto);
    if (!chave) continue;
    if (!grupos.has(chave)) grupos.set(chave, { texto: v[campo].texto, paginas: [] });
    grupos.get(chave).paginas.push(p.caminho);
  }
  return [...grupos.values()].filter((g) => g.paginas.length >= 2)
    .map((g) => ({ texto: g.texto, paginas: [...g.paginas].sort(cmp) }))
    .sort((a, b) => cmp(a.texto, b.texto));
}

function evidenciasDaVersao(pagina, versao, v) {
  const ev = [];
  const add = (seletor, trecho, valor, contagem, visivel = null) => ev.push({ pagina, versao, seletor, trecho: String(trecho ?? '').slice(0, 200), valor, contagem, visivel });
  add('title', v.titulo.texto, v.titulo.comprimento, v.titulo.presente ? 1 : 0);
  add('meta[name="description"]', v.descricao.texto, v.descricao.comprimento, v.descricao.quantidade);
  add(v.h1.seletores.length ? v.h1.seletores.join(', ') : 'h1', v.h1.textos.join(' | '), v.h1.visiveisNaoClone, v.h1.visiveisNaoClone, v.h1.visiveisNaoClone > 0 ? true : null);
  add('link[rel="canonical"]', v.canonical.href ?? '', v.canonical.apontaPara, v.canonical.quantidade);
  add('meta[name="robots"]', v.robotsMeta.metas.map((m) => `${m.nome}: ${m.conteudo}`).join('; '), v.robotsMeta.noindex ? 'noindex' : null, v.robotsMeta.metas.length);
  add('link[rel="alternate"][hreflang]', v.hreflang.map((h) => h.hreflang).join(','), v.hreflang.length, v.hreflang.length);
  add('img:not([alt])', '', v.imagens.semAlt, v.imagens.semAlt);
  add('a[href]', '', `internos=${v.links.internos};externos=${v.links.externos};outros=${v.links.outros}`, v.links.internos + v.links.externos + v.links.outros);
  add('body', '', v.palavrasVisiveis, v.palavrasVisiveis, true);
  return ev;
}

export async function medir(ctx) {
  const ordenadas = ordenarPorUrl(ctx.paginas || []);
  const evidencias = [];
  const paginas = [];
  for (const p of ordenadas) {
    const caminho = caminhoDe(p.url);
    const cab = (p.cru && p.cru.cabecalhos) || {};
    const xrobots = cab['x-robots-tag'] ?? null;
    const urlFinal = (p.final && p.final.extr && p.final.extr.url) || (p.nav && p.nav.urlFinal) || p.url;
    const pagina = {
      url: p.url,
      caminho,
      status: p.cru ? p.cru.status : null,
      statusNavegador: p.nav ? p.nav.status : null,
      urlFinal,
      redirecionou: normalizarUrl(urlFinal) !== normalizarUrl(p.url),
      xRobotsTag: xrobots,
      noindexNoCabecalho: xrobots ? /(^|[,\s])(noindex|none)([,\s]|$)/i.test(String(xrobots)) : false,
      urlAmigavel: analisarUrlAmigavel(p.url),
      cru: medirVersao(p, 'cru'),
      final: medirVersao(p, 'final'),
    };
    paginas.push(pagina);
    evidencias.push({ pagina: caminho, versao: 'cru', seletor: 'resposta-http', trecho: '', valor: pagina.status, contagem: 1, visivel: null });
    if (pagina.cru) evidencias.push(...evidenciasDaVersao(caminho, 'cru', pagina.cru));
    if (pagina.final) evidencias.push(...evidenciasDaVersao(caminho, 'final', pagina.final));
  }

  const dupl = {
    cru: { titulos: duplicados(paginas, 'cru', 'titulo'), descricoes: duplicados(paginas, 'cru', 'descricao') },
    final: { titulos: duplicados(paginas, 'final', 'titulo'), descricoes: duplicados(paginas, 'final', 'descricao') },
  };
  for (const [campo, lista] of [['title', dupl.final.titulos], ['meta[name="description"]', dupl.final.descricoes]]) {
    for (const g of lista) for (const c of g.paginas) evidencias.push({ pagina: c, versao: 'final', seletor: campo, trecho: g.texto.slice(0, 200), valor: 'duplicado', contagem: g.paginas.length, visivel: null });
  }

  // sitemap.xml e robots.txt (HTTP seguro; nunca lança)
  const sm = await buscarArquivo(ctx, '/sitemap.xml');
  const rb = await buscarArquivo(ctx, '/robots.txt');
  let analise = null;
  if (sm.presente) analise = analisarSitemapXml(sm.texto);
  const locsAbs = analise ? analise.locs.map((l) => normalizarUrl(l, sm.url)).filter(Boolean) : [];
  const sitemap = {
    url: sm.url, status: sm.status, presente: sm.presente, bytes: sm.bytes, tipoMime: sm.tipoMime, erro: sm.erro,
    tipo: analise ? analise.tipo : null,
    quantidade: analise ? analise.locs.length : 0,
    locsAmostra: analise ? analise.locs.slice(0, 10) : [],
    paginasAmostradas: paginas.map((p) => ({ caminho: p.caminho, listadaNoSitemap: analise && analise.tipo === 'urlset' ? locsAbs.includes(normalizarUrl(p.url)) : null })),
  };
  const linhasRobots = rb.presente ? rb.texto.split(/\r?\n/) : [];
  const robotsTxt = {
    url: rb.url, status: rb.status, presente: rb.presente, bytes: rb.bytes, tipoMime: rb.tipoMime, erro: rb.erro,
    reconhecido: rb.presente ? linhasRobots.some((l) => /^\s*(user-agent|disallow|allow|sitemap)\s*:/i.test(l)) : false,
    linhas: linhasRobots.filter((l) => l.trim()).length,
    sitemapsDeclarados: linhasRobots.map((l) => (l.match(/^\s*sitemap\s*:\s*(\S+)/i) || [])[1]).filter(Boolean),
  };
  evidencias.push({ pagina: '/', versao: 'cru', seletor: '/sitemap.xml', trecho: '', valor: sm.status ?? sm.erro, contagem: sitemap.quantidade, visivel: null });
  evidencias.push({ pagina: '/', versao: 'cru', seletor: '/robots.txt', trecho: '', valor: rb.status ?? rb.erro, contagem: robotsTxt.linhas, visivel: null });

  const finais = paginas.map((p) => p.final).filter(Boolean);
  const statusContagem = {};
  for (const p of paginas) { const k = String(p.status); statusContagem[k] = (statusContagem[k] || 0) + 1; }
  const palavras = finais.map((v) => v.palavrasVisiveis);
  const resumo = {
    paginas: paginas.length,
    status: Object.fromEntries(Object.keys(statusContagem).sort().map((k) => [k, statusContagem[k]])),
    redirecionadas: paginas.filter((p) => p.redirecionou).length,
    semTitle: finais.filter((v) => !v.titulo.presente).length,
    semDescription: finais.filter((v) => !v.descricao.presente).length,
    semH1: finais.filter((v) => v.h1.visiveisNaoClone === 0).length,
    variosH1: finais.filter((v) => v.h1.visiveisNaoClone > 1).length,
    comNoindex: paginas.filter((p) => (p.final && p.final.robotsMeta.noindex) || p.noindexNoCabecalho).length,
    semCanonical: finais.filter((v) => !v.canonical.presente).length,
    canonicalApontaParaOutra: finais.filter((v) => v.canonical.apontaPara === 'outra').length,
    imagensSemAlt: finais.reduce((s, v) => s + v.imagens.semAlt, 0),
    palavrasVisiveis: { min: palavras.length ? Math.min(...palavras) : 0, max: palavras.length ? Math.max(...palavras) : 0, total: palavras.reduce((s, n) => s + n, 0) },
  };

  return { id, versao: VERSAO, dados: { paginas, site: { origem: ctx.site.origem, resumo, duplicados: dupl, sitemap, robotsTxt } }, evidencias };
}
