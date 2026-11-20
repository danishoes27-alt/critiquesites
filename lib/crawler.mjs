// Descoberta e amostragem de páginas. Só usa HTTP "cru" (buscarSeguro): barato e sem executar JavaScript.
// Para SPAs (sem links no HTML cru) o chamador pode passar `linksExtras` vindos do DOM final da home.
import { buscarSeguro, UA } from './rede-segura.mjs';
import { parseRobots, podeRastrear } from './robots.mjs';
import { normalizarUrl, esperar } from './util.mjs';

const LEGAIS = /(privacidad|privacy|politica|termos|terms|cookies|lgpd|contato|contact|sobre|about|quem-somos|trocas|devolu|entrega|frete)/i;

// Padrão de URL para agrupar "iguais": dígitos viram #, último segmento tipo slug vira :slug.
export function padraoDeUrl(url) {
  const u = new URL(url);
  const segs = u.pathname.split('/').filter(Boolean).map((s) => s.replace(/\.(html?|php|aspx?)$/i, '').replace(/\d+/g, '#'));
  if (segs.length) {
    const ult = segs[segs.length - 1];
    if ((ult.match(/-/g) || []).length >= 2) segs[segs.length - 1] = ':slug';
  }
  return '/' + segs.join('/');
}

export function extrairLinksDoHtml(html, base) {
  // Varredura LINEAR: pega cada "<a" e olha só os primeiros 2000 caracteres até o primeiro ">" (HTML não confiável).
  const achados = new Set();
  const re = /href\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/i;
  const texto = String(html);
  const baixo = texto.toLowerCase();
  let pos = 0;
  let visitadas = 0;
  while (visitadas < 30000) {
    const i = baixo.indexOf('<a', pos);
    if (i < 0) break;
    pos = i + 2;
    if (!/\s/.test(baixo[i + 2] ?? '')) continue;
    visitadas++;
    const janela = texto.slice(i, i + 2500); // trabalho limitado por âncora
    const fim = janela.indexOf('>');
    const m = re.exec(fim < 0 ? janela : janela.slice(0, fim));
    if (!m) continue;
    const bruto = (m[1] ?? m[2] ?? '').trim();
    if (bruto.startsWith('#')) continue; // âncora da própria página
    const url = normalizarUrl(bruto, base);
    if (url) achados.add(url);
  }
  return [...achados];
}

async function lerSitemap(url, opcoesRede, limite, profundidade = 0, saida = new Set()) {
  if (saida.size >= limite || profundidade > 1) return saida;
  try {
    const r = await buscarSeguro(url, { ...opcoesRede, maxBytes: 3 * 1024 * 1024 });
    if (r.status !== 200) return saida;
    const xml = r.texto();
    const locs = [...xml.matchAll(/<loc>([^<]{1,2000})<\/loc>/gi)].slice(0, 5000).map((m) => m[1].trim());
    if (/<sitemapindex/i.test(xml)) {
      for (const sub of locs.slice(0, 5)) await lerSitemap(new URL(sub, url).toString(), opcoesRede, limite, profundidade + 1, saida);
    } else {
      for (const l of locs) { const n = normalizarUrl(l, url); if (n) saida.add(n); if (saida.size >= limite) break; }
    }
  } catch { /* sitemap ausente ou bloqueado: segue sem */ }
  return saida;
}

export async function descobrirPaginas(urlInicial, {
  modo = 'rapido', limitePaginas = null, intervaloMs = 1000, respeitarRobots = true, tempoTotalMs = null,
  permitidos = [], permitirLocal = false, linksExtras = [], timeoutMs = 15000,
} = {}) {
  const limite = limitePaginas ?? (modo === 'completo' ? 30 : 8);
  const prazo = Date.now() + (tempoTotalMs ?? (modo === 'completo' ? 10 * 60000 : 4 * 60000));
  const inicial = normalizarUrl(urlInicial);
  if (!inicial) throw new Error('URL inicial inválida');
  const origem = new URL(inicial).origin;
  const hostInicial = new URL(inicial).host;
  const rede = { permitidos, permitirLocal, timeoutMs };
  const resultado = { inicial, limite, paginas: [], candidatas: 0, bloqueadasPorRobots: [], semLinksNoCru: false, robots: null, sitemaps: [], avisos: [] };

  // robots.txt
  let robots = { grupos: [], sitemaps: [] };
  try {
    const r = await buscarSeguro(origem + '/robots.txt', rede);
    if (r.status === 200) robots = parseRobots(r.texto());
  } catch { /* sem robots */ }
  resultado.robots = { grupos: robots.grupos.length, sitemaps: robots.sitemaps };
  const permitidaPorRobots = (u) => {
    if (!respeitarRobots) return true;
    const x = new URL(u);
    return podeRastrear(robots, UA.split('/')[0], x.pathname + x.search);
  };

  const candidatas = new Map(); // url -> { origem, profundidade }
  const adicionar = (u, via, prof) => {
    const n = normalizarUrl(u);
    if (!n || new URL(n).host !== hostInicial || candidatas.has(n)) return;
    if (/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|webm|mp3|css|js|json|xml|woff2?|ttf)(\?|$)/i.test(n)) return;
    candidatas.set(n, { via, profundidade: prof });
  };
  adicionar(inicial, 'inicio', 0);

  // sitemaps
  const smUrls = robots.sitemaps.length ? robots.sitemaps : [origem + '/sitemap.xml'];
  const doSitemap = new Set();
  for (const sm of smUrls.slice(0, 3)) await lerSitemap(new URL(sm, origem).toString(), rede, 500, 0, doSitemap);
  resultado.sitemaps = [...doSitemap].length ? smUrls : [];
  for (const u of doSitemap) adicionar(u, 'sitemap', 1);

  // links da home (cru), depois profundidade 1 em quantidade limitada
  const maxBuscasDescoberta = modo === 'completo' ? 40 : 12;
  let buscas = 0;
  const fila = [inicial];
  const visitadas = new Set();
  while (fila.length && buscas < maxBuscasDescoberta && Date.now() < prazo) {
    const u = fila.shift();
    if (visitadas.has(u) || !permitidaPorRobots(u)) continue;
    visitadas.add(u);
    const prof = candidatas.get(u)?.profundidade ?? 1;
    if (prof >= 3) continue;
    if (buscas > 0) await esperar(intervaloMs);
    buscas++;
    try {
      const r = await buscarSeguro(u, rede);
      if (r.status !== 200 || !/html/i.test(String(r.cabecalhos['content-type'] || ''))) continue;
      const links = extrairLinksDoHtml(r.texto(), u);
      if (u === inicial && links.filter((l) => new URL(l).host === hostInicial).length < 2) resultado.semLinksNoCru = true;
      for (const l of links) {
        adicionar(l, 'link', prof + 1);
        if (new URL(l).host === hostInicial && !visitadas.has(l) && !fila.includes(l) && (candidatas.get(l)?.profundidade ?? 9) <= 2) fila.push(l);
      }
    } catch (e) {
      resultado.avisos.push(`descoberta ${u}: ${e.message}`);
    }
  }
  for (const l of linksExtras) adicionar(l, 'dom-final', 1);

  // robots
  for (const u of [...candidatas.keys()]) {
    if (!permitidaPorRobots(u)) { resultado.bloqueadasPorRobots.push(u); candidatas.delete(u); }
  }
  resultado.candidatas = candidatas.size;

  // amostragem: home, páginas legais/institucionais, depois 1 por padrão de URL, depois o que sobrar
  const escolhidas = [];
  const marcar = (u, motivo) => { if (escolhidas.length < limite && !escolhidas.some((e) => e.url === u)) escolhidas.push({ url: u, motivo, padrao: padraoDeUrl(u), ...candidatas.get(u) }); };
  marcar(inicial, 'home');
  for (const u of candidatas.keys()) if (LEGAIS.test(new URL(u).pathname)) marcar(u, 'legal-ou-institucional');
  const padroesVistos = new Set(escolhidas.map((e) => e.padrao));
  for (const u of candidatas.keys()) {
    const p = padraoDeUrl(u);
    if (!padroesVistos.has(p)) { padroesVistos.add(p); marcar(u, 'representante-de-modelo'); }
  }
  for (const u of candidatas.keys()) marcar(u, 'complemento');
  resultado.paginas = escolhidas;
  resultado.truncado = candidatas.size > escolhidas.length;
  return resultado;
}
