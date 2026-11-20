// NOTA DE SEO ("Subir no Google"), 0 a 100, maior é melhor. Determinística: só regras, sem Lighthouse e sem modelo.
// Fórmula (a mesma das notas por área, selo opinião): nota = 100 − 100·S/(S+C), com S = Σ(peso × fator da severidade × intensidade)
// das regras de SEO disparadas e C = config.nota.constante_C. Regras de outras áreas que contam para SEO entram por referência
// (config/seo-google.json), sem serem duplicadas. A nota mede aderência a regras documentadas; NÃO prevê posição no Google.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FATOR_SEV, NIVEIS } from './notas.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function carregarConfigSeo(arquivo = join(raiz, 'config', 'seo-google.json')) { return JSON.parse(readFileSync(arquivo, 'utf8')); }

const arred = (x) => Math.round(x * 10) / 10;
const pontosS = (ts) => ts.filter((t) => t.disparou).reduce((s, t) => s + t.peso * (FATOR_SEV[t.severidade] ?? 1) * t.intensidade, 0);
const notaDe = (S, C) => 100 - (100 * S) / (S + C);

export const ESFORCO_PADRAO = { 'seo-h1-ausente': 'baixo', 'seo-viewport-ausente': 'baixo', 'seo-open-graph-incompleto': 'baixo', 'seo-local-telefone-sem-link': 'baixo', 'seo-local-sem-mapa': 'baixo', 'seo-eeat-data-ausente': 'baixo', 'seo-titulo-ausente-ou-vazio': 'baixo', 'seo-meta-description-ausente-ou-repetida': 'baixo', 'seo-canonical-ausente': 'baixo', 'a11y-imagem-sem-alt': 'baixo' };
const ordemEsforco = { baixo: 0, medio: 1, alto: 2 };

// tells: de rodarMotor (já sem os que o verificador descartou); regras: lista carregada; achados: aprovados (com id, titulo, selo).
export function calcularNotaSeo({ tells, regras = [], achados = [], config = carregarConfigSeo() }) {
  const C = config.nota.constante_C;
  const reaprov = new Set(config.regras_reaproveitadas_de_outras_areas || []);
  const cats = new Set(config.categorias_da_nota_de_seo || []);
  const avaliadas = tells.filter((t) => (cats.has(t.categoria) || reaprov.has(t.regra_id)) && t.peso > 0);
  if (!avaliadas.length) return { nota: null, nivel: null, semDados: true, avaliadas: 0, disparadas: 0, topo: [], selo: 'opiniao' };
  const S = pontosS(avaliadas);
  const nota = notaDe(S, C);
  const tituloDe = new Map(regras.map((r) => [r.id, r]));
  const contrib = avaliadas.filter((t) => t.disparou).map((t) => {
    const sem = notaDe(pontosS(avaliadas.filter((x) => x !== t)), C);
    const ach = achados.find((a) => a.regra_id === t.regra_id);
    const r = tituloDe.get(t.regra_id);
    return { regra_id: t.regra_id, titulo: ach?.titulo || r?.titulo || t.regra_id, selo: ach?.selo || r?.selo || 'opiniao', severidade: t.severidade, pontosPerdidos: arred(sem - nota), achado_id: ach?.id || null };
  }).sort((a, b) => b.pontosPerdidos - a.pontosPerdidos || a.regra_id.localeCompare(b.regra_id));
  return {
    nota: arred(nota), nivel: NIVEIS.find((n) => nota >= n.min).nivel, selo: 'opiniao', semDados: false,
    avaliadas: avaliadas.length, disparadas: contrib.length, topo: contrib.slice(0, config.top_achados_no_relatorio || 5), todos: contrib,
    observacao: 'Mede aderência a regras e recomendações documentadas. Não mede posição real, tráfego nem concorrência.',
  };
}

// Plano "como subir": ordena por impacto (pontos perdidos) e esforço (baixo primeiro). Cada item aponta o achado (e o prompt dele).
export function montarPlanoSeo(notaSeo) {
  const impacto = (p) => (p >= 3 ? 'alto' : p >= 1.5 ? 'medio' : 'baixo');
  const itens = (notaSeo?.todos || []).map((c) => ({ regra_id: c.regra_id, titulo: c.titulo, impacto: impacto(c.pontosPerdidos), esforco: ESFORCO_PADRAO[c.regra_id] || 'medio', pontosPerdidos: c.pontosPerdidos, achado_id: c.achado_id, selo: c.selo }));
  const pesoImp = { alto: 0, medio: 1, baixo: 2 };
  return itens.sort((a, b) => pesoImp[a.impacto] - pesoImp[b.impacto] || ordemEsforco[a.esforco] - ordemEsforco[b.esforco] || b.pontosPerdidos - a.pontosPerdidos || a.regra_id.localeCompare(b.regra_id));
}
