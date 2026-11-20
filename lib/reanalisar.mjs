// REANALISAR: compara duas análises do mesmo site e mostra a evolução da nota.
// Uma análise salva (analise.json) precisa ter: carimbo{iso,hash,versaoRegras}, notas{tell,categorias[],geral}, achados[].
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Chave estável de um achado entre análises: regra + página + âncora (seletor ou trecho da 1ª evidência).
export function chaveDoAchado(a) {
  const e = (a.evidencias || [])[0] || {};
  const ancora = String(e.seletor || e.trecho || e.valor || '').slice(0, 80);
  return `${a.regra_id}|${a.pagina}|${ancora}`;
}

const arred = (x) => Math.round(x * 10) / 10;

export function compararAnalises(antes, depois) {
  const mesmoHash = antes.carimbo.hash === depois.carimbo.hash;
  const regrasDiferentes = antes.carimbo.versaoRegras !== depois.carimbo.versaoRegras;
  const mapa = (lista) => new Map((lista || []).filter((a) => a.peso_aplicado !== 0).map((a) => [chaveDoAchado(a), a]));
  const A = mapa(antes.achados), D = mapa(depois.achados);
  const resolvidos = [...A.keys()].filter((k) => !D.has(k)).map((k) => ({ chave: k, regra_id: A.get(k).regra_id, titulo: A.get(k).titulo }));
  const novos = [...D.keys()].filter((k) => !A.has(k)).map((k) => ({ chave: k, regra_id: D.get(k).regra_id, titulo: D.get(k).titulo }));
  const persistentes = [...D.keys()].filter((k) => A.has(k)).map((k) => ({ chave: k, regra_id: D.get(k).regra_id, titulo: D.get(k).titulo }));
  const tellAntes = antes.notas.tell?.nota, tellDepois = depois.notas.tell?.nota;
  const deltaTell = typeof tellAntes === 'number' && typeof tellDepois === 'number' ? arred(tellDepois - tellAntes) : null;
  const catAntes = new Map((antes.notas.categorias || []).map((c) => [c.id, c]));
  const deltaCategorias = (depois.notas.categorias || []).filter((c) => catAntes.has(c.id)).map((c) => ({ id: c.id, rotulo: c.rotulo, antes: catAntes.get(c.id).nota, depois: c.nota, delta: arred(c.nota - catAntes.get(c.id).nota) }));
  const seoAntes = antes.seoGoogle?.nota?.nota, seoDepois = depois.seoGoogle?.nota?.nota;
  const deltaSeo = typeof seoAntes === 'number' && typeof seoDepois === 'number' ? arred(seoDepois - seoAntes) : null;
  const deltaGeral = arred((depois.notas.geral?.nota ?? 0) - (antes.notas.geral?.nota ?? 0));

  let mensagem;
  if (mesmoHash) mensagem = 'Nada mudou no código analisado desde a última vez (mesmo hash). A nota objetiva é a mesma.';
  else if (deltaTell === null) mensagem = 'Comparação com a análise anterior (sem Tell Score nas duas).';
  else if (deltaTell < 0) mensagem = `O Tell Score melhorou: de ${tellAntes} para ${tellDepois} (menor é melhor).`;
  else if (deltaTell > 0) mensagem = `O Tell Score piorou: de ${tellAntes} para ${tellDepois} (menor é melhor).`;
  else mensagem = `O Tell Score ficou igual (${tellDepois}).`;
  if (deltaSeo !== null) mensagem += deltaSeo > 0 ? ` A nota de SEO subiu de ${seoAntes} para ${seoDepois} (maior é melhor).` : deltaSeo < 0 ? ` A nota de SEO caiu de ${seoAntes} para ${seoDepois} (maior é melhor).` : ` A nota de SEO ficou igual (${seoDepois}).`;
  if (regrasDiferentes && !mesmoHash) mensagem += ' Atenção: o conjunto de regras mudou entre as duas análises, então a comparação não é exatamente igual para igual.';
  if (mesmoHash && regrasDiferentes) mensagem += ' O conjunto de regras mudou, então a nota pode ter mudado por isso.';

  return {
    mensagem, mesmoHash, regrasDiferentes,
    seoAntes: typeof seoAntes === 'number' ? seoAntes : null, seoDepois: typeof seoDepois === 'number' ? seoDepois : null, deltaSeo,
    carimbo: antes.carimbo, tellAntes, tellDepois, deltaTell, deltaGeral, deltaCategorias,
    resolvidos, novos, persistentes,
  };
}

// Pastas de análise ficam em saidas/<slug>/<AAAAMMDD-HHMM>-<hash8>/ com analise.json. Acha a mais recente antes de `atual`.
export function acharAnaliseAnterior(pastaSite, atual = null) {
  if (!existsSync(pastaSite)) return null;
  const pastas = readdirSync(pastaSite).filter((n) => /^\d{8}-\d{4}-[0-9a-f]{8}$/.test(n) && existsSync(join(pastaSite, n, 'analise.json'))).sort();
  const candidatas = atual ? pastas.filter((n) => n < atual) : pastas;
  if (!candidatas.length) return null;
  const nome = candidatas[candidatas.length - 1];
  return { pasta: join(pastaSite, nome), nome, analise: JSON.parse(readFileSync(join(pastaSite, nome, 'analise.json'), 'utf8')) };
}
