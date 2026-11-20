// Camada LOCAL opcional (D-028). Fica na pasta `local/` (fora do git) e nunca é necessária.
//
// O que ela pode trazer, cada coisa opcional:
//   local/secoes-por-tipo/<tipo>.json   seções esperadas por tipo de site; valem MAIS que as públicas daquele tipo
//   local/regras-*/*.json               regras extras no mesmo formato de regras/*.json (validadas pelo mesmo esquema)
//   local/deteccoes-*/*.mjs             detectores das regras extras (mesmo formato de lib/deteccoes/*.mjs)
//
// Sem a pasta, nada muda. Arquivo ruim (JSON quebrado, regra fora do esquema) vira AVISO e é ignorado: a análise
// nunca quebra por causa da camada local. Variável de ambiente CRITIQUESITES_LOCAL: caminho de outra pasta, ou
// "off" para desligar (a suíte pública liga o "off" para ser a mesma em qualquer máquina).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_LOCAL = join(raiz, 'local');
export const TIPO_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/; // nome de tipo vira nome de arquivo: nada de barras nem pontos

// null = camada desligada.
export function dirLocalPadrao(env = process.env) {
  const v = String(env.CRITIQUESITES_LOCAL ?? '').trim();
  if (['off', 'nao', 'não', '0', 'false'].includes(v.toLowerCase())) return null;
  return v ? resolve(v) : DIR_LOCAL;
}

const pastasCom = (dirLocal, prefixo) => {
  if (!dirLocal || !existsSync(dirLocal)) return [];
  try {
    return readdirSync(dirLocal).filter((n) => n.startsWith(prefixo) && statSync(join(dirLocal, n)).isDirectory()).sort().map((n) => join(dirLocal, n));
  } catch { return []; }
};

let _validar = null;
function validadorDeRegra() {
  if (_validar) return _validar;
  const schema = JSON.parse(readFileSync(join(raiz, 'regras', 'schema', 'regra.schema.json'), 'utf8'));
  // Na camada local, o tipo de site pode ser um tipo que só existe nela: aceita qualquer nome de tipo válido (ou "*").
  const tipos = schema.properties?.tipos_de_site;
  if (tipos?.items) tipos.items = { type: 'string', pattern: '^(\\*|[a-z0-9]+(-[a-z0-9]+)*)$' };
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validar = ajv.compile(schema);
  return _validar;
}

// Regras locais: devolve { regras, avisos }. Regra com id igual ao de uma regra pública é ignorada (a pública manda).
export function carregarRegrasLocais({ dirLocal = dirLocalPadrao(), tipoDeSite = null, modo = 'rapido', idsPublicos = [] } = {}) {
  const regras = [];
  const avisos = [];
  const usados = new Set(idsPublicos);
  const validar = pastasCom(dirLocal, 'regras-').length ? validadorDeRegra() : null;
  for (const pasta of pastasCom(dirLocal, 'regras-')) {
    for (const nome of readdirSync(pasta).filter((n) => n.endsWith('.json')).sort()) {
      const rotulo = `${pasta.split(/[\\/]/).pop()}/${nome}`;
      let lista;
      try { lista = JSON.parse(readFileSync(join(pasta, nome), 'utf8').replace(/^﻿/, '')); } catch (e) { avisos.push(`camada local: JSON inválido em ${rotulo} (${String(e.message).split('\n')[0]}); arquivo ignorado`); continue; }
      if (!Array.isArray(lista)) { avisos.push(`camada local: ${rotulo} deveria ser uma lista de regras; arquivo ignorado`); continue; }
      for (const r of lista) {
        const id = r && typeof r === 'object' ? r.id : null;
        if (!validar(r)) { avisos.push(`camada local: regra ${id || '?'} em ${rotulo} fora do esquema (${(validar.errors?.[0]?.instancePath || '')} ${validar.errors?.[0]?.message || ''}); regra ignorada`.replace(/\s+/g, ' ')); continue; }
        if (r.selo === 'regra' && !r.fonte.some((f) => /^https:\/\/\S+$/.test(f.url || ''))) { avisos.push(`camada local: regra ${r.id} em ${rotulo} tem selo "regra documentada" sem fonte com endereço https; regra ignorada`); continue; }
        if (usados.has(r.id)) { avisos.push(`camada local: regra ${r.id} repete um id já usado; ignorei a repetição`); continue; }
        usados.add(r.id);
        regras.push(r);
      }
    }
  }
  const aplicaveis = regras.filter((r) => r.modo.includes(modo) && (r.tipos_de_site.includes('*') || !tipoDeSite || r.tipos_de_site.includes(tipoDeSite)));
  return { regras: aplicaveis, avisos };
}

// Detectores locais: devolve { detectores, avisos }. Módulo que falha ao carregar vira aviso.
export async function carregarDetectoresLocais({ dirLocal = dirLocalPadrao() } = {}) {
  const detectores = {};
  const avisos = [];
  for (const pasta of pastasCom(dirLocal, 'deteccoes-')) {
    for (const nome of readdirSync(pasta).filter((n) => n.endsWith('.mjs')).sort()) {
      try {
        const m = await import(pathToFileURL(join(pasta, nome)).href);
        Object.assign(detectores, m.detectores || {});
      } catch (e) { avisos.push(`camada local: não consegui carregar ${pasta.split(/[\\/]/).pop()}/${nome} (${String(e.message).split('\n')[0]}); arquivo ignorado`); }
    }
  }
  return { detectores, avisos };
}

export const arquivoDeSecoesLocais = (tipo, dirLocal = dirLocalPadrao()) => (dirLocal && TIPO_VALIDO.test(String(tipo)) ? join(dirLocal, 'secoes-por-tipo', `${tipo}.json`) : null);

// Hash curto do conteúdo da camada local (seções e regras), para o carimbo do relatório mudar quando ela mudar.
// Devolve '' quando não há nada (camada desligada ou vazia).
export function versaoDaCamadaLocal(dirLocal = dirLocalPadrao()) {
  if (!dirLocal || !existsSync(dirLocal)) return '';
  const arquivos = [];
  const pastas = [join(dirLocal, 'secoes-por-tipo'), ...pastasCom(dirLocal, 'regras-'), ...pastasCom(dirLocal, 'deteccoes-')];
  for (const pasta of pastas) {
    if (!existsSync(pasta)) continue;
    for (const n of readdirSync(pasta).sort()) if (/\.(json|mjs)$/.test(n)) arquivos.push(join(pasta, n));
  }
  if (!arquivos.length) return '';
  return createHash('sha256').update(arquivos.map((a) => a.slice(dirLocal.length) + '\n' + readFileSync(a, 'utf8').replace(/\r\n/g, '\n')).join('\n--\n')).digest('hex').slice(0, 12);
}
