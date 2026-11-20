// Carimbo de cada relatório: data/hora local, hash da versão analisada, versão da skill e das regras.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './util.mjs';
import { VERSAO_SKILL } from './relatorio.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'America/Sao_Paulo';

// Hash curto do conjunto de regras (todos os JSON de regras/, inclusive seções e clichês), para saber se as regras mudaram.
export function versaoDasRegras(dir = join(raiz, 'regras')) {
  const arquivos = [];
  const andar = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) andar(p); else if (n.name.endsWith('.json')) arquivos.push(p); } };
  andar(dir);
  arquivos.sort();
  return sha256(arquivos.map((a) => a.slice(dir.length) + '\n' + readFileSync(a, 'utf8').replace(/\r\n/g, '\n')).join('\n--\n')).slice(0, 12);
}

export function isoLocal(data = new Date(), tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' }).formatToParts(data).map((x) => [x.type, x.value]));
  const off = (p.timeZoneName || 'GMT').replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off.length === 6 ? off : off === '' ? '+00:00' : off}`;
}

export function criarCarimbo({ hashVersao, modo, agora = new Date(), versaoRegras = versaoDasRegras() }) {
  return { iso: isoLocal(agora), hash: hashVersao, versaoSkill: VERSAO_SKILL, versaoRegras, modo };
}

// AAAAMMDD-HHMM-<hash8>: nome de pasta ordenável no tempo.
export function nomeDaPasta(carimbo) {
  const m = carimbo.iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}-${carimbo.hash.slice(0, 8)}`;
}
