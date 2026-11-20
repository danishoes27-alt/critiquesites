// Navegador isolado (Chromium do Playwright, instalado dentro da pasta do projeto).
// Todo código do site analisado roda SÓ aqui, em contexto efêmero, com limites de tempo.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlPermitida, UA } from './rede-segura.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Chromium fica em node_modules/playwright-core/.local-browsers (limite duro: nada fora da pasta).
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const { chromium } = await import('playwright');

export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

export async function abrirNavegador({ permitidos = [], permitirLocal = false, timeoutMs = 25000 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--disable-sync', '--mute-audio', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  const bloqueios = [];
  const estado = { permitidos: [...permitidos], permitirLocal, timeoutMs, bloqueios };

  async function novoContexto({ viewport = 'desktop', mobile = false, semJs = false } = {}) {
    const vp = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
    const ctx = await browser.newContext({
      viewport: vp,
      userAgent: UA + (mobile ? ' (mobile)' : ''),
      acceptDownloads: false,
      javaScriptEnabled: !semJs,
      permissions: [],
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    });
    ctx.setDefaultTimeout(timeoutMs);
    ctx.setDefaultNavigationTimeout(timeoutMs);
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const tipo = req.resourceType();
      if (tipo === 'media') { bloqueios.push({ url, motivo: 'mídia não carregada (economia)' }); return route.abort('blockedbyclient'); }
      const p = await urlPermitida(url, { permitidos: estado.permitidos, permitirLocal: estado.permitirLocal });
      if (!p.ok) { bloqueios.push({ url, motivo: p.motivo }); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    // WebSocket não passa pelo roteamento HTTP: fecha todos (o site não precisa deles para ser analisado).
    await ctx.routeWebSocket(/.*/, (ws) => { bloqueios.push({ url: ws.url(), motivo: 'WebSocket bloqueado' }); ws.close({ code: 1008, reason: 'bloqueado' }); });
    // Nega janelas extras e downloads.
    ctx.on('page', (pg) => {
      pg.on('download', (d) => d.cancel().catch(() => {}));
      pg.on('dialog', (d) => d.dismiss().catch(() => {}));
    });
    return ctx;
  }

  return {
    browser,
    estado,
    bloqueios,
    novoContexto,
    permitirHost: (hostPorta) => estado.permitidos.push(hostPorta.toLowerCase()),
    versao: () => browser.version(),
    fechar: async () => { await browser.close().catch(() => {}); },
  };
}
