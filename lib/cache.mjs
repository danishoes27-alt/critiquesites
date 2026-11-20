// Cache por página (chave = hash do HTML cru + versão do medidor) e hash da versão analisada.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, jsonEstavel } from './util.mjs';

export const VERSAO_MEDIDOR = '1';
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function criarCache(pasta = join(raiz, 'saidas', 'cache')) {
  mkdirSync(pasta, { recursive: true });
  const stats = { acertos: 0, falhas: 0, gravados: 0 };
  const arquivo = (chave) => join(pasta, `${chave}.json`);
  return {
    pasta, stats,
    chave: (hashCru, extra = '') => sha256(`${VERSAO_MEDIDOR}|${extra}|${hashCru}`),
    obter(chave) {
      const a = arquivo(chave);
      if (!existsSync(a)) { stats.falhas++; return null; }
      try { const v = JSON.parse(readFileSync(a, 'utf8')); stats.acertos++; return v; } catch { stats.falhas++; return null; }
    },
    gravar(chave, valor) { writeFileSync(arquivo(chave), jsonEstavel(valor, 0)); stats.gravados++; },
  };
}

// Hash da versão analisada: HTML cru de cada página (ordenado por URL) + ativos (CSS/JS) referenciados.
// paginas: [{ url, hashCru }], ativos: [{ url, hash }]
export function hashDaVersao(paginas, ativos = []) {
  const linhas = [
    ...[...paginas].sort((a, b) => a.url.localeCompare(b.url)).map((p) => `P ${p.url} ${p.hashCru}`),
    ...[...ativos].sort((a, b) => a.url.localeCompare(b.url)).map((a) => `A ${a.url} ${a.hash}`),
  ];
  return sha256(linhas.join('\n'));
}
