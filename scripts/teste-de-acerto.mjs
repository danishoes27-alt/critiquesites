#!/usr/bin/env node
// TESTE DE ACERTO: mede quanto a parte OBJETIVA da nota (Tell Score) separa dois grupos:
//   - "ia":   sites gerados localmente por IA com prompts genéricos   (saidas/acerto/ia/<tipo>-N/index.html)
//   - "bons": Sites of the Day de uma lista pública (só a home)         (saidas/acerto/bons-lista.json)
// Tudo fica em saidas/acerto/ (fora do git). No repositório entram só números AGREGADOS.
//
//   node scripts/teste-de-acerto.mjs rodar [ia|bons|todos]
//   node scripts/teste-de-acerto.mjs resumo [--C 40]
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analisar } from '../lib/analisar.mjs';
import { calcularTellScore, PARAMETROS } from '../lib/tell-score.mjs';
import { gravarJson, lerJson } from '../lib/util.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(raiz, 'saidas', 'acerto');
const arqResultados = (g) => join(base, `resultados-${g}.json`);

function mediana(v) { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; }
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

// AUC por Mann–Whitney: probabilidade de um site "ia" ter nota maior que um "bom" (empates = 0,5).
export function auc(altos, baixos) {
  if (!altos.length || !baixos.length) return null;
  let s = 0;
  for (const a of altos) for (const b of baixos) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (altos.length * baixos.length);
}

// Melhor limiar (nota >= L => "parece padrão"): maximiza a acurácia balanceada.
export function melhorLimiar(ia, bons) {
  const candidatos = [...new Set([...ia, ...bons])].sort((a, b) => a - b);
  let melhor = null;
  for (const L of candidatos) {
    const vp = ia.filter((x) => x >= L).length, fn = ia.length - vp;
    const fp = bons.filter((x) => x >= L).length, vn = bons.length - fp;
    const sens = ia.length ? vp / ia.length : 0, espec = bons.length ? vn / bons.length : 0;
    const bal = (sens + espec) / 2;
    if (!melhor || bal > melhor.balanceada) melhor = { limiar: L, vp, fn, fp, vn, sensibilidade: sens, especificidade: espec, balanceada: bal };
  }
  return melhor;
}

async function rodarGrupo(grupo) {
  const itens = [];
  if (grupo === 'ia') {
    const dir = join(base, 'ia');
    for (const n of readdirSync(dir).sort()) if (existsSync(join(dir, n, 'index.html'))) itens.push({ id: `ia-${n}`, tipo: n.replace(/-\d+$/, ''), entrada: join(dir, n), url: false });
  } else {
    const lista = lerJson(join(base, 'bons-lista.json'));
    lista.sites.forEach((u, i) => itens.push({ id: `bom-${String(i + 1).padStart(2, '0')}`, tipo: 'premiado', entrada: u, url: true }));
  }
  const saida = existsSync(arqResultados(grupo)) ? lerJson(arqResultados(grupo)) : { grupo, itens: {} };
  for (const it of itens) {
    if (saida.itens[it.id]?.tell !== undefined) { console.error('já feito:', it.id); continue; }
    console.error('analisando', it.id);
    try {
      const r = await analisar({ entrada: it.entrada, modo: 'rapido', limitePaginas: 1, intervaloMs: it.url ? 3000 : 0, saidas: join(base, 'runs'), ignorarMedidores: ['lighthouse'], usarCache: false });
      const tells = lerJson(join(r.pasta, 'tells.json'));
      saida.itens[it.id] = { id: it.id, tipo: it.tipo, tell: r.resumo.tell, geral: r.resumo.geral.nota, achados: r.resumo.achados, descartados: r.resumo.descartados, pasta: r.pasta, tells, cobertura: { avaliadas: r.resumo.cobertura.avaliadas, semDetector: r.resumo.cobertura.semDetector.length }, medidoresComErro: r.resumo.medidoresComErro, duracaoMs: r.resumo.duracaoMs };
    } catch (e) {
      saida.itens[it.id] = { id: it.id, tipo: it.tipo, erro: String(e.message || e) };
    }
    gravarJson(arqResultados(grupo), saida);
  }
}

function notaCom(tells, C) {
  return calcularTellScore(tells, { parametros: { ...PARAMETROS, C } }).nota;
}

function resumo(C) {
  const g = (nome) => (existsSync(arqResultados(nome)) ? Object.values(lerJson(arqResultados(nome)).itens) : []);
  const ia = g('ia'), bons = g('bons');
  const ok = (l) => l.filter((x) => x.tells);
  const notas = (l) => ok(l).map((x) => notaCom(x.tells, C));
  const nIA = notas(ia), nB = notas(bons);
  const lim = melhorLimiar(nIA, nB);
  const porTipo = {};
  for (const x of ok(ia)) (porTipo[x.tipo] ||= []).push(notaCom(x.tells, C));
  return {
    C, ia: { n: ia.length, validos: nIA.length, comErro: ia.length - nIA.length, mediana: mediana(nIA), media: media(nIA), min: Math.min(...nIA), max: Math.max(...nIA) },
    bons: { n: bons.length, validos: nB.length, comErro: bons.length - nB.length, mediana: mediana(nB), media: media(nB), min: Math.min(...nB), max: Math.max(...nB) },
    diferencaDeMedianas: mediana(nIA) !== null && mediana(nB) !== null ? mediana(nIA) - mediana(nB) : null,
    auc: auc(nIA, nB), melhorLimiar: lim,
    porTipo: Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, { n: v.length, mediana: mediana(v), min: Math.min(...v), max: Math.max(...v) }])),
    notasIA: nIA, notasBons: nB,
  };
}

const executandoComoScript = Boolean(process.argv[1]) && process.argv[1].split('\\').join('/').endsWith('scripts/teste-de-acerto.mjs');
if (executandoComoScript) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'rodar') {
    mkdirSync(base, { recursive: true });
    for (const g of arg === 'ia' || arg === 'bons' ? [arg] : ['ia', 'bons']) await rodarGrupo(g);
  } else if (cmd === 'resumo') {
    const iC = process.argv.indexOf('--C');
    const C = iC > 0 ? Number(process.argv[iC + 1]) : PARAMETROS.C;
    console.log(JSON.stringify(resumo(C), null, 2));
  } else {
    console.error('uso: rodar [ia|bons|todos] | resumo [--C 40]');
    process.exit(2);
  }

}
