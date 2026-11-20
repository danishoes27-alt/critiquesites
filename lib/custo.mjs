// Estimativa e medição de custo em R$ (preço do modelo em US$/MTok × cotação do dia, com data e fonte).
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function carregarConfigCustos(caminho = join(raiz, 'config', 'custos.json')) {
  return JSON.parse(readFileSync(caminho, 'utf8'));
}

export const formatarReais = (v) => 'R$ ' + (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');

// Custo em US$ de uma chamada (tokens de entrada, saída e leitura de cache) para um modelo.
export function custoUsd(modelo, { entrada = 0, saida = 0, cacheLeitura = 0 } = {}) {
  const alto = modelo.limite_faixa_tokens && entrada + cacheLeitura > modelo.limite_faixa_tokens;
  const pIn = alto ? modelo.entrada_acima_100k : modelo.entrada;
  const pOut = alto ? modelo.saida_acima_100k : modelo.saida;
  const pCache = modelo.cache_leitura ?? modelo.entrada;
  return (entrada * pIn + saida * pOut + cacheLeitura * pCache) / 1e6;
}

// uso: [{ modelo:'sonnet-5-5', entrada, saida, cacheLeitura?, etapa? }]
export function custoDoUso(uso, cfg = carregarConfigCustos()) {
  let usd = 0;
  const linhas = uso.map((u) => {
    const m = cfg.precos.modelos[u.modelo];
    if (!m) throw new Error(`modelo desconhecido em config/custos.json: ${u.modelo}`);
    const c = custoUsd(m, u);
    usd += c;
    return { ...u, usd: c, reais: c * cfg.cotacao.valor };
  });
  return { usd, reais: usd * cfg.cotacao.valor, linhas, cotacao: cfg.cotacao, precos: { fonte: cfg.precos.fonte, url: cfg.precos.url, consultado_em: cfg.precos.consultado_em } };
}

// Estimativa antes de rodar. paginas = nº de páginas que serão lidas. Coeficientes MEDIDOS (config/custos.json).
export function estimarCusto({ modo = 'rapido', paginas = 1, seo = false, camadaLocal = false } = {}, cfg = carregarConfigCustos()) {
  const e = cfg.estimativa_tokens;
  const k = e[modo];
  if (!k) throw new Error(`modo desconhecido: ${modo}`);
  // Módulo "Subir no Google" (D-021): vem no modo completo ou por pedido; custo extra MEDIDO em config/custos.json (modulo_seo).
  const extra = (modo === 'completo' || seo) && cfg.modulo_seo ? cfg.modulo_seo : { pacote_extra_tokens: 0, saida_extra_tokens: 0 };
  // Camada local opcional (D-028): custo extra MEDIDO (pior caso) em config/custos.json (camada_local).
  const loc = camadaLocal && cfg.camada_local ? { pacote: cfg.camada_local.pacote_extra_tokens.maximo, saida: cfg.camada_local.saida_extra_tokens_maximo || 0 } : { pacote: 0, saida: 0 };
  const pacote = Math.min(k.pacote_teto, k.pacote_base + k.pacote_por_pagina * paginas) + extra.pacote_extra_tokens + loc.pacote;
  const entrada = e.instrucoes_skill_entrada + e.saidas_de_ferramentas_entrada + pacote;
  const saida = k.saida_base + k.saida_por_pagina * paginas + extra.saida_extra_tokens + loc.saida;
  const uso = [{ etapa: 'julgamento', modelo: cfg.modelo_julgamento, entrada, saida }];
  const r = custoDoUso(uso, cfg);
  return { modo, paginas, ...r, teto: cfg.teto_reais, acimaDoTeto: r.reais > cfg.teto_reais, confianca: e.confianca };
}

export function textoAviso(est) {
  const l = [`Custo estimado (${est.modo}, ${est.paginas} página(s)): ${formatarReais(est.reais)} (≈ US$ ${est.usd.toFixed(3)}).`];
  l.push(`Cotação: US$ 1 = ${formatarReais(est.cotacao.valor)} (${est.cotacao.tipo}, ${est.cotacao.data_cotacao}; fonte: ${est.cotacao.fonte}).`);
  l.push(`Preços: ${est.precos.fonte}, consultado em ${est.precos.consultado_em}.`);
  l.push(`Estimativa com confiança ${est.confianca}. Teto configurado: ${formatarReais(est.teto)}.`);
  if (est.acimaDoTeto) l.push('ATENÇÃO: acima do teto. Confirme antes de rodar ou use o modo rápido.');
  return l.join('\n');
}

// Rodapé do relatório com os tokens realmente gastos.
export function rodapeDeCusto(uso, cfg = carregarConfigCustos()) {
  const c = custoDoUso(uso, cfg);
  const tot = uso.reduce((a, u) => ({ entrada: a.entrada + (u.entrada || 0), saida: a.saida + (u.saida || 0) }), { entrada: 0, saida: 0 });
  return { tokensEntrada: tot.entrada, tokensSaida: tot.saida, reais: c.reais, usd: c.usd, linhas: c.linhas, cotacao: c.cotacao };
}
