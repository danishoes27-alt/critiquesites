// Compara a MESMA página lida em 3 versões (cru, dom250, final) e acha valores que mudam.
// Caso típico: contador animado que começa em 0 e termina em 54.
//
// Identidade do elemento entre versões: 1º pelo seletor; se o JS reestruturou o DOM (ex.: título dividido em
// <span> por palavra), 2º pela "assinatura" (classe + atributos data-*) mais a ordem entre iguais.
import { extrairNumeros, normalizarTexto } from './util.mjs';

const VERSOES = ['cru', 'dom250', 'final'];

// Assinatura ESTÁVEL do elemento: tag + primeira classe + atributos data-* que não mudam durante animações
// (ex.: data-now, data-current, data-state; e classes transitórias como "cnt-run" ficam de fora).
const VOLATIL = /(^|-)(now|current|state|active|run|running|index|progress|value)($|-)/i;
function assinatura(n) {
  const classe = String(n.classe || '').split(/\s+/).filter(Boolean)[0] || '';
  const dados = String(n.dados || '').split(';').filter((d) => d && !VOLATIL.test(d.split('=')[0].replace(/^data-/, ''))).join(';');
  return (classe || dados) ? `${n.tag}|${classe}|${dados}` : null;
}

function indexar(extr) {
  const porSeletor = new Map();
  const porAssinatura = new Map(); // assinatura -> [nós em ordem]
  if (!extr) return { porSeletor, porAssinatura };
  for (const n of extr.nos) {
    const mostrado = n.exibido ?? n.texto;
    if (n.clone || !/\d/.test(mostrado) || mostrado.length > 60) continue;
    porSeletor.set(n.seletor, n);
    const sig = assinatura(n);
    if (sig) { if (!porAssinatura.has(sig)) porAssinatura.set(sig, []); porAssinatura.get(sig).push(n); }
  }
  return { porSeletor, porAssinatura };
}

function tendencia(nums) {
  const v = nums.filter((x) => x !== null);
  if (v.length < 2) return 'variavel';
  let cresce = true, decresce = true;
  for (let i = 1; i < v.length; i++) { if (v[i] < v[i - 1]) cresce = false; if (v[i] > v[i - 1]) decresce = false; }
  if (cresce && !decresce) return 'crescente';
  if (decresce && !cresce) return 'decrescente';
  return 'variavel';
}

// leituras: { cru: extr, dom250: extr, final: extr } (qualquer uma pode faltar)
export function compararVersoes(leituras) {
  const idx = Object.fromEntries(VERSOES.map((v) => [v, indexar(leituras[v])]));
  const baseVersao = ['final', 'dom250', 'cru'].find((v) => idx[v].porSeletor.size);
  if (!baseVersao) return [];
  const diferencas = [];
  const visto = new Set();
  // posição do nó dentro do grupo de mesma assinatura na versão-base
  const ordem = new Map();
  for (const lista of idx[baseVersao].porAssinatura.values()) lista.forEach((n, i) => ordem.set(n, i));

  for (const [seletor, noBase] of idx[baseVersao].porSeletor) {
    const sig = assinatura(noBase);
    const posicao = ordem.get(noBase) ?? 0;
    const achados = {};
    for (const v of VERSOES) {
      if (v === baseVersao) { achados[v] = noBase; continue; }
      let n = idx[v].porSeletor.get(seletor);
      // se o seletor existe mas a assinatura mudou, o elemento é outro: use a assinatura
      if (n && sig && assinatura(n) !== sig) n = null;
      if (!n && sig) n = idx[v].porAssinatura.get(sig)?.[posicao] || null;
      if (n) achados[v] = n;
    }
    const presentes = VERSOES.filter((v) => achados[v]);
    if (presentes.length < 2) continue;
    const chave = presentes.map((v) => achados[v].seletor).join('~');
    if (visto.has(chave)) continue;
    visto.add(chave);
    const textos = Object.fromEntries(presentes.map((v) => [v, achados[v].exibido ?? achados[v].texto]));
    const viaCss = presentes.filter((v) => achados[v].exibido != null);
    const nums = Object.fromEntries(presentes.map((v) => [v, extrairNumeros(textos[v])]));
    if (new Set(presentes.map((v) => JSON.stringify(nums[v]))).size === 1) continue;
    const serie = presentes.map((v) => (nums[v].length === 1 ? nums[v][0] : null));
    const tend = tendencia(serie);
    diferencas.push({
      seletor,
      seletores: Object.fromEntries(presentes.map((v) => [v, achados[v].seletor])),
      tag: noBase.tag,
      classe: noBase.classe || '',
      leituras: textos,
      viaCss, // versões em que o número mostrado veio de CSS (::after/::before), não do texto do HTML
      textoNoHtml: Object.fromEntries(presentes.map((v) => [v, achados[v].texto])),
      numeros: nums,
      versoes: presentes,
      tendencia: tend,
      visivelNoFinal: !!achados.final?.visivel,
      // contador animado: cresce ao longo das versões, OU a captura rápida (250 ms) mostra valor menor que o final
      contadorAnimado: (tend === 'crescente' && nums[presentes[0]].length === 1 && nums[presentes[0]][0] < nums[presentes[presentes.length - 1]][0])
        || (!!achados.dom250 && !!achados.final && nums.dom250.length === 1 && nums.final.length === 1 && nums.dom250[0] < nums.final[0]),
    });
  }
  return diferencas;
}

// Textos presentes só em uma versão (conteúdo que depende de JavaScript): visíveis e não-clone.
export function conteudoSoComJs(leituras, { minimo = 20 } = {}) {
  const textoDe = (extr) => new Set((extr?.nos || []).filter((n) => n.visivel && !n.clone).map((n) => normalizarTexto(n.texto)));
  const cru = textoDe(leituras.cru);
  const final = textoDe(leituras.final);
  const soNoFinal = [...final].filter((t) => t.length >= minimo && !cru.has(t));
  const totalFinal = [...final].filter((t) => t.length >= minimo).length;
  return { soNoFinal: soNoFinal.length, totalFinal, proporcao: totalFinal ? soNoFinal.length / totalFinal : 0, amostra: soNoFinal.slice(0, 10) };
}
