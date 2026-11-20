#!/usr/bin/env node
// CALIBRAÇÃO do Tell Score com treino e validação SEPARADOS (para não ajustar ao próprio teste).
//   treino:    IA -1 e -2 de cada tipo (10 sites)  +  premiados 01..10 (10 sites)
//   validação: IA -3 e -4 de cada tipo (10 sites)  +  premiados 11..20 (10 sites)
// Só mexe em duas coisas: multiplicadores por categoria (grade {0,5; 1; 1,5}) e a constante C (nota 45 no limiar do treino).
// Uso: node scripts/calibrar.mjs            (imprime JSON; não altera nenhum arquivo)
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularTellScore, CATEGORIAS_TELL, PARAMETROS } from '../lib/tell-score.mjs';
import { lerJson } from '../lib/util.mjs';
import { auc, melhorLimiar } from './teste-de-acerto.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(raiz, 'saidas', 'acerto');
const carregar = (g) => (existsSync(join(base, `resultados-${g}.json`)) ? Object.values(lerJson(join(base, `resultados-${g}.json`)).itens).filter((x) => x.tells) : []);

const ehTreino = (x) => (x.id.startsWith('ia-') ? /-[12]$/.test(x.id) : Number(x.id.split('-')[1]) <= 10);
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

const soma = (tells, mult) => calcularTellScore(tells, { parametros: { ...PARAMETROS, multiplicadores: mult } }).somaPontos;
const notaDe = (S, C) => (S === 0 ? 0 : (100 * S) / (S + C));

function avaliar(ia, bons, mult, C) {
  const nIA = ia.map((x) => notaDe(soma(x.tells, mult), C));
  const nB = bons.map((x) => notaDe(soma(x.tells, mult), C));
  const lim = melhorLimiar(nIA, nB);
  return { auc: auc(nIA, nB), medianaIA: mediana(nIA), medianaBons: mediana(nB), diferenca: mediana(nIA) - mediana(nB), limiar: lim, nIA, nB };
}

const ia = carregar('ia'), bons = carregar('bons');
const treino = { ia: ia.filter(ehTreino), bons: bons.filter(ehTreino) };
const valid = { ia: ia.filter((x) => !ehTreino(x)), bons: bons.filter((x) => !ehTreino(x)) };
if (!treino.ia.length || !treino.bons.length) { console.error('Sem resultados suficientes em saidas/acerto (rode: node scripts/teste-de-acerto.mjs rodar).'); process.exit(2); }

// 1) multiplicadores por categoria (subida de coordenadas no treino, com exigência de ganho mínimo)
const grade = [0.5, 1, 1.5];
let mult = Object.fromEntries(CATEGORIAS_TELL.map((c) => [c, 1]));
const score = (m) => { const a = avaliar(treino.ia, treino.bons, m, PARAMETROS.C); return a.auc + 0.001 * a.diferenca / 100; };
const aucBase = avaliar(treino.ia, treino.bons, mult, PARAMETROS.C).auc;
for (let rodada = 0; rodada < 3; rodada++) {
  let mudou = false;
  for (const cat of CATEGORIAS_TELL) {
    let melhor = mult[cat], melhorS = score(mult);
    for (const g of grade) { if (g === mult[cat]) continue; const s = score({ ...mult, [cat]: g }); if (s > melhorS + 0.01) { melhorS = s; melhor = g; } }
    if (melhor !== mult[cat]) { mult[cat] = melhor; mudou = true; }
  }
  if (!mudou) break;
}

// 2) constante C: o limiar do treino (em pontos S) deve virar nota 45 (fronteira entre as faixas C e D)
const Sia = treino.ia.map((x) => soma(x.tells, mult)), Sb = treino.bons.map((x) => soma(x.tells, mult));
const limS = melhorLimiar(Sia, Sb).limiar;
const Ccal = limS > 0 ? Math.round(((limS * 55) / 45) * 10) / 10 : PARAMETROS.C;

// C SEM multiplicadores (decisão adotada se os multiplicadores não melhorarem a validação)
const um = Object.fromEntries(CATEGORIAS_TELL.map((c) => [c, 1]));
const limS1 = melhorLimiar(treino.ia.map((x) => soma(x.tells, um)), treino.bons.map((x) => soma(x.tells, um))).limiar;
const C1 = limS1 > 0 ? Math.round(((limS1 * 55) / 45) * 10) / 10 : PARAMETROS.C;

const antes = { treino: avaliar(treino.ia, treino.bons, Object.fromEntries(CATEGORIAS_TELL.map((c) => [c, 1])), PARAMETROS.C), validacao: avaliar(valid.ia, valid.bons, Object.fromEntries(CATEGORIAS_TELL.map((c) => [c, 1])), PARAMETROS.C) };
const depois = { treino: avaliar(treino.ia, treino.bons, mult, Ccal), validacao: avaliar(valid.ia, valid.bons, mult, Ccal) };
const resumir = (a) => ({ auc: a.auc, medianaIA: a.medianaIA, medianaBons: a.medianaBons, diferencaDeMedianas: a.diferenca, limiar: a.limiar && { valor: Math.round(a.limiar.limiar * 10) / 10, sensibilidade: a.limiar.sensibilidade, especificidade: a.limiar.especificidade, falsosNegativos: a.limiar.fn, falsosPositivos: a.limiar.fp } });
console.log(JSON.stringify({
  tamanhos: { treinoIA: treino.ia.length, treinoBons: treino.bons.length, validacaoIA: valid.ia.length, validacaoBons: valid.bons.length },
  aucBaseTreino: aucBase, multiplicadores: mult, C: Ccal, adotado: { multiplicadores: 'nenhum (todos 1), se a validação não melhorar', C: C1 },
  somenteC: { treino: resumir(avaliar(treino.ia, treino.bons, um, C1)), validacao: resumir(avaliar(valid.ia, valid.bons, um, C1)), geral: resumir(avaliar([...treino.ia, ...valid.ia], [...treino.bons, ...valid.bons], um, C1)) },
  antes: { treino: resumir(antes.treino), validacao: resumir(antes.validacao) },
  depois: { treino: resumir(depois.treino), validacao: resumir(depois.validacao) },
}, null, 2));
