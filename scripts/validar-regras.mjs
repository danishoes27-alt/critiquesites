#!/usr/bin/env node
// Valida todos os arquivos regras/*.json contra o esquema e aplica regras extras.
// Uso: node scripts/validar-regras.mjs [pasta-ou-arquivo ...]   (padrão: regras/)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(raiz, 'regras/schema/regra.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validar = ajv.compile(schema);

function listar(alvo) {
  if (!existsSync(alvo)) return [];
  if (statSync(alvo).isFile()) return alvo.endsWith('.json') ? [alvo] : [];
  const saida = [];
  for (const nome of readdirSync(alvo)) {
    const p = join(alvo, nome);
    if (nome === 'schema' || nome === 'secoes' || nome === 'texto') continue; // têm formatos próprios
    if (statSync(p).isDirectory()) saida.push(...listar(p));
    else if (nome.endsWith('.json')) saida.push(p);
  }
  return saida;
}

export function validarArquivos(alvos) {
  const erros = [];
  const ids = new Map();
  let total = 0;
  for (const arq of alvos.flatMap(listar)) {
    let dados;
    try { dados = JSON.parse(readFileSync(arq, 'utf8')); }
    catch (e) { erros.push(`${arq}: JSON inválido (${e.message})`); continue; }
    if (!Array.isArray(dados)) { erros.push(`${arq}: o arquivo precisa ser um array de regras`); continue; }
    dados.forEach((r, i) => {
      total++;
      const onde = `${arq}[${i}]${r && r.id ? ' ' + r.id : ''}`;
      if (!validar(r)) {
        for (const e of validar.errors) erros.push(`${onde}: ${e.instancePath || '/'} ${e.message}`);
        return;
      }
      if (ids.has(r.id)) erros.push(`${onde}: id duplicado (também em ${ids.get(r.id)})`);
      else ids.set(r.id, arq);
      if (r.selo === 'fato' && r.deteccao.tipo !== 'script') erros.push(`${onde}: selo "fato" exige deteccao.tipo "script"`);
      if (r.deteccao.tipo === 'julgamento' && r.deteccao.detectavel_por_script !== 'nao') erros.push(`${onde}: julgamento puro deve ter detectavel_por_script "nao"`);
      if (r.deteccao.tipo === 'script' && r.deteccao.detectavel_por_script !== 'sim') erros.push(`${onde}: tipo script deve ter detectavel_por_script "sim"`);
      if (r.selo === 'regra' && !r.fonte.some((f) => f.url)) erros.push(`${onde}: selo "regra" exige fonte com url`);
      if (r.deteccao.medidor === 'robots' && /llms/.test(r.id) && r.peso !== 0) erros.push(`${onde}: llms.txt deve ter peso 0`);
      if (r.categoria === 'ia-visibilidade' && /bloquear|liberar/i.test(r.correcao) && /rastreador|crawler|bot/i.test(r.titulo)) erros.push(`${onde}: não pode mandar bloquear/liberar rastreadores de IA`);
      if (/escrit[oa] (por|pela) (ia|inteligência artificial)/i.test(r.titulo + ' ' + r.descricao)) erros.push(`${onde}: não pode afirmar autoria por IA`);
    });
  }
  return { erros, total, ids };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('validar-regras.mjs')) {
  const args = process.argv.slice(2);
  const alvos = (args.length ? args : ['regras']).map((a) => resolve(a));
  const { erros, total } = validarArquivos(alvos);
  if (erros.length) {
    console.error(erros.join('\n'));
    console.error(`\n${erros.length} erro(s) em ${total} regra(s).`);
    process.exit(1);
  }
  console.log(`OK: ${total} regra(s) válidas.`);
}
