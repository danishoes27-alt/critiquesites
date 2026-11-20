#!/usr/bin/env node
// Valida regras/secoes/*.json (seções esperadas por tipo de site) contra regras/schema/secao.schema.json
// e aplica regras extras. Uso: node scripts/validar-secoes.mjs [pasta-ou-arquivo ...]   (padrão: regras/secoes/)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(raiz, 'regras/schema/secao.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validar = ajv.compile(schema);

export const TIPOS = ['site-institucional', 'landing-page', 'blog', 'catalogo', 'loja', 'cardapio', 'agendamento', 'pagina-de-vendas', 'portfolio', 'link-na-bio', 'area-de-membros'];
const FAIXAS = { essencial: [7, 10], esperada: [4, 6], opcional: [1, 3] };
const MIN_SECOES = 8;
const MAX_SECOES = 16;

function listar(alvo) {
  if (!existsSync(alvo)) return [];
  if (statSync(alvo).isFile()) return alvo.endsWith('.json') ? [alvo] : [];
  return readdirSync(alvo).filter((n) => n.endsWith('.json')).map((n) => join(alvo, n));
}

export function validarSecoes(alvos, { exigirTodosOsTipos = true } = {}) {
  const erros = [];
  const avisos = [];
  const tiposVistos = new Set();
  let total = 0;
  for (const arq of alvos.flatMap(listar)) {
    const nomeArq = basename(arq, '.json');
    let dados;
    try { dados = JSON.parse(readFileSync(arq, 'utf8')); }
    catch (e) { erros.push(`${arq}: JSON inválido (${e.message})`); continue; }
    if (!validar(dados)) {
      for (const e of validar.errors) erros.push(`${arq}: ${e.instancePath || '/'} ${e.message}`);
      continue;
    }
    if (!TIPOS.includes(nomeArq)) erros.push(`${arq}: nome do arquivo não é um tipo de site conhecido`);
    tiposVistos.add(nomeArq);
    const ids = new Set();
    let essenciais = 0;
    dados.forEach((s, i) => {
      total++;
      const onde = `${arq}[${i}] ${s.id}`;
      if (s.tipo_de_site !== nomeArq) erros.push(`${onde}: tipo_de_site "${s.tipo_de_site}" difere do nome do arquivo "${nomeArq}"`);
      if (ids.has(s.id)) erros.push(`${onde}: id duplicado dentro do tipo ${nomeArq}`);
      ids.add(s.id);
      if (s.obrigatoriedade === 'essencial') essenciais++;
      const [min, max] = FAIXAS[s.obrigatoriedade];
      if (s.peso < min || s.peso > max) erros.push(`${onde}: peso ${s.peso} fora da faixa de "${s.obrigatoriedade}" (${min}-${max})`);
      if (!s.fonte.some((f) => /^https:\/\//.test(f.url))) erros.push(`${onde}: toda seção precisa de fonte com url (sem fonte = sem regra)`);
      const d = s.deteccao;
      if (d.palavras.some((p) => p !== p.toLowerCase())) erros.push(`${onde}: palavras devem estar em minúsculas`);
      for (const rx of d.padroes_regex) {
        try { new RegExp(rx, 'i'); } catch (e) { erros.push(`${onde}: regex inválida "${rx}" (${e.message})`); }
      }
      if (d.detectavel_por_script !== 'nao' && !d.seletores.length && !d.palavras.length && !d.padroes_regex.length) {
        erros.push(`${onde}: detectavel_por_script "${d.detectavel_por_script}" exige ao menos um seletor, palavra ou regex`);
      }
      if (s.confianca === 'baixa' && !/a calibrar|inferên|inferido|sem fonte espec/i.test(s.notas)) avisos.push(`${onde}: confianca "baixa" sem explicação nas notas`);
      if (/escrit[oa] (por|pela) (ia|inteligência artificial)/i.test(`${s.nome} ${s.descricao}`)) erros.push(`${onde}: não pode afirmar autoria por IA`);
    });
    if (essenciais < 1) erros.push(`${arq}: precisa de pelo menos 1 seção "essencial" por tipo`);
    if (dados.length < MIN_SECOES || dados.length > MAX_SECOES) {
      erros.push(`${arq}: ${dados.length} seção(ões); o esperado é de ${MIN_SECOES} a ${MAX_SECOES}`);
    }
  }
  if (exigirTodosOsTipos) {
    for (const t of TIPOS) if (!tiposVistos.has(t)) erros.push(`regras/secoes/${t}.json: arquivo ausente (todo tipo de site precisa do seu)`);
  }
  return { erros, avisos, total, tipos: tiposVistos };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('validar-secoes.mjs')) {
  const args = process.argv.slice(2);
  const alvos = (args.length ? args : ['regras/secoes']).map((a) => resolve(a));
  // com argumentos explícitos (arquivo isolado), não exige os 11 tipos
  const { erros, avisos, total, tipos } = validarSecoes(alvos, { exigirTodosOsTipos: !args.length });
  for (const a of avisos) console.warn(`aviso: ${a}`);
  if (erros.length) {
    console.error(erros.join('\n'));
    console.error(`\n${erros.length} erro(s) em ${total} seção(ões).`);
    process.exit(1);
  }
  console.log(`OK: ${total} seção(ões) válidas em ${tipos.size} tipo(s).`);
}
