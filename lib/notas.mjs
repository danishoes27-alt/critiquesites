// NOTAS POR ÁREA (0 a 100, MAIOR é melhor) e nível geral. Heurística documentada (selo: opinião):
// cada área vira nota = 100 − 100·S/(S+C), com S = Σ(peso × fator da severidade × intensidade) dos achados
// disparados na área. Se o Lighthouse mediu a área, a nota final é a média das duas leituras.
// O Tell Score (menor é melhor) entra na nota geral como "estrutura e visual" = 100 − Tell Score.
export const AREAS = [
  { id: 'acessibilidade', rotulo: 'Acessibilidade', categorias: ['acessibilidade', 'interacao-estados'], lighthouse: 'accessibility', peso: 20 },
  { id: 'performance', rotulo: 'Performance', categorias: ['performance'], lighthouse: 'performance', peso: 15 },
  { id: 'seo', rotulo: 'SEO e visibilidade em IA', categorias: ['seo', 'ia-visibilidade'], lighthouse: 'seo', peso: 15 },
  { id: 'texto', rotulo: 'Texto e conteúdo', categorias: ['texto-generico', 'conteudo-confianca'], lighthouse: null, peso: 15 },
  { id: 'lei', rotulo: 'Transparência e lei (avisos)', categorias: ['lei-br'], lighthouse: null, peso: 15 },
];
export const PESO_ESTRUTURA = 20;
export const C_AREA = 30;
export const FATOR_SEV = { P0: 2, P1: 1.5, P2: 1, P3: 0.5, tell: 1, smell: 0.5, info: 0 };
export const NIVEIS = [
  { min: 85, nivel: 'Excelente' },
  { min: 70, nivel: 'Sólido' },
  { min: 50, nivel: 'Em evolução' },
  { min: 0, nivel: 'Iniciante' },
];
const arred = (x) => Math.round(x * 10) / 10;

// tells: de rodarMotor; lighthouse: dados do medidor lighthouse (opcional) { scores: {performance, accessibility, seo} } média das páginas
export function calcularNotas({ tells, tellScore, lighthouse = null }) {
  const categorias = [];
  for (const area of AREAS) {
    const avaliadas = tells.filter((t) => area.categorias.includes(t.categoria) && t.peso > 0);
    const lh = area.lighthouse && lighthouse?.scores?.[area.lighthouse];
    if (!avaliadas.length && typeof lh !== 'number') { categorias.push({ id: area.id, rotulo: area.rotulo, nota: null, detalhe: 'Sem dados nesta análise', peso: area.peso }); continue; }
    const S = avaliadas.filter((t) => t.disparou).reduce((s, t) => s + t.peso * (FATOR_SEV[t.severidade] ?? 1) * t.intensidade, 0);
    const porRegras = avaliadas.length ? 100 - (100 * S) / (S + C_AREA) : null;
    let nota, detalhe;
    if (porRegras !== null && typeof lh === 'number') { nota = (porRegras + lh) / 2; detalhe = `regras ${Math.round(porRegras)} · Lighthouse ${Math.round(lh)}`; }
    else if (porRegras !== null) { nota = porRegras; detalhe = `${avaliadas.filter((t) => t.disparou).length} de ${avaliadas.length} regras apontaram algo`; }
    else { nota = lh; detalhe = 'só Lighthouse'; }
    categorias.push({ id: area.id, rotulo: area.rotulo, nota: arred(nota), detalhe, peso: area.peso });
  }
  if (tellScore) categorias.push({ id: 'estrutura-visual', rotulo: 'Visual e estrutura (100 − Tell Score)', nota: arred(100 - tellScore.nota), detalhe: `Tell Score ${tellScore.nota} (menor é melhor)`, peso: PESO_ESTRUTURA });
  const com = categorias.filter((c) => typeof c.nota === 'number');
  const pesoTotal = com.reduce((s, c) => s + c.peso, 0);
  const geral = pesoTotal ? arred(com.reduce((s, c) => s + c.nota * c.peso, 0) / pesoTotal) : 0;
  return {
    categorias: categorias.map(({ peso, ...c }) => ({ ...c, nota: c.nota === null ? 0 : c.nota, semDados: c.nota === null })),
    geral: { nota: geral, nivel: NIVEIS.find((n) => geral >= n.min).nivel, selo: 'opiniao', observacao: 'Média ponderada das áreas medidas; os pesos são uma heurística inicial a calibrar.' },
  };
}
