// Medidor "html": estrutura e metadados do HTML de cada página, medidos no HTML CRU e no DOM FINAL.
// Só mede (fatos); nenhuma opinião de "bom/ruim". O conteúdo do site é DADO.
//
// FORMATO DE `dados` (JSON puro, listas ordenadas; páginas ordenadas por URL):
// {
//   resumo: { paginas, semTitle, semDescription, semLang, semViewport, semCanonical, semH1, variosH1, semMain }   // sobre o DOM final
//   paginas: [{
//     url, caminho, status,                      // status = status HTTP da resposta crua
//     cru:   <versao>|null,                      // null se a extração da versão falhou
//     final: <versao>|null,
//   }]
// }
// <versao> = {
//   titulo:      { presente, tagsNoHead, texto, comprimento },          // comprimento em caracteres (code points)
//   descricao:   { presente, quantidade, texto, comprimento },          // <meta name="description">
//   lang:        { presente, valor, vazio },                            // atributo lang do <html> (presente=false => AUSENTE)
//   viewport:    { presente, valor },
//   charset:     { meta, httpEquiv, cabecalhoHttp },                    // cabecalhoHttp só existe no cru
//   doctype:     string|null,
//   canonical:   { presente, quantidade, href, hrefAbsoluto },
//   og:          { 'og:title': [valores], ... },                        // chaves ordenadas
//   twitter:     { 'twitter:card': [valores], ... },
//   favicons:    [{ rel, href, tipo }],                                 // rel icon / shortcut icon / apple-touch-icon / mask-icon, ordenado por href
//   headings: {
//     total: {h1..h6}, visiveisNaoClone: {h1..h6},
//     h1VisiveisNaoClone: [{ texto, seletor }], h1Total, h1Ocultos, h1Clones,
//     sequenciaNiveis: [números, em ordem de documento, só visíveis não-clone],
//     primeiroNivel: número|null,
//     saltos: [{ de, para, texto, seletor }],                             // quando o nível sobe mais de 1 de uma vez
//     vazios: número                                                       // headings visíveis não-clone sem texto
//   },
//   landmarks:   { tags: {header, nav, main, footer, aside}, roles: {banner, navigation, main, contentinfo, complementary, search} },
//                // contagem pelo texto do HTML (sem comentários/script/style); "header/footer" dentro de article/section
//                // não são landmarks banner/contentinfo, mas aqui só se CONTA a tag.
//   bytesHtml:   número,                                                 // cru: tamanho da resposta; final: bytes UTF-8 do DOM serializado
//   totalElementos: número,                                              // document.getElementsByTagName('*').length
//   nos:         { total, visiveisNaoClone, ocultos, clones },           // nós de texto do extrator
// }
//
// evidencias: [{ pagina, versao, seletor, trecho, valor, contagem, visivel }]  (visivel=null para itens do <head>)
import { removerBlocos } from '../util.mjs';

export const id = 'html';
export const VERSAO = '1';

const NIVEIS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const TAGS_LANDMARK = ['header', 'nav', 'main', 'footer', 'aside'];
const RELS_ICONE = ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'];
const ROLES_LANDMARK =['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search'];

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const ehVisivel = (x) => x.visivel === true && x.clone !== true;
const compr = (s) => [...String(s ?? '')].length;
const tokens = (s) => String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const ordenarPorUrl = (paginas) => [...paginas].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

function limparHtml(html) {
  // remoção LINEAR (entrada não confiável): regex com [\s\S]*? tem custo quadrático em HTML malicioso
  let h = String(html ?? '');
  h = removerBlocos(h, '<!--', '-->');
  h = removerBlocos(h, '<script', '</script');
  h = removerBlocos(h, '<style', '</style');
  return removerBlocos(h, '<template', '</template');
}
const contarTag = (html, tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])`, 'gi')) || []).length;
const contarRole = (html, role) => (html.match(new RegExp(`\\srole\\s*=\\s*["']?${role}(?=["'\\s>/])`, 'gi')) || []).length;

function agruparPrefixo(metas, prefixo) {
  const mapa = {};
  for (const m of metas) {
    for (const chave of [m.propriedade, m.nome]) {
      if (chave && chave.toLowerCase().startsWith(prefixo)) {
        const k = chave.toLowerCase();
        (mapa[k] ||= []).push(m.conteudo ?? '');
      }
    }
  }
  return Object.fromEntries(Object.keys(mapa).sort().map((k) => [k, mapa[k]]));
}

function contagemPorNivel(lista) {
  const o = {};
  for (const n of NIVEIS) o[n] = lista.filter((h) => h.nivel === Number(n[1])).length;
  return o;
}

function resolverUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function medirVersao(p, versao) {
  const bloco = p[versao];
  const extr = bloco && bloco.extr;
  if (!extr) return null;
  const html = bloco.html ?? '';
  const limpo = limparHtml(html);
  const head = limpo.split(/<\/head\s*>/i)[0];
  const metas = extr.metas || [];
  const linksHead = extr.linksHead || [];
  const base = versao === 'cru' ? (p.cru.urlFinal || p.url) : (extr.url || p.url);

  const descs = metas.filter((m) => (m.nome || '').toLowerCase() === 'description');
  const charsetMeta = metas.find((m) => m.charset);
  const httpEquivCt = metas.find((m) => (m.httpEquiv || '').toLowerCase() === 'content-type');
  const ctCab = versao === 'cru' ? String((p.cru.cabecalhos || {})['content-type'] || '') : '';
  const cabCharset = (ctCab.match(/charset=([^;\s]+)/i) || [])[1] || null;
  const metaCharsetHttpEquiv = httpEquivCt ? ((String(httpEquivCt.conteudo || '').match(/charset=([^;\s]+)/i) || [])[1] || null) : null;

  const canonicais = linksHead.filter((l) => tokens(l.rel).includes('canonical'));
  const favicons = linksHead.filter((l) => tokens(l.rel).some((t) => RELS_ICONE.includes(t))).map((l) => ({ rel: l.rel, href: l.href, tipo: l.tipo }))
    .sort((a, b) => (String(a.href) < String(b.href) ? -1 : String(a.href) > String(b.href) ? 1 : 0));

  const hs = extr.headings || [];
  const vis = hs.filter(ehVisivel);
  const saltos = [];
  let anterior = null;
  for (const h of vis) {
    if (anterior !== null && h.nivel > anterior + 1) saltos.push({ de: anterior, para: h.nivel, texto: h.texto, seletor: h.seletor });
    anterior = h.nivel;
  }
  const h1s = hs.filter((h) => h.nivel === 1);

  const nos = extr.nos || [];
  const langPresente = extr.lang !== null && extr.lang !== undefined;

  return {
    titulo: { presente: !!extr.titulo, tagsNoHead: contarTag(head, 'title'), texto: extr.titulo || '', comprimento: compr(extr.titulo) },
    descricao: { presente: descs.length > 0, quantidade: descs.length, texto: descs.length ? (descs[0].conteudo ?? '') : '', comprimento: descs.length ? compr(descs[0].conteudo) : 0 },
    lang: { presente: langPresente, valor: langPresente ? extr.lang : null, vazio: langPresente && extr.lang.trim() === '' },
    viewport: { presente: extr.viewportMeta !== null && extr.viewportMeta !== undefined, valor: extr.viewportMeta ?? null },
    charset: { meta: charsetMeta ? charsetMeta.charset : null, httpEquiv: metaCharsetHttpEquiv, cabecalhoHttp: cabCharset },
    doctype: extr.doctype ?? null,
    canonical: {
      presente: canonicais.length > 0,
      quantidade: canonicais.length,
      href: canonicais.length ? canonicais[0].href : null,
      hrefAbsoluto: canonicais.length && canonicais[0].href ? resolverUrl(canonicais[0].href, base) : null,
    },
    og: agruparPrefixo(metas, 'og:'),
    twitter: agruparPrefixo(metas, 'twitter:'),
    favicons,
    headings: {
      total: contagemPorNivel(hs),
      visiveisNaoClone: contagemPorNivel(vis),
      h1VisiveisNaoClone: vis.filter((h) => h.nivel === 1).map((h) => ({ texto: h.texto, seletor: h.seletor })),
      h1Total: h1s.length,
      h1Ocultos: h1s.filter((h) => !h.visivel).length,
      h1Clones: h1s.filter((h) => h.clone).length,
      sequenciaNiveis: vis.map((h) => h.nivel),
      primeiroNivel: vis.length ? vis[0].nivel : null,
      saltos,
      vazios: vis.filter((h) => !h.texto).length,
    },
    landmarks: {
      tags: Object.fromEntries(TAGS_LANDMARK.map((t) => [t, contarTag(limpo, t)])),
      roles: Object.fromEntries(ROLES_LANDMARK.map((r) => [r, contarRole(limpo, r)])),
    },
    bytesHtml: versao === 'cru' && Number.isFinite(bloco.bytes) ? bloco.bytes : Buffer.byteLength(html, 'utf8'),
    totalElementos: extr.totalElementos ?? null,
    nos: {
      total: nos.length,
      visiveisNaoClone: nos.filter(ehVisivel).length,
      ocultos: nos.filter((n) => !n.visivel).length,
      clones: nos.filter((n) => n.clone).length,
    },
  };
}

function evidenciasDaVersao(pagina, versao, v) {
  const ev = [];
  const add = (seletor, trecho, valor, contagem, visivel = null) => ev.push({ pagina, versao, seletor, trecho: String(trecho ?? '').slice(0, 200), valor, contagem, visivel });
  add('title', v.titulo.texto, v.titulo.comprimento, v.titulo.presente ? 1 : 0);
  add('meta[name="description"]', v.descricao.texto, v.descricao.comprimento, v.descricao.quantidade);
  add('html', v.lang.valor ?? '', v.lang.presente ? v.lang.valor : null, v.lang.presente ? 1 : 0);
  add('meta[name="viewport"]', v.viewport.valor ?? '', v.viewport.valor, v.viewport.presente ? 1 : 0);
  add('link[rel="canonical"]', v.canonical.href ?? '', v.canonical.hrefAbsoluto, v.canonical.quantidade);
  for (const h of v.headings.h1VisiveisNaoClone) add(h.seletor, h.texto, 'h1 visível', 1, true);
  for (const s of v.headings.saltos) add(s.seletor, s.texto, `h${s.de} -> h${s.para}`, 1, true);
  for (const t of TAGS_LANDMARK) add(t, '', v.landmarks.tags[t], v.landmarks.tags[t]);
  return ev;
}

export async function medir(ctx) {
  const paginas = [];
  const evidencias = [];
  for (const p of ordenarPorUrl(ctx.paginas || [])) {
    const caminho = caminhoDe(p.url);
    const cru = medirVersao(p, 'cru');
    const final = medirVersao(p, 'final');
    paginas.push({ url: p.url, caminho, status: p.cru ? p.cru.status : null, cru, final });
    if (cru) evidencias.push(...evidenciasDaVersao(caminho, 'cru', cru));
    if (final) evidencias.push(...evidenciasDaVersao(caminho, 'final', final));
  }
  const finais = paginas.map((p) => p.final).filter(Boolean);
  const resumo = {
    paginas: paginas.length,
    semTitle: finais.filter((v) => !v.titulo.presente).length,
    semDescription: finais.filter((v) => !v.descricao.presente).length,
    semLang: finais.filter((v) => !v.lang.presente).length,
    semViewport: finais.filter((v) => !v.viewport.presente).length,
    semCanonical: finais.filter((v) => !v.canonical.presente).length,
    semH1: finais.filter((v) => v.headings.h1VisiveisNaoClone.length === 0).length,
    variosH1: finais.filter((v) => v.headings.h1VisiveisNaoClone.length > 1).length,
    semMain: finais.filter((v) => v.landmarks.tags.main === 0 && v.landmarks.roles.main === 0).length,
  };
  return { id, versao: VERSAO, dados: { resumo, paginas }, evidencias };
}
