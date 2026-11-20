#!/usr/bin/env node
// Gera docs/taxonomia-proposta.md a partir de regras/*.json (fonte única da verdade).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirRegras = join(raiz, 'regras');

const regras = [];
for (const nome of readdirSync(dirRegras).sort()) {
  if (!nome.endsWith('.json')) continue;
  const dados = JSON.parse(readFileSync(join(dirRegras, nome), 'utf8'));
  if (Array.isArray(dados)) for (const r of dados) regras.push({ ...r, _arquivo: nome });
}

const porCategoria = new Map();
for (const r of regras) {
  if (!porCategoria.has(r.categoria)) porCategoria.set(r.categoria, []);
  porCategoria.get(r.categoria).push(r);
}

const contar = (lista, f) => lista.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const origemRepo = (id) => id.split(':')[0];
const media = (v) => (v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '0');

let md = `# Taxonomia proposta (v1)\n\n`;
md += `Gerado por \`scripts/gerar-taxonomia.mjs\` a partir de \`regras/*.json\`. Não edite à mão: edite as regras e gere de novo.\n\n`;
md += `Total: **${regras.length} regras** em **${porCategoria.size} categorias**.\n\n`;

// Resumo
md += `## Resumo por categoria\n\n| Categoria | Regras | Script (sim) | Parcial | Julgamento (não) | Peso médio | Fundidas de 2+ origens |\n|---|---:|---:|---:|---:|---:|---:|\n`;
for (const [cat, lista] of [...porCategoria].sort()) {
  const d = contar(lista, (r) => r.deteccao.detectavel_por_script);
  const fund = lista.filter((r) => r.origem_ids.length >= 2).length;
  md += `| ${cat} | ${lista.length} | ${d.sim || 0} | ${d.parcial || 0} | ${d.nao || 0} | ${media(lista.map((r) => r.peso))} | ${fund} |\n`;
}

// Origens e licenças
const origens = new Map();
for (const r of regras) {
  for (const f of r.fonte) {
    const chave = `${f.nome} | ${f.licenca}`;
    origens.set(chave, (origens.get(chave) || 0) + 1);
  }
}
md += `\n## Fontes e licenças (quantas regras citam cada uma)\n\n| Fonte | Licença | Regras |\n|---|---|---:|\n`;
for (const [k, n] of [...origens].sort((a, b) => b[1] - a[1])) {
  const [nome, lic] = k.split(' | ');
  md += `| ${nome} | ${lic} | ${n} |\n`;
}

// Selos e confiança
const selos = contar(regras, (r) => r.selo);
const conf = contar(regras, (r) => r.confianca);
md += `\n## Selos e confiança\n\n- Selos: ${Object.entries(selos).map(([k, v]) => `${k}: ${v}`).join(', ')}\n- Confiança: ${Object.entries(conf).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;

// 10 exemplos por categoria
md += `\n## Exemplos por categoria (até 10, os de maior peso)\n`;
for (const [cat, lista] of [...porCategoria].sort()) {
  md += `\n### ${cat} (${lista.length})\n\n| id | título | detectável por script | peso | origem | licença |\n|---|---|---|---:|---|---|\n`;
  const top = [...lista].sort((a, b) => b.peso - a.peso).slice(0, 10);
  for (const r of top) {
    const orig = [...new Set(r.origem_ids.map(origemRepo))].join(', ') || '-';
    const lic = [...new Set(r.fonte.map((f) => f.licenca))].join(', ');
    md += `| ${r.id} | ${r.titulo.replace(/\|/g, '/')} | ${r.deteccao.detectavel_por_script} | ${r.peso} | ${orig} | ${lic} |\n`;
  }
}

// Seções por tipo
const dirSec = join(dirRegras, 'secoes');
if (existsSync(dirSec)) {
  md += `\n## Seções esperadas por tipo de site\n\n| Tipo | Seções | Essenciais |\n|---|---:|---:|\n`;
  for (const nome of readdirSync(dirSec).sort()) {
    if (!nome.endsWith('.json')) continue;
    const s = JSON.parse(readFileSync(join(dirSec, nome), 'utf8'));
    if (Array.isArray(s)) md += `| ${nome.replace('.json', '')} | ${s.length} | ${s.filter((x) => x.obrigatoriedade === 'essencial').length} |\n`;
  }
}

// Clichês
const arqCl = join(dirRegras, 'texto', 'cliches-pt-br.json');
if (existsSync(arqCl)) {
  const cl = JSON.parse(readFileSync(arqCl, 'utf8'));
  md += `\n## Lista de clichês PT-BR\n\n${cl.length} entradas. Por tipo: ${Object.entries(contar(cl, (c) => c.tipo)).map(([k, v]) => `${k}: ${v}`).join(', ')}. Confiança: ${Object.entries(contar(cl, (c) => c.confianca)).map(([k, v]) => `${k}: ${v}`).join(', ')}.\n`;
}

md += `\n## Observações de método\n\n- Regras de várias origens foram **fundidas** (coluna "Fundidas"); cada regra guarda todas as origens em \`origem_ids\`.\n- Peso é ponto de partida; será calibrado em \`docs/teste-de-acerto.md\`.\n- Nada aqui afirma autoria por IA: tudo é "genérico/padrão".\n`;

writeFileSync(join(raiz, 'docs', 'taxonomia-proposta.md'), md);
console.log(`docs/taxonomia-proposta.md gerado: ${regras.length} regras, ${porCategoria.size} categorias.`);
