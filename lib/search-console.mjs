// LEITURA DO CSV DO SEARCH CONSOLE (exportado pela própria pessoa). Roda só LOCAL: não usa rede, não executa nada do arquivo,
// não copia o arquivo para a pasta da análise. Valores são sempre tratados como texto ou número (fórmulas como "=..." viram texto).
// Limites (config/seo-google.json): tamanho máximo e número máximo de linhas. Cabeçalhos em português e em inglês.
// Sem CSV, nada é inventado: o relatório mostra "precisa do CSV do Search Console".
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { palavrasSignificativas } from './medidores/seo-google.mjs';
import { limparDadoDoSite } from './prompts-correcao.mjs';
import { carregarConfigSeo } from './seo-nota.mjs';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SINONIMOS = {
  consulta: ['consulta', 'consultas', 'consultas principais', 'query', 'queries', 'top queries', 'top query', 'search query', 'termo de pesquisa', 'palavra chave'],
  pagina: ['pagina', 'paginas', 'paginas principais', 'principais paginas', 'page', 'pages', 'top pages', 'url', 'landing page'],
  cliques: ['cliques', 'clique', 'clicks', 'click'],
  impressoes: ['impressoes', 'impressao', 'impressions', 'impression'],
  ctr: ['ctr', 'taxa de cliques', 'click through rate', 'taxa de cliques ctr'],
  posicao: ['posicao', 'posicao media', 'position', 'average position', 'avg position', 'avg pos'],
};
const ALVO_DO_CAMPO = (cab) => { const n = semAcento(cab); for (const [campo, lista] of Object.entries(SINONIMOS)) if (lista.includes(n)) return campo; return null; };

// Parser de CSV (aspas, aspas duplas escapadas, quebras de linha dentro de aspas). Nada é avaliado.
export function parseCsv(texto, delim) {
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some((x) => x !== '')) linhas.push(linha); linha = []; }
    else campo += c;
  }
  linha.push(campo); if (linha.some((x) => x !== '')) linhas.push(linha);
  return linhas;
}

const detectarDelim = (primeira) => { const c = { ';': 0, ',': 0, '\t': 0 }; let q = false; for (const ch of primeira) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : ','; };

// Número: pt (1.234,5 ; 12,5 ; 3,2%) ou en (1,234.5 ; 12.5 ; 3.2%). Devolve número, ou null se não for número.
export function paraNumeroSC(bruto, ptBr) {
  let s = String(bruto ?? '').trim();
  if (!s) return null;
  const pct = s.endsWith('%'); if (pct) s = s.slice(0, -1).trim();
  if (!/^[-+]?[\d.,\s]+$/.test(s)) return null;
  s = s.replace(/\s/g, '');
  const temV = s.includes(','), temP = s.includes('.');
  if (temV && temP) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (temV) s = ptBr || !/^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (temP && ptBr && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

// Lê UM arquivo. Devolve { ok, erro? , tipo, linhas[], avisos[] }. linhas = [{consulta?, pagina?, cliques, impressoes, ctr, posicao}]
export function lerArquivoSC(caminho, config = carregarConfigSeo()) {
  const cfg = config.search_console;
  const ext = extname(caminho).toLowerCase();
  if (!['.csv', '.tsv', '.txt'].includes(ext)) return { ok: false, erro: 'Use o arquivo .csv exportado do Search Console (o ZIP precisa ser aberto antes).' };
  let st;
  try { st = statSync(caminho); } catch { return { ok: false, erro: 'Não consegui abrir o arquivo.' }; }
  if (!st.isFile()) return { ok: false, erro: 'O caminho não é um arquivo.' };
  if (st.size > cfg.tamanho_maximo_bytes) return { ok: false, erro: `Arquivo grande demais (${Math.round(st.size / 1024)} KB; o limite é ${Math.round(cfg.tamanho_maximo_bytes / 1024)} KB).` };
  const fd = openSync(caminho, 'r');
  let texto;
  try { const buf = Buffer.alloc(Math.min(st.size, cfg.tamanho_maximo_bytes)); readSync(fd, buf, 0, buf.length, 0); texto = buf.toString('utf8'); } finally { closeSync(fd); }
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const delim = detectarDelim(primeira);
  const todas = parseCsv(texto, delim);
  if (todas.length < 2) return { ok: false, erro: 'O arquivo não tem linhas de dados.' };
  if (todas.length - 1 > cfg.linhas_maximas) return { ok: false, erro: `Linhas demais (${todas.length - 1}; o limite é ${cfg.linhas_maximas}).` };
  const cab = todas[0];
  const mapa = cab.map(ALVO_DO_CAMPO);
  const naoReconhecidas = cab.filter((c, i) => !mapa[i] && String(c).trim()).map((c) => limparDadoDoSite(c, 40));
  const idx = (campo) => mapa.indexOf(campo);
  if (idx('impressoes') < 0 || (idx('consulta') < 0 && idx('pagina') < 0)) return { ok: false, erro: 'Não reconheci as colunas. Preciso de "Consulta" (Query) ou "Página" (Page) e de "Impressões" (Impressions); também uso Cliques, CTR e Posição.' };
  const ptBr = delim === ';';
  const linhas = [];
  for (const r of todas.slice(1)) {
    const n = (campo) => (idx(campo) >= 0 ? paraNumeroSC(r[idx(campo)], ptBr) : null);
    const imp = n('impressoes');
    if (imp === null) continue;
    const cliques = n('cliques');
    let ctr = n('ctr');
    if (ctr === null && cliques !== null && imp > 0) ctr = cliques / imp;
    if (ctr !== null && ctr > 1) ctr = ctr / 100; // "3,2" sem % = 3,2%
    linhas.push({ consulta: idx('consulta') >= 0 ? String(r[idx('consulta')] ?? '').trim() : null, pagina: idx('pagina') >= 0 ? String(r[idx('pagina')] ?? '').trim() : null, cliques, impressoes: imp, ctr, posicao: n('posicao') });
  }
  const avisos = [];
  if (naoReconhecidas.length) avisos.push(`Colunas que não usei: ${naoReconhecidas.join(', ')}.`);
  if (idx('posicao') < 0) avisos.push('Sem coluna de Posição: não dá para achar oportunidades por posição.');
  return { ok: true, tipo: idx('consulta') >= 0 && idx('pagina') >= 0 ? 'consultas e páginas' : idx('consulta') >= 0 ? 'consultas' : 'páginas', arquivo: basename(caminho), linhas, avisos };
}

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const arred = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// paginasDoSite: [{ caminho, termo, titulo, h1 }] (do medidor); serve só para "consulta sem página própria".
export function oportunidades(linhas, paginasDoSite = [], config = carregarConfigSeo()) {
  const cfg = config.search_console;
  const comPos = linhas.filter((l) => typeof l.posicao === 'number');
  const alvoLinha = (l) => l.consulta || l.pagina || '';
  const faixa = comPos.filter((l) => l.impressoes >= cfg.impressoes_minimas && l.posicao >= cfg.posicao_minima && l.posicao <= cfg.posicao_maxima)
    .sort((a, b) => b.impressoes - a.impressoes || String(alvoLinha(a)).localeCompare(String(alvoLinha(b)))).slice(0, 10)
    .map((l) => ({ alvo: alvoLinha(l), tipo: l.consulta ? 'consulta' : 'página', impressoes: l.impressoes, cliques: l.cliques, posicao: arred(l.posicao), ctr: l.ctr === null ? null : arred(l.ctr * 100) }));
  // CTR esperado = mediana do PRÓPRIO arquivo na mesma faixa inteira de posição (D-022); sem curva externa.
  const porFaixa = new Map();
  for (const l of comPos) if (typeof l.ctr === 'number' && l.impressoes >= cfg.impressoes_minimas) { const k = Math.floor(l.posicao); if (!porFaixa.has(k)) porFaixa.set(k, []); porFaixa.get(k).push(l.ctr); }
  const med = new Map([...porFaixa].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, mediana(v)]));
  const ctrBaixo = comPos.filter((l) => typeof l.ctr === 'number' && l.impressoes >= cfg.impressoes_minimas && l.posicao >= cfg.posicao_minima && l.posicao <= cfg.posicao_maxima && med.has(Math.floor(l.posicao)) && l.ctr < 0.7 * med.get(Math.floor(l.posicao)))
    .sort((a, b) => b.impressoes - a.impressoes || String(alvoLinha(a)).localeCompare(String(alvoLinha(b)))).slice(0, 10)
    .map((l) => ({ alvo: alvoLinha(l), tipo: l.consulta ? 'consulta' : 'página', impressoes: l.impressoes, posicao: arred(l.posicao), ctr: arred(l.ctr * 100), ctrTipicoDoSite: arred(med.get(Math.floor(l.posicao)) * 100) }));
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const palavrasPaginas = paginasDoSite.map((p) => new Set(palavrasSignificativas(`${p.titulo || ''} ${p.h1 || ''} ${p.termo || ''}`).map(stem)));
  const semPagina = paginasDoSite.length ? linhas.filter((l) => l.consulta && l.impressoes >= cfg.impressoes_minimas).filter((l) => { const w = palavrasSignificativas(l.consulta).map(stem); return w.length >= 1 && !palavrasPaginas.some((set) => w.every((x) => set.has(x))); })
    .sort((a, b) => b.impressoes - a.impressoes || a.consulta.localeCompare(b.consulta)).slice(0, 10).map((l) => ({ alvo: l.consulta, impressoes: l.impressoes, posicao: typeof l.posicao === 'number' ? arred(l.posicao) : null })) : [];
  return { posicao4a20: faixa, ctrAbaixoDoTipicoDoSite: ctrBaixo, consultasSemPaginaPropria: semPagina };
}

// Ponto de entrada: caminhos = lista de arquivos .csv. Nunca lança por causa do conteúdo do arquivo.
export function analisarSearchConsole(caminhos, paginasDoSite = [], config = carregarConfigSeo()) {
  if (!caminhos?.length) return { disponivel: false, mensagem: 'Precisa do CSV do Search Console (exporte "Consultas" e "Páginas" no relatório de Desempenho e passe o arquivo com --csv).' };
  const arquivos = []; const erros = []; let linhas = [];
  for (const c of caminhos) { const r = lerArquivoSC(c, config); if (!r.ok) erros.push(`${basename(String(c))}: ${r.erro}`); else { arquivos.push({ arquivo: limparDadoDoSite(r.arquivo, 60), tipo: r.tipo, linhas: r.linhas.length, avisos: r.avisos }); linhas = linhas.concat(r.linhas); } }
  if (!arquivos.length) return { disponivel: false, mensagem: `Não consegui usar o CSV. ${erros.join(' ')}`, erros };
  return { disponivel: true, arquivos, erros, resumo: { linhas: linhas.length, impressoes: linhas.reduce((s, l) => s + l.impressoes, 0) }, ...oportunidades(linhas, paginasDoSite, config), selo: 'fato', fonte: 'Arquivo exportado pela própria pessoa (Search Console). Lido só localmente.' };
}
