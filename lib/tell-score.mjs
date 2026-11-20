// TELL SCORE: "cara de IA / visual genérico", 0 a 100, MENOR É MELHOR. Determinístico na parte objetiva.
//
// Cada regra de "tell" que dispara soma peso × intensidade. A nota cresce rápido no começo e satura:
//     nota = 100 × S / (S + C)        onde S = Σ(peso × intensidade) e C = constante de meia-saturação
// (nota 50 quando S = C). Escolha motivada pela diluição: com ~100 regras no conjunto, dividir pelo peso
// TOTAL achataria a nota (ver DECISOES.md D-007). C é ponto de partida e será calibrado no teste de acerto.
//
// Créditos de craft (ideia do ai-design-tells, MIT): se o site mostra escolhas deliberadas (fonte própria,
// tracking em títulos, escala de raios, foco visível), os tells "de fábrica" mais ambíguos pesam menos.
// Julgamento do modelo ajusta no máximo ±10 pontos, sempre marcado como opinião.

export const CATEGORIAS_TELL = ['visual-cor', 'visual-tipografia', 'visual-superficie', 'visual-iconografia', 'visual-movimento', 'layout-espacamento', 'estrutura-padrao', 'texto-generico'];

export const PARAMETROS = {
  C: 57.3, // calibrado (scripts/calibrar.mjs, só no treino): o limiar do treino vira nota 45; não muda a separação, só a escala
  multiplicadores: {}, // {categoria: fator}; vazio = 1 para todas. Preenchido pela calibração.
  limiteAjusteModelo: 10,
  faixas: [ // menor é melhor
    { ate: 12, letra: 'A', rotulo: 'Parece feito por gente, com identidade' },
    { ate: 28, letra: 'B', rotulo: 'Poucos sinais de padrão' },
    { ate: 45, letra: 'C', rotulo: 'Vários sinais de padrão' },
    { ate: 65, letra: 'D', rotulo: 'Muitos sinais de padrão' },
    { ate: 101, letra: 'F', rotulo: 'Visual de fábrica quase inteiro' },
  ],
  // Sinais de craft = regras AVALIADAS que NÃO dispararam. Precisam de >= minimo para dar crédito.
  craft: { sinais: ['tipo-fonte-padrao', 'tipo-titulo-sem-tracking', 'sup-raio-unico-em-tudo', 'sup-sombra-difusa-padrao', 'int-foco-invisivel-no-teclado'], minimo: 3, fator: 0.5, atenuaveis: ['cor-roxo-indigo-padrao', 'cor-gradiente-azul-roxo', 'sup-sombra-difusa-padrao', 'cor-sem-tokens-semanticos'] },
};

export function faixaDoTell(nota, p = PARAMETROS) {
  return p.faixas.find((f) => nota < f.ate);
}

// tells: [{ regra_id, categoria, peso, disparou, intensidade }]  (saída de rodarMotor().tells)
export function calcularTellScore(tells, { ajusteModelo = null, parametros = PARAMETROS, instaveis = [] } = {}) {
  const p = parametros;
  const dos = tells.filter((t) => CATEGORIAS_TELL.includes(t.categoria) && t.peso > 0 && !instaveis.includes(t.regra_id));
  const todosPorId = new Map(tells.map((t) => [t.regra_id, t])); // sinais de craft podem vir de qualquer categoria
  const craftPresentes = p.craft.sinais.filter((id) => todosPorId.has(id) && !todosPorId.get(id).disparou);
  const credito = craftPresentes.length >= p.craft.minimo;
  let S = 0;
  const contribuicoes = [];
  for (const t of dos) {
    if (!t.disparou) continue;
    const fator = credito && p.craft.atenuaveis.includes(t.regra_id) ? p.craft.fator : 1;
    const mult = p.multiplicadores?.[t.categoria] ?? 1; // calibração por categoria (docs/teste-de-acerto.md)
    const pontos = t.peso * t.intensidade * fator * mult;
    S += pontos;
    contribuicoes.push({ regra_id: t.regra_id, categoria: t.categoria, peso: t.peso, intensidade: t.intensidade, fator: fator * mult, pontos });
  }
  contribuicoes.sort((a, b) => b.pontos - a.pontos || a.regra_id.localeCompare(b.regra_id));
  const objetiva = S === 0 ? 0 : (100 * S) / (S + p.C);
  let ajuste = 0;
  if (ajusteModelo && Number.isFinite(ajusteModelo.delta)) ajuste = Math.max(-p.limiteAjusteModelo, Math.min(p.limiteAjusteModelo, ajusteModelo.delta));
  const nota = Math.max(0, Math.min(100, objetiva + ajuste));
  const arred = (x) => Math.round(x * 10) / 10;
  return {
    nota: arred(nota),
    objetiva: arred(objetiva),
    ajusteModelo: { aplicado: ajuste, pedido: ajusteModelo?.delta ?? 0, motivo: ajusteModelo?.motivo ?? null, selo: ajuste ? 'opiniao' : null },
    faixa: faixaDoTell(nota, p),
    somaPontos: arred(S),
    regrasAvaliadas: dos.length,
    regrasDisparadas: contribuicoes.length,
    creditoDeCraft: { aplicado: credito, sinais: craftPresentes },
    contribuicoes: contribuicoes.slice(0, 15),
    porCategoria: Object.fromEntries(CATEGORIAS_TELL.map((c) => [c, arred(contribuicoes.filter((x) => x.categoria === c).reduce((s, x) => s + x.pontos, 0))])),
    parametros: { C: p.C },
  };
}
