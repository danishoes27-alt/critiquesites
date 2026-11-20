// Gera os arquivos de entrega: relatório HTML, PDF e card PNG (dois tamanhos), por template.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderizarRelatorio } from './relatorio.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TAMANHOS_CARD = {
  retrato: { largura: 1080, altura: 1350, margem: 36, padding: 56, fonteSite: 64, fonteNota: 260, fonteNivel: 46, fonteN: 64, fontePequena: 28, fonteMini: 22, gap: 48 },
  paisagem: { largura: 1200, altura: 630, margem: 24, padding: 36, fonteSite: 44, fonteNota: 170, fonteNivel: 34, fonteN: 42, fontePequena: 20, fonteMini: 15, gap: 36 },
};

export function renderizarCard(d, tamanho, dirTemplates = join(raiz, 'templates')) {
  const t = TAMANHOS_CARD[tamanho];
  const tpl = readFileSync(join(dirTemplates, 'card.html'), 'utf8');
  const cats = [...(d.notas?.categorias || [])].slice(0, 3);
  while (cats.length < 3) cats.push({ rotulo: '—', nota: '—' });
  const evol = d.anterior && typeof d.anterior.deltaTell === 'number'
    ? `<div class="evolucao">Tell Score: de ${esc(d.anterior.tellAntes)} para ${esc(d.anterior.tellDepois)}</div>`
    : `<div class="evolucao" style="color:#5b5a55">Tell Score (cara de IA, menor é melhor): ${esc(d.notas?.tell?.nota ?? '—')}</div>`;
  const notaSeo = d.seoGoogle?.nota?.nota;
  const linhaSeo = typeof notaSeo === 'number' ? `<div class="evolucao" style="color:#5b5a55">Nota de SEO (maior é melhor): ${esc(Math.round(notaSeo))}/100${typeof d.anterior?.deltaSeo === 'number' ? ` (${d.anterior.deltaSeo > 0 ? '+' : ''}${esc(d.anterior.deltaSeo)} desde a última análise)` : ''}</div>` : '';
  const mapa = {
    LARGURA: t.largura, ALTURA: t.altura, MARGEM: t.margem, PADDING: t.padding, FONTE_SITE: t.fonteSite, FONTE_NOTA: t.fonteNota, FONTE_NIVEL: t.fonteNivel,
    FONTE_N: t.fonteN, FONTE_PEQUENA: t.fontePequena, FONTE_MINI: t.fonteMini, GAP: t.gap,
    DATA: esc(new Date(d.carimbo.iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })),
    SITE: esc(d.site.host || d.site.url), NOTA: esc(Math.round(d.notas?.geral?.nota ?? 0)), NIVEL: esc(d.notas?.geral?.nivel || ''),
    EVOLUCAO: evol + linhaSeo, HASH: esc(String(d.carimbo.hash).slice(0, 12)),
    N1: esc(cats[0].nota), R1: esc(cats[0].rotulo), N2: esc(cats[1].nota), R2: esc(cats[1].rotulo), N3: esc(cats[2].nota), R3: esc(cats[2].rotulo),
  };
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => String(mapa[k] ?? ''));
}

// nav = objeto de abrirNavegador(). Grava relatorio.html, relatorio.pdf, card-retrato.png, card-paisagem.png em pasta.
export async function gerarEntregas(d, pasta, nav) {
  mkdirSync(pasta, { recursive: true });
  const saidas = {};
  const html = renderizarRelatorio(d);
  saidas.html = join(pasta, 'relatorio.html');
  writeFileSync(saidas.html, html, 'utf8');
  const ctx = await nav.novoContexto({ viewport: { width: 1000, height: 1200 }, semJs: true }); // PDF/cards não precisam de JavaScript
  try {
    const pg = await ctx.newPage();
    await pg.setContent(html, { waitUntil: 'load' });
    await pg.emulateMedia({ media: 'print' });
    saidas.pdf = join(pasta, 'relatorio.pdf');
    await pg.pdf({ path: saidas.pdf, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    for (const [nome, t] of Object.entries(TAMANHOS_CARD)) {
      const c = await nav.novoContexto({ viewport: { width: t.largura, height: t.altura }, semJs: true });
      try {
        const p = await c.newPage();
        await p.setContent(renderizarCard(d, nome), { waitUntil: 'load' });
        const arq = join(pasta, `card-${nome}.png`);
        await p.screenshot({ path: arq, clip: { x: 0, y: 0, width: t.largura, height: t.altura } });
        saidas[`card_${nome}`] = arq;
      } finally { await c.close().catch(() => {}); }
    }
  } finally { await ctx.close().catch(() => {}); }
  return saidas;
}
