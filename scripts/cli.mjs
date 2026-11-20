#!/usr/bin/env node
// CLI do critiquesites. Saída em JSON no stdout (para a skill ler); mensagens de progresso no stderr.
//
//   node scripts/cli.mjs estimar <url|pasta|zip> [--completo] [--teto-reais 2]
//   node scripts/cli.mjs analisar <url|pasta|zip> [--completo] [--tipo loja] [--codigo-arquivo arq.html]
//                                 [--seo] [--csv consultas.csv [--csv paginas.csv]]   (módulo "Subir no Google"; o CSV é lido só no seu computador)
//                                 [--sem-camada-local]   (ignora a pasta local/ opcional; veja docs/secoes-locais.md)
//                                 [--permitir-local] [--ignorar-robots] [--intervalo-ms 1000] [--saidas pasta]
//   node scripts/cli.mjs finalizar <pasta-da-analise> [--tokens-entrada N --tokens-saida N]
//   node scripts/cli.mjs ultima <url|slug>        (acha a pasta da análise mais recente)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { analisar, finalizar, estimarAntes, PASTA_SAIDAS } from '../lib/analisar.mjs';
import { slugDe } from '../lib/util.mjs';

function lerArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const prox = argv[i + 1];
      if (prox === undefined || prox.startsWith('--')) flags[k] = true;
      else { flags[k] = prox; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

const saida = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const { pos, flags } = lerArgs(process.argv.slice(2));
const [cmd, alvo] = pos;
const modo = flags.completo ? 'completo' : 'rapido';
const csvs = process.argv.slice(2).flatMap((a, i, v) => (a === '--csv' && v[i + 1] && !v[i + 1].startsWith('--') ? [v[i + 1]] : []));

try {
  if (cmd === 'estimar') {
    saida(await estimarAntes({ entrada: alvo || 'código colado', modo, seo: !!flags.seo, tetoReais: flags['teto-reais'] ? Number(String(flags['teto-reais']).replace(',', '.')) : null }));
  } else if (cmd === 'analisar') {
    let entrada = alvo;
    if (flags['codigo-arquivo']) entrada = { codigo: readFileSync(flags['codigo-arquivo'], 'utf8') };
    if (!entrada) throw new Error('Informe uma URL, uma pasta, um .zip ou --codigo-arquivo.');
    const r = await analisar({
      entrada, modo, tipoInformado: typeof flags.tipo === 'string' ? flags.tipo : null,
      permitirLocal: !!flags['permitir-local'], respeitarRobots: !flags['ignorar-robots'],
      intervaloMs: flags['intervalo-ms'] ? Number(flags['intervalo-ms']) : 1000,
      saidas: typeof flags.saidas === 'string' ? flags.saidas : PASTA_SAIDAS,
      seo: !!flags.seo, csv: csvs, ...(flags['sem-camada-local'] ? { dirLocal: null } : {}),
      aoProgredir: (m) => process.stderr.write(`[critiquesites] ${m}\n`),
    });
    saida({ ok: true, ...r, proximoPasso: `Leia ${join(r.pasta, 'pacote.txt')}, escreva ${join(r.pasta, 'julgamento.json')} e rode: node scripts/cli.mjs finalizar "${r.pasta}"` });
  } else if (cmd === 'finalizar') {
    if (!alvo) throw new Error('Informe a pasta da análise.');
    const tokens = flags['tokens-entrada'] && flags['tokens-saida'] ? { entrada: Number(flags['tokens-entrada']), saida: Number(flags['tokens-saida']) } : null;
    saida(await finalizar({ pasta: alvo, tokens }));
  } else if (cmd === 'ultima') {
    const slug = /^https?:/.test(alvo || '') ? slugDe(alvo) : alvo;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) throw new Error('slug inválido: use letras minúsculas, números e hífens');
    const dir = join(typeof flags.saidas === 'string' ? flags.saidas : PASTA_SAIDAS, slug || '');
    const pastas = existsSync(dir) ? readdirSync(dir).filter((n) => /^\d{8}-\d{4}-[0-9a-f]{8}$/.test(n)).sort() : [];
    saida({ ok: pastas.length > 0, pasta: pastas.length ? join(dir, pastas.at(-1)) : null, todas: pastas });
  } else {
    process.stderr.write('Comandos: estimar | analisar | finalizar | ultima. Veja o topo de scripts/cli.mjs.\n');
    process.exit(2);
  }
} catch (e) {
  saida({ ok: false, erro: String(e.message || e) });
  process.exit(1);
}
