// Carregador das regras de seção por tipo de site (M2.13 / SPEC §6.3).
//
// Lê regras/secoes/<tipo>.json (um ARRAY de seções; esquema em regras/schema/secao.schema.json) e devolve
// seções NORMALIZADAS. É propositalmente tolerante: campo ausente ganha valor padrão (e um aviso), seção sem
// `id` ou sem nome é descartada com aviso, regex inválida é ignorada com aviso. Assim os JSONs podem ser
// substituídos por uma camada local opcional sem mudar código (local/secoes-por-tipo/, D-028).
//
// Formato esperado de cada seção:
//   { id, tipo_de_site, nome, descricao, obrigatoriedade:'essencial'|'esperada'|'opcional', peso,
//     deteccao:{ seletores:[css], palavras:[pt-BR], padroes_regex:[], onde:'home'|'qualquer-pagina'|'pagina-propria',
//                detectavel_por_script:'sim'|'nao'|'parcial' }, fonte:[...], confianca }
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arquivoDeSecoesLocais, dirLocalPadrao, TIPO_VALIDO } from './camada-local.mjs';

export const TIPOS_DE_SITE = ['site-institucional', 'landing-page', 'blog', 'catalogo', 'loja', 'cardapio', 'agendamento', 'pagina-de-vendas', 'portfolio', 'link-na-bio', 'area-de-membros'];
export const DIR_REGRAS_SECOES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'regras', 'secoes');

const OBRIGATORIEDADES = ['essencial', 'esperada', 'opcional'];
const ONDE = ['home', 'qualquer-pagina', 'pagina-propria'];
const DETECTAVEL = ['sim', 'nao', 'parcial'];
const CONFIANCAS = ['alta', 'media', 'baixa'];
const SELOS = ['fato', 'regra', 'opiniao', 'nao-verificavel'];

const listaDeTexto = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

// Normaliza UMA seção bruta. Devolve { secao|null, avisos[] }.
export function normalizarSecao(bruta, { tipo = null, indice = 0 } = {}) {
  const avisos = [];
  const rotulo = bruta && typeof bruta === 'object' && bruta.id ? bruta.id : `#${indice}`;
  if (!bruta || typeof bruta !== 'object' || Array.isArray(bruta)) return { secao: null, avisos: [`seção ${rotulo}: não é um objeto; ignorada`] };
  if (typeof bruta.id !== 'string' || !bruta.id.trim()) return { secao: null, avisos: [`seção ${rotulo}: sem id; ignorada`] };
  const nome = typeof bruta.nome === 'string' && bruta.nome.trim() ? bruta.nome.trim() : null;
  if (!nome) avisos.push(`seção ${rotulo}: sem nome; usei o id`);
  const det = bruta.deteccao && typeof bruta.deteccao === 'object' ? bruta.deteccao : {};
  if (!bruta.deteccao) avisos.push(`seção ${rotulo}: sem deteccao; só será 'indeterminada'`);

  let obrig = bruta.obrigatoriedade;
  if (!OBRIGATORIEDADES.includes(obrig)) { if (obrig !== undefined) avisos.push(`seção ${rotulo}: obrigatoriedade inválida (${obrig}); usei 'esperada'`); obrig = 'esperada'; }
  let peso = Number(bruta.peso);
  if (!Number.isFinite(peso)) { peso = 5; if (bruta.peso !== undefined) avisos.push(`seção ${rotulo}: peso inválido; usei 5`); }
  peso = Math.min(10, Math.max(0, peso));
  let onde = det.onde;
  if (!ONDE.includes(onde)) { if (onde !== undefined) avisos.push(`seção ${rotulo}: 'onde' inválido (${onde}); usei 'qualquer-pagina'`); onde = 'qualquer-pagina'; }
  let detectavel = det.detectavel_por_script;
  if (!DETECTAVEL.includes(detectavel)) { if (detectavel !== undefined) avisos.push(`seção ${rotulo}: detectavel_por_script inválido; usei 'parcial'`); detectavel = 'parcial'; }
  const confianca = CONFIANCAS.includes(bruta.confianca) ? bruta.confianca : 'baixa';

  const secao = {
    id: bruta.id.trim(),
    tipo_de_site: typeof bruta.tipo_de_site === 'string' ? bruta.tipo_de_site : tipo,
    nome: nome || bruta.id.trim(),
    descricao: typeof bruta.descricao === 'string' ? bruta.descricao : '',
    obrigatoriedade: obrig,
    peso,
    deteccao: { seletores: listaDeTexto(det.seletores), palavras: listaDeTexto(det.palavras), padroes_regex: listaDeTexto(det.padroes_regex), onde, detectavel_por_script: detectavel },
    fonte: Array.isArray(bruta.fonte) ? bruta.fonte : [],
    confianca,
    notas: typeof bruta.notas === 'string' ? bruta.notas : '',
  };
  // Campos opcionais (camada local): onde na jornada a seção fica, ordem sugerida, texto do botão e selo próprio.
  if (typeof bruta.pagina === 'string' && bruta.pagina.trim()) secao.pagina = bruta.pagina.trim();
  if (Number.isFinite(Number(bruta.ordem))) secao.ordem = Number(bruta.ordem);
  if (typeof bruta.cta === 'string' && bruta.cta.trim()) secao.cta = bruta.cta.trim();
  if (SELOS.includes(bruta.selo)) secao.selo = bruta.selo;
  return { secao, avisos };
}

// Lê UM arquivo de seções. Devolve { secoes, avisos, meta } ou { erro }.
function lerArquivoDeSecoes(arquivo, tipo) {
  let bruto;
  try { bruto = JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '')); } catch (e) { return { erro: `JSON inválido em ${arquivo}: ${String(e.message).split(String.fromCharCode(10))[0]}` }; }
  const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.secoes) ? bruto.secoes : null);
  if (!lista) return { erro: `formato inesperado em ${arquivo}: esperava um array de seções` };
  const avisos = [];
  const secoes = [];
  const vistos = new Set();
  lista.forEach((b, i) => {
    const { secao, avisos: av } = normalizarSecao(b, { tipo, indice: i });
    avisos.push(...av);
    if (!secao) return;
    if (vistos.has(secao.id)) { avisos.push(`seção ${secao.id}: id repetido; ignorei a repetição`); return; }
    vistos.add(secao.id);
    secoes.push(secao);
  });
  const meta = !Array.isArray(bruto) && bruto.meta && typeof bruto.meta === 'object' && !Array.isArray(bruto.meta) ? bruto.meta : null;
  return { secoes, avisos, meta };
}

// Carrega as seções de um tipo. Nunca lança por conteúdo ruim: devolve { erro } ou avisos.
// Precedência (D-028): se existir local/secoes-por-tipo/<tipo>.json válido, ele vale MAIS que o público daquele tipo;
// JSON quebrado ou vazio na camada local vira aviso e o público é usado. dirRegras/dirLocal são injetáveis (testes);
// injetar só dirRegras desliga a camada local (teste hermético).
export function carregarSecoes(tipo, { dirRegras = DIR_REGRAS_SECOES, dirLocal } = {}) {
  const base = { tipo, arquivo: null, origem: 'publica', secoes: [], avisos: [], meta: null };
  const local = dirLocal !== undefined ? dirLocal : (dirRegras === DIR_REGRAS_SECOES ? dirLocalPadrao() : null);
  const arqLocal = arquivoDeSecoesLocais(tipo, local);
  if (arqLocal && existsSync(arqLocal)) {
    const l = lerArquivoDeSecoes(arqLocal, tipo);
    if (l.erro) base.avisos.push(`camada local ignorada: ${l.erro}; usei as seções públicas`);
    else if (!l.secoes.length) base.avisos.push(`camada local ignorada: ${arqLocal} não tem nenhuma seção válida; usei as seções públicas`);
    else return { ...base, arquivo: arqLocal, origem: 'local', secoes: l.secoes, avisos: [...base.avisos, ...l.avisos], meta: l.meta };
  }
  if (!TIPOS_DE_SITE.includes(tipo)) return { ...base, erro: `tipo de site desconhecido: ${String(tipo)}${TIPO_VALIDO.test(String(tipo)) && local ? ' (nem a camada local tem seções para ele)' : ''}` };
  const arquivo = join(resolve(dirRegras), `${tipo}.json`);
  base.arquivo = arquivo;
  if (!existsSync(arquivo)) return { ...base, erro: `arquivo de regras não encontrado: ${arquivo}` };
  const p = lerArquivoDeSecoes(arquivo, tipo);
  if (p.erro) return { ...base, erro: p.erro };
  return { ...base, secoes: p.secoes, avisos: [...base.avisos, ...p.avisos], meta: p.meta };
}

// ---------- compilação da detecção (usada pelo medidor) ----------

export const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
// Texto para comparação: NFKC, minúsculo, sem acento, espaços normalizados.
export const normalizarParaBusca = (s) => semAcento(String(s ?? '').normalize('NFKC').toLowerCase()).replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Seletor de tag pura (ex.: `footer`, `address`, `form`): indica ONDE olhar, mas não prova a seção.
export const seletorGenerico = (s) => /^[a-z][a-z0-9-]*$/i.test(s.trim());

export function compilarDeteccao(secao) {
  const avisos = [];
  const palavras = [];
  for (const termo of secao.deteccao.palavras) {
    const f = normalizarParaBusca(termo);
    if (!f) continue;
    const corpo = escaparRegex(f).replace(/ /g, '\\s+');
    // começa em limite de palavra; termos curtos (cpf, faq) também exigem limite no fim; os demais aceitam plural/flexão.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${corpo}${f.length <= 3 ? '(?![\\p{L}\\p{N}])' : ''}`, 'u');
    palavras.push({ termo, re });
  }
  const regexes = [];
  for (const p of secao.deteccao.padroes_regex) {
    let re = null;
    for (const flags of ['iu', 'i']) { try { re = new RegExp(p, flags); break; } catch { /* tenta sem 'u' */ } }
    if (re) regexes.push({ padrao: p, re }); else avisos.push(`seção ${secao.id}: regex inválida ignorada: ${p}`);
  }
  const seletores = secao.deteccao.seletores.map((s) => ({ seletor: s, generico: seletorGenerico(s) }));
  return { palavras, regexes, seletores, avisos };
}
