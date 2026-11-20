// Lê UMA página em 3 versões: cru (HTML sem JS), dom250 (250 ms após DOMContentLoaded) e final.
import { buscarSeguro } from './rede-segura.mjs';
import { extrairNoDom } from './extrator-dom.mjs';
import { coletarEstilosNoDom } from './extrator-estilos.mjs';
import { esperar, sha256 } from './util.mjs';

// page.evaluate roda no mundo da página: o site pode travar (ex.: sobrescrever Date.now). Todo evaluate tem prazo;
// se estourar, a leitura falha e o contexto é fechado (o que derruba a página travada).
const atraso = (ms, nome) => new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`${nome} passou de ${ms} ms (a página pode estar travando a leitura)`)), ms); t.unref?.(); });
export function aval(pagina, fn, arg, ms = 25000) { return Promise.race([pagina.evaluate(fn, arg), atraso(ms, 'leitura da página')]); }

const INICIO_INIT = `
window.__cs_extrair = ${extrairNoDom.toString()};
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    try { window.__cs_snap250 = { extr: window.__cs_extrair({}), html: document.documentElement.outerHTML }; }
    catch (e) { window.__cs_snap250_erro = String(e); }
  }, 250);
});
`;

async function rolarTudo(page) {
  await aval(page, async () => {
    const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
    const passo = Math.max(300, Math.floor(window.innerHeight * 0.8));
    const limite = Date.now() + 6000;
    let y = 0;
    while (Date.now() < limite) {
      const alvo = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      if (y >= alvo - window.innerHeight) break;
      y += passo;
      window.scrollTo(0, y);
      await pausa(120);
    }
    window.scrollTo(0, 0);
    await pausa(200);
  });
}

// Assinatura dos textos com dígitos: serve para saber quando contadores animados terminaram.
async function assinaturaNumerica(page) {
  return aval(page, () => {
    const out = [];
    const tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode()) && out.length < 400) {
      const t = (n.nodeValue || '').trim();
      if (/\d/.test(t) && t.length < 60 && n.parentElement && !n.parentElement.closest('script,style')) out.push(t);
    }
    return out.join('|');
  });
}

// Leitura MOBILE (390x844, isMobile): extr + estilos computados + overflow horizontal + meta viewport.
// Falhas parciais ficam em resultado.erros; o que deu certo é mantido.
async function lerMobile(url, nav, timeoutMs, erros) {
  const ctxM = await nav.novoContexto({ viewport: 'mobile', mobile: true });
  const m = { extr: null, estilos: null, overflowHorizontal: null, viewportMeta: null };
  try {
    const page = await ctxM.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await rolarTudo(page).catch(() => {});
    await esperar(300);
    try { m.extr = await aval(page, extrairNoDom, {}); m.viewportMeta = m.extr.viewportMeta ?? null; } catch (e) { erros.push(`mobile-extr: ${e.message}`); }
    try { m.estilos = await aval(page, coletarEstilosNoDom, {}); } catch (e) { erros.push(`mobile-estilos: ${e.message}`); }
    try { m.overflowHorizontal = await aval(page, () => document.documentElement.scrollWidth > Math.min(window.innerWidth, (window.screen && window.screen.width) || window.innerWidth)); } catch (e) { erros.push(`mobile-overflow: ${e.message}`); }
    return m;
  } catch (e) {
    erros.push(`mobile: ${e.message}`);
    return null;
  } finally {
    await ctxM.close().catch(() => {});
  }
}

export async function lerPagina(url, { nav, permitidos = [], permitirLocal = false, esperaFinalMs = 1500, timeoutMs = 25000, extrairCru = true, mobile = true } = {}) {
  const t0 = Date.now();
  const resultado = { url, erros: [], console: [], requisicoes: [] };
  for (const h of permitidos) if (!nav.estado.permitidos.includes(h.toLowerCase())) nav.permitirHost(h);

  // 1) HTML cru (sem JS), com proteção anti-SSRF e limite de tamanho.
  let cru;
  try {
    cru = await buscarSeguro(url, { permitidos, permitirLocal, timeoutMs });
  } catch (e) {
    resultado.erros.push(`cru: ${e.message}`);
    return resultado;
  }
  const tipoMime = String(cru.cabecalhos['content-type'] || '');
  resultado.cru = { status: cru.status, urlFinal: cru.url, cabecalhos: cru.cabecalhos, tipoMime, html: cru.texto(), hash: sha256(cru.corpo), bytes: cru.corpo.length };
  if (cru.status >= 400 || (tipoMime && !/html|xml/i.test(tipoMime))) {
    resultado.erros.push(`resposta não é página HTML utilizável (status ${cru.status}, tipo ${tipoMime || 'desconhecido'})`);
    return resultado;
  }

  // 2) Navegador isolado: dom250 e final.
  const ctx = await nav.novoContexto();
  try {
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && resultado.console.length < 100) resultado.console.push({ tipo: m.type(), texto: m.text().slice(0, 300) }); });
    page.on('pageerror', (e) => { if (resultado.console.length < 100) resultado.console.push({ tipo: 'pageerror', texto: String(e.message).slice(0, 300) }); });
    page.on('requestfailed', (r) => { if (resultado.requisicoes.length < 1500) resultado.requisicoes.push({ url: r.url().slice(0, 300), falhou: r.failure()?.errorText || 'falhou' }); });
    page.on('response', (r) => {
      if (resultado.requisicoes.length >= 1500) return;
      const h = r.headers();
      resultado.requisicoes.push({ url: r.url().slice(0, 300), status: r.status(), tipo: r.request().resourceType(), mime: h['content-type'] || '', bytes: h['content-length'] ? Number(h['content-length']) : null });
    });
    await page.addInitScript({ content: INICIO_INIT });

    const resp = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    resultado.nav = { status: resp ? resp.status() : null, urlFinal: page.url(), cabecalhos: resp ? resp.headers() : {} };
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await rolarTudo(page);
    await esperar(Math.min(esperaFinalMs, 600));
    // espera contadores/animações assentarem (duas leituras iguais seguidas), no máximo ~3,2 s
    let anterior = await assinaturaNumerica(page);
    let estavel = 0;
    for (let i = 0; i < 8 && estavel < 2; i++) {
      await esperar(400);
      const atual = await assinaturaNumerica(page);
      estavel = atual === anterior ? estavel + 1 : 0;
      anterior = atual;
    }
    const restante = esperaFinalMs - 600;
    if (restante > 0) await esperar(Math.min(restante, 900));

    const snap250 = await aval(page, () => window.__cs_snap250 || null);
    resultado.dom250 = snap250 ? { extr: snap250.extr, html: snap250.html } : { erro: await aval(page, () => window.__cs_snap250_erro || 'sem instantâneo') };
    resultado.final = { extr: await aval(page, extrairNoDom, {}), html: await page.content() };
    // estilos computados agregados (M2.2): falha aqui não derruba a leitura
    try { resultado.final.estilos = await aval(page, coletarEstilosNoDom, {}); } catch (e) { resultado.erros.push(`estilos: ${e.message}`); }
    resultado.titulo = await page.title();
  } catch (e) {
    resultado.erros.push(`navegador: ${e.message}`);
  } finally {
    await ctx.close().catch(() => {});
  }

  // 2b) leitura mobile (contexto próprio)
  if (mobile && resultado.final) {
    const m = await lerMobile(url, nav, timeoutMs, resultado.erros);
    if (m) resultado.mobile = m;
  }

  // 3) "cru" estruturado: o mesmo extrator, mas sobre o HTML cru, com JavaScript DESLIGADO.
  if (extrairCru && resultado.cru) {
    const ctx2 = await nav.novoContexto({ semJs: true });
    try {
      const p2 = await ctx2.newPage();
      // Serve o HTML cru NA PRÓPRIA URL (e bloqueia o resto): links relativos resolvem e `interno` fica correto.
      const urlCru = resultado.cru.urlFinal || url;
      await p2.route('**/*', (rota) => (rota.request().url() === urlCru ? rota.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: resultado.cru.html }) : rota.abort()));
      await p2.goto(urlCru, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      resultado.cru.extr = await aval(p2, extrairNoDom, {});
    } catch (e) {
      resultado.erros.push(`cru-estruturado: ${e.message}`);
    } finally {
      await ctx2.close().catch(() => {});
    }
  }
  resultado.duracaoMs = Date.now() - t0;
  return resultado;
}
