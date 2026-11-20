import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removerBlocos, tirarTags, acharEmails } from '../lib/util.mjs';

test('removerBlocos: comentários e script/style, inclusive sem fecho', () => {
  assert.equal(removerBlocos('a<!-- x -->b<!-- y -->c', '<!--', '-->'), 'abc');
  assert.equal(removerBlocos('a<script>1</script >b<SCRIPT src=x>2</Script>c', '<script', '</script'), 'abc');
  assert.equal(removerBlocos('ok<script>sem fecho', '<script', '</script'), 'ok');
  assert.equal(removerBlocos('<scripty>fica</scripty>', '<script', '</script'), '<scripty>fica</scripty>');
});

test('tirarTags: troca tags por espaço; "<" solto é texto', () => {
  assert.equal(tirarTags('<p>oi <b>você</b> 2 < 3</p>').replace(/\s+/g, ' ').trim(), 'oi você 2 < 3');
});

test('acharEmails: acha e-mails e ignora palavras gigantes', () => {
  assert.deepEqual(acharEmails('fale com ana.silva@exemplo.com.br, ok?').map((e) => e.valor), ['ana.silva@exemplo.com.br']);
  assert.deepEqual(acharEmails('a'.repeat(200000)), []);
});

test('ReDoS: entradas patológicas terminam rápido (< 1,5 s cada)', () => {
  const t = (f) => { const t0 = Date.now(); f(); return Date.now() - t0; };
  assert.ok(t(() => removerBlocos('<!--'.repeat(150000), '<!--', '-->')) < 1500);
  assert.ok(t(() => removerBlocos('<script'.repeat(150000) + '>', '<script', '</script')) < 1500);
  assert.ok(t(() => tirarTags('<a'.repeat(300000))) < 1500);
  assert.ok(t(() => tirarTags('<'.repeat(500000))) < 1500);
  assert.ok(t(() => acharEmails('a'.repeat(300000) + '@')) < 1500);
});
