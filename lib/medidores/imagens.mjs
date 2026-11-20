// Medidor "imagens": contagens de <img> no HTML CRU e no DOM FINAL (as DUAS contagens são sempre reportadas),
// atributos (loading, alt, width/height, srcset), dobra e peso (bytes das requisições de imagem).
// Só medidas; o conteúdo do site é DADO.
//
// FORMATO DE `dados` (JSON puro; páginas ordenadas por URL):
// {
//   dobraPx: 900,                         // "acima da dobra" = topo da imagem (px a partir do topo do documento) < dobraPx
//   paginas: [{
//     url, caminho,
//     cru:   <contagens>|null,
//     final: <contagens>|null,
//     pesoImagens: <peso>,
//   }],
//   site: { cru: <contagens somadas>, final: <contagens somadas>, pesoImagens: <peso> }
// }
// <contagens> = {
//   total,                  // todos os <img> do documento
//   lazy,                   // loading="lazy"
//   semLoading,             // sem atributo loading
//   eager,                  // loading="eager"
//   loadingOutro,           // qualquer outro valor de loading
//   semAlt,                 // atributo alt AUSENTE (alt === null)
//   altVazio,               // alt=""
//   comLarguraEAltura,      // width e height presentes e não vazios
//   comSrcset,              // srcset no <img> ou <img> dentro de <picture>
//   visiveis,               // visivel === true (inclui clones visíveis)
//   clones,                 // clone === true (carrossel infinito etc.)
//   visiveisNaoClone,       // base das duas contagens de dobra abaixo
//   acimaDaDobraComLazy,    // visíveis não-clone com topo < dobraPx e loading="lazy"
//   abaixoDaDobraSemLazy,   // visíveis não-clone com topo >= dobraPx e loading diferente de "lazy"
//   formatos: { <ext|data:tipo|sem-extensao>: n },
// }
// <peso> = {                // vem de pagina.requisicoes (tipo 'image'); URLs repetidas contam uma vez
//   requisicoes,            // imagens distintas requisitadas pelo navegador (data: URIs não geram requisição)
//   comBytes, semBytes,     // semBytes = resposta sem Content-Length
//   totalBytes,             // soma só das que têm bytes
//   maiores: [{ url, bytes, mime, status }]   // até 5, por bytes desc e URL asc (no site: + paginas[])
//   No site: requisicoes/comBytes/semBytes/maiores contam URLs DISTINTAS; totalBytes é a soma dos totais por página
//   (cada página baixa as suas imagens, então a mesma URL em 2 páginas soma 2 vezes).
// }
//
// evidencias: [{ pagina, versao, seletor, trecho, valor, contagem, visivel }]. Para a lista de problemas de dobra
// há no máximo 50 evidências por página/versão (a contagem completa está em `dados`).
export const id = 'imagens';
export const VERSAO = '1';
export const DOBRA_PX = 900;
export const MAX_EVIDENCIAS_DOBRA = 50;

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordenarPorUrl = (paginas) => [...paginas].sort((a, b) => cmp(a.url, b.url));
const naoVazio = (v) => v !== null && v !== undefined && String(v).trim() !== '';

export function formatoDe(src) {
  const s = String(src ?? '');
  const d = s.match(/^data:image\/([a-z0-9.+-]+)/i);
  if (d) return `data:${d[1].toLowerCase()}`;
  if (s.startsWith('data:')) return 'data:outro';
  let caminho = s;
  try { caminho = new URL(s, 'http://x.invalid/').pathname; } catch { /* usa o texto */ }
  const m = caminho.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : 'sem-extensao';
}

export function contarImagens(imagens) {
  const imgs = imagens || [];
  const vnc = imgs.filter((i) => i.visivel === true && i.clone !== true);
  const formatos = {};
  for (const i of imgs) { const f = formatoDe(i.src); formatos[f] = (formatos[f] || 0) + 1; }
  return {
    total: imgs.length,
    lazy: imgs.filter((i) => i.loading === 'lazy').length,
    semLoading: imgs.filter((i) => i.loading === null || i.loading === undefined).length,
    eager: imgs.filter((i) => i.loading === 'eager').length,
    loadingOutro: imgs.filter((i) => i.loading !== null && i.loading !== undefined && i.loading !== 'lazy' && i.loading !== 'eager').length,
    semAlt: imgs.filter((i) => i.alt === null || i.alt === undefined).length,
    altVazio: imgs.filter((i) => i.alt === '').length,
    comLarguraEAltura: imgs.filter((i) => naoVazio(i.larguraAttr) && naoVazio(i.alturaAttr)).length,
    comSrcset: imgs.filter((i) => i.temSrcset === true).length,
    visiveis: imgs.filter((i) => i.visivel === true).length,
    clones: imgs.filter((i) => i.clone === true).length,
    visiveisNaoClone: vnc.length,
    acimaDaDobraComLazy: vnc.filter((i) => i.topo < DOBRA_PX && i.loading === 'lazy').length,
    abaixoDaDobraSemLazy: vnc.filter((i) => i.topo >= DOBRA_PX && i.loading !== 'lazy').length,
    formatos: Object.fromEntries(Object.keys(formatos).sort(cmp).map((k) => [k, formatos[k]])),
  };
}

const CAMPOS_SOMA = ['total', 'lazy', 'semLoading', 'eager', 'loadingOutro', 'semAlt', 'altVazio', 'comLarguraEAltura', 'comSrcset', 'visiveis', 'clones', 'visiveisNaoClone', 'acimaDaDobraComLazy', 'abaixoDaDobraSemLazy'];
function somar(lista) {
  const r = Object.fromEntries(CAMPOS_SOMA.map((c) => [c, lista.reduce((s, x) => s + x[c], 0)]));
  const formatos = {};
  for (const x of lista) for (const [k, n] of Object.entries(x.formatos)) formatos[k] = (formatos[k] || 0) + n;
  r.formatos = Object.fromEntries(Object.keys(formatos).sort(cmp).map((k) => [k, formatos[k]]));
  return r;
}

const porBytesDescUrlAsc = (a, b) => (b.bytes - a.bytes) || cmp(a.url, b.url);

// Imagens distintas (por URL) de uma lista de requisições; mantém o maior `bytes` conhecido de cada URL.
function imagensDasRequisicoes(requisicoes) {
  const mapa = new Map();
  for (const r of requisicoes || []) {
    if (!r || r.tipo !== 'image' || !r.url) continue;
    const atual = mapa.get(r.url);
    const bytes = Number.isFinite(r.bytes) ? r.bytes : null;
    if (!atual) mapa.set(r.url, { url: r.url, bytes, mime: r.mime || '', status: r.status ?? null });
    else if (bytes !== null && (atual.bytes === null || bytes > atual.bytes)) atual.bytes = bytes;
  }
  return [...mapa.values()];
}

function resumoPeso(lista, comPaginas = null) {
  const comBytes = lista.filter((i) => i.bytes !== null);
  const maiores = [...comBytes].sort(porBytesDescUrlAsc).slice(0, 5).map((i) => {
    const o = { url: i.url, bytes: i.bytes, mime: i.mime, status: i.status };
    if (comPaginas) o.paginas = [...(comPaginas.get(i.url) || [])].sort(cmp);
    return o;
  });
  return { requisicoes: lista.length, comBytes: comBytes.length, semBytes: lista.length - comBytes.length, totalBytes: comBytes.reduce((s, i) => s + i.bytes, 0), maiores };
}

function evidenciasDaVersao(pagina, versao, extr, c) {
  const ev = [];
  const add = (seletor, trecho, valor, contagem, visivel = null) => ev.push({ pagina, versao, seletor, trecho: String(trecho ?? '').slice(0, 200), valor, contagem, visivel });
  add('img', '', c.total, c.total);
  add('img[loading="lazy"]', '', c.lazy, c.lazy);
  add('img[loading="eager"]', '', c.eager, c.eager);
  add('img:not([loading])', '', c.semLoading, c.semLoading);
  add('img:not([alt])', '', c.semAlt, c.semAlt);
  add('img[alt=""]', '', c.altVazio, c.altVazio);
  let n = 0;
  for (const i of extr.imagens || []) {
    if (n >= MAX_EVIDENCIAS_DOBRA) break;
    if (i.visivel === true && i.clone !== true && i.topo < DOBRA_PX && i.loading === 'lazy') { add(i.seletor, i.src, `acima-da-dobra-com-lazy topo=${i.topo}`, 1, true); n++; }
  }
  n = 0;
  for (const i of extr.imagens || []) {
    if (n >= MAX_EVIDENCIAS_DOBRA) break;
    if (i.visivel === true && i.clone !== true && i.topo >= DOBRA_PX && i.loading !== 'lazy') { add(i.seletor, i.src, `abaixo-da-dobra-sem-lazy topo=${i.topo}`, 1, true); n++; }
  }
  return ev;
}

export async function medir(ctx) {
  const paginas = [];
  const evidencias = [];
  const todasImagens = [];
  const paginasPorUrl = new Map();
  for (const p of ordenarPorUrl(ctx.paginas || [])) {
    const caminho = caminhoDe(p.url);
    const exCru = p.cru && p.cru.extr, exFinal = p.final && p.final.extr;
    const cru = exCru ? contarImagens(exCru.imagens) : null;
    const final = exFinal ? contarImagens(exFinal.imagens) : null;
    const imgsReq = imagensDasRequisicoes(p.requisicoes);
    for (const i of imgsReq) {
      todasImagens.push(i);
      if (!paginasPorUrl.has(i.url)) paginasPorUrl.set(i.url, new Set());
      paginasPorUrl.get(i.url).add(caminho);
    }
    const pesoImagens = resumoPeso(imgsReq);
    paginas.push({ url: p.url, caminho, cru, final, pesoImagens });
    if (cru) evidencias.push(...evidenciasDaVersao(caminho, 'cru', exCru, cru));
    if (final) evidencias.push(...evidenciasDaVersao(caminho, 'final', exFinal, final));
    for (const i of pesoImagens.maiores) evidencias.push({ pagina: caminho, versao: 'final', seletor: 'img', trecho: i.url.slice(0, 200), valor: i.bytes, contagem: 1, visivel: null });
  }

  // site: soma por página (cada página baixa as suas imagens); maiores = por URL distinta, maior bytes conhecido
  const distintas = new Map();
  for (const i of todasImagens) {
    const a = distintas.get(i.url);
    if (!a) distintas.set(i.url, { ...i });
    else if (i.bytes !== null && (a.bytes === null || i.bytes > a.bytes)) a.bytes = i.bytes;
  }
  const pesoSite = resumoPeso([...distintas.values()], paginasPorUrl);
  pesoSite.totalBytes = paginas.reduce((s, p) => s + p.pesoImagens.totalBytes, 0); // soma por página (download repetido por página)
  const site = {
    cru: somar(paginas.map((p) => p.cru).filter(Boolean)),
    final: somar(paginas.map((p) => p.final).filter(Boolean)),
    pesoImagens: pesoSite,
  };
  return { id, versao: VERSAO, dados: { dobraPx: DOBRA_PX, paginas, site }, evidencias };
}
