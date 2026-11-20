import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/lei.mjs';

async function medirFixture(nome, caminhos = ['/']) {
  const { ctx, fechar } = await lerFixture(nome, { caminhos, manterAberto: true, buscarAtivos: false });
  try { return await medidor.medir(ctx); } finally { await fechar(); }
}

let legal, oculto, site12, cnpjFx, completo, escassez;
before(async () => {
  legal = (await medirFixture('legal')).dados;
  oculto = await medirFixture('oculto');
  site12 = (await medirFixture('site-12', ['/', '/privacidade.html', '/termos.html', '/contato.html'])).dados;
  cnpjFx = (await medirFixture('d-lei-cnpj')).dados;
  completo = (await medirFixture('d-lei-completo', ['/', '/privacidade.html', '/termos.html', '/contato.html'])).dados;
  escassez = (await medirFixture('d-lei-escassez')).dados;
});

test('interface do medidor', async () => {
  assert.equal(medidor.id, 'lei');
  assert.equal(oculto.id, 'lei');
  assert.ok(Array.isArray(oculto.evidencias));
});

test('cnpjValido: algoritmo oficial do dígito verificador', () => {
  assert.equal(medidor.cnpjValido('98.765.432/0001-98'), true);
  assert.equal(medidor.cnpjValido('98765432000198'), true);
  assert.equal(medidor.cnpjValido('87.654.321/0001-98'), true);
  assert.equal(medidor.cnpjValido('98.765.432/0001-99'), false); // 2º dígito errado
  assert.equal(medidor.cnpjValido('11.222.333/0001-91'), false); // 1º dígito errado
  assert.equal(medidor.cnpjValido('11.111.111/1111-11'), false); // sequência repetida
  assert.equal(medidor.cnpjValido('00.000.000/0000-00'), false);
  assert.equal(medidor.cnpjValido('1122233300018'), false); // 13 dígitos
  assert.equal(medidor.cnpjValido(''), false);
  assert.equal(medidor.formatarCnpj('98765432000198'), '98.765.432/0001-98');
});

// ---------------------------------------------------------------- fixture legal
test('legal: sem CNPJ, sem privacidade, sem termos (ausência vale para as páginas inspecionadas)', () => {
  assert.equal(legal.cnpj.cnpjValidoPresente, false);
  assert.deepEqual(legal.cnpj.encontrados, []);
  assert.deepEqual(legal.cnpj.rotulosEncontrados, []);
  assert.equal(legal.cnpj.razaoSocialRotuloPresente, false);

  for (const [tipo, rotas] of [['privacidade', 7], ['termos', 6]]) {
    assert.equal(legal[tipo].linkEncontrado, false, tipo);
    assert.equal(legal[tipo].paginaExiste, false, tipo);
    assert.equal(legal[tipo].ausente, true, tipo);
    assert.equal(legal[tipo].rotasComunsTestadas.length, rotas, tipo);
    assert.ok(legal[tipo].rotasComunsTestadas.every((r) => r.status === 404), tipo);
  }
  // paginasInspecionadas: home + 7 rotas de privacidade + 6 de termos
  assert.equal(legal.paginasInspecionadas.length, 14);
  assert.equal(legal.paginasAmostradas.length, 1);
});

test('legal: promessa "+R$ 3.000" em h1 (trechos exatos) e no title', () => {
  const h1 = legal.promessas.itens.filter((x) => x.onde === 'h1');
  assert.deepEqual(h1.map((x) => x.trecho), ['+R$ 3.000', 'R$ 3.000 por mês', 'renda extra', 'garantida']);
  assert.deepEqual(h1.map((x) => x.padrao), ['ganho-mais-rs', 'rs-por-periodo', 'renda-extra', 'garantido']);
  assert.ok(h1.every((x) => x.seletor === 'body>main>h1' && x.pagina === '/' && x.versao === 'final'));
  const titulo = legal.promessas.itens.filter((x) => x.onde === 'title');
  assert.deepEqual(titulo.map((x) => x.trecho), ['Renda Extra']);
  assert.equal(legal.promessas.total, 5);
});

test('legal: formulário com e-mail sem link de privacidade; 3 links "R$ 34,90"; GTM por script', () => {
  assert.equal(legal.formularios.total, 1);
  assert.equal(legal.formularios.coletamDadoPessoal, 1);
  assert.equal(legal.formularios.semLinkOuAviso, 1);
  assert.deepEqual(legal.formularios.itens[0].camposPessoais, [{ tipo: 'email', nome: 'email' }]);
  assert.equal(legal.formularios.itens[0].linkPrivacidade, null);
  assert.deepEqual(legal.precos.valoresDistintos, ['R$ 3.000', 'R$ 34,90']);
  assert.equal(legal.precos.total, 4);
  assert.equal(legal.precos.semCondicaoNoBloco, 4);
  assert.equal(legal.oferta.linksCheckout.length, 3);
  assert.equal(legal.cookies.temRastreador, true);
  assert.deepEqual(legal.cookies.nomesRastreadores, ['Google Tag Manager']);
  assert.equal(legal.cookies.banner.detectado, false);
  assert.equal(legal.cookies.temIndicioDeBannerOuGestao, false);
  assert.equal(legal.encarregado.presente, false);
  assert.equal(legal.contato.canalDeAtendimentoPresente, false);
  assert.equal(legal.contato.enderecoFisicoPresente, false);
  assert.equal(legal.escassez.itens.length, 0);
});

// ---------------------------------------------------------------- texto oculto
test('oculto: "0% OFF" e "oferta encerrada R$ 89" só em ocultosRelevantes, nunca como visível', () => {
  const d = oculto.dados;
  assert.deepEqual(d.ocultosRelevantes.map((o) => o.trecho).sort(), ['0% OFF', 'Guia R$ 59 e 200+ receitas', 'Oferta encerrada: de R$ 89', 'Preço antigo R$ 59']);
  assert.ok(d.ocultosRelevantes.every((o) => o.visivel === false));
  assert.deepEqual(d.ocultosRelevantes.map((o) => o.ocultoPor).sort(), ['display:none', 'display:none', 'fora-da-tela', 'visibility:hidden']);
  // preço visível: só R$ 39
  assert.deepEqual(d.precos.valoresDistintos, ['R$ 39']);
  assert.equal(d.precos.total, 1);
  // nada do oculto vaza para os demais fatos
  const { ocultosRelevantes, ...resto } = d;
  const texto = JSON.stringify(resto);
  for (const proibido of ['0% OFF', 'R$ 89', 'R$ 59', '200+ receitas']) assert.ok(!texto.includes(proibido), proibido);
  // evidências marcadas visivel:false são exatamente as do oculto
  const evOcultas = oculto.evidencias.filter((e) => e.visivel === false);
  assert.ok(evOcultas.length > 0 && evOcultas.every((e) => /0% OFF|R\$ 89|R\$ 59/.test(e.trecho)));
  assert.ok(oculto.evidencias.filter((e) => e.visivel === true).every((e) => !/0% OFF|R\$ 89|R\$ 59/.test(e.trecho)));
});

// ---------------------------------------------------------------- site-12
test('site-12: privacidade e termos achados com status 200 e sem CNPJ', () => {
  assert.equal(site12.paginasAmostradas.length, 4);
  for (const tipo of ['privacidade', 'termos']) {
    assert.equal(site12[tipo].linkEncontrado, true, tipo);
    assert.equal(site12[tipo].ausente, false, tipo);
    assert.equal(site12[tipo].paginaExiste, true, tipo);
    assert.equal(site12[tipo].alvos.length, 1, tipo);
    assert.equal(site12[tipo].alvos[0].status, 200, tipo);
    assert.deepEqual(site12[tipo].rotasComunsTestadas, [], tipo); // há link: não testa rotas comuns
  }
  assert.match(site12.privacidade.alvos[0].url, /\/privacidade\.html$/);
  assert.match(site12.termos.alvos[0].url, /\/termos\.html$/);
  assert.equal(site12.privacidade.alvos[0].palavras, 16);
  assert.equal(site12.privacidade.alvos[0].corpoMinimoAtingido, false); // corpo curto (< 300 caracteres)
  assert.deepEqual(site12.privacidade.alvos[0].falhas, ['texto visível < 300 caracteres']);
  assert.equal(site12.cnpj.cnpjValidoPresente, false);
  assert.deepEqual(site12.cnpj.encontrados, []);
  assert.deepEqual(site12.contato.emails.map((e) => e.valor), ['contato@casamodelo.example']);
  assert.equal(site12.oferta.temOferta, false);
});

// ---------------------------------------------------------------- CNPJ
test('d-lei-cnpj: válido, inválido, modelo e CNPJ oculto', () => {
  const por = (c) => [c.cnpj, c.pontuado, c.valido, c.modelo, c.comRotulo];
  assert.deepEqual(cnpjFx.cnpj.encontrados.map(por), [
    ['98.765.432/0001-98', true, true, false, true],
    ['98.765.432/0001-99', true, false, false, true],
    ['12.345.678/0001-90', true, false, true, false],
    ['98.765.432/0001-98', false, true, false, true], // sem pontuação
  ]);
  assert.equal(cnpjFx.cnpj.validos, 2);
  assert.equal(cnpjFx.cnpj.invalidos, 2);
  assert.equal(cnpjFx.cnpj.cnpjValidoPresente, true);
  assert.equal(cnpjFx.cnpj.razaoSocialRotuloPresente, true);
  assert.deepEqual(cnpjFx.cnpj.rotulosEncontrados.map((r) => r.rotulo), ['razao-social', 'cnpj', 'cnpj', 'cnpj', 'inscricao']);
  const todos = JSON.stringify(cnpjFx.cnpj.encontrados);
  assert.ok(!todos.includes('87.654.321/0001-98')); // CNPJ válido, mas oculto: não conta
  assert.ok(!todos.includes('12345678901234')); // 14 dígitos sem pontuação, inválido e sem rótulo: ignorado
  assert.deepEqual(cnpjFx.ocultosRelevantes, []); // o CNPJ oculto não tem termo relevante (%, OFF...)
});

// ---------------------------------------------------------------- site "com tudo"
test('d-lei-completo: privacidade e termos com corpo, grupos de direitos e conteúdo mínimo', () => {
  assert.equal(completo.privacidade.alvos.length, 1);
  const p = completo.privacidade.alvos[0];
  assert.equal(p.status, 200);
  assert.equal(p.corpoMinimoAtingido, true);
  assert.deepEqual(p.falhas, []);
  assert.deepEqual(p.direitosTitular.gruposPresentes, ['acesso', 'correcao', 'eliminacao', 'portabilidade', 'revogacao', 'art18']);
  assert.deepEqual(p.conteudoMinimo.gruposPresentes, ['finalidade', 'formaEDuracao', 'controlador', 'contato', 'compartilhamento']);
  const t = completo.termos.alvos[0];
  assert.equal(t.status, 200);
  assert.equal(t.corpoMinimoAtingido, true);
  assert.equal(t.direitosTitular, undefined); // só páginas de privacidade
  assert.equal(completo.privacidade.ausente, false);
  assert.equal(completo.termos.ausente, false);
});

test('d-lei-completo: CNPJ, endereço, contato e encarregado', () => {
  assert.deepEqual(completo.cnpj.encontrados.map((c) => c.cnpj), ['98.765.432/0001-98', '98.765.432/0001-98']); // rodapé da home + política
  assert.deepEqual(completo.cnpj.encontrados.map((c) => c.pagina).sort(), ['/', '/privacidade.html']);
  assert.equal(completo.cnpj.razaoSocialRotuloPresente, true);
  assert.deepEqual(completo.contato.telefones.map((t) => t.valor), ['(41) 99999-8888']);
  assert.deepEqual(completo.contato.emails.map((e) => e.valor).sort(), ['contato@marcenariamodelo.example', 'privacidade@marcenariamodelo.example']);
  assert.deepEqual(completo.contato.ceps.map((c) => c.valor), ['80010-000']);
  assert.deepEqual(completo.contato.logradouros.map((l) => l.valor), ['Rua das Flores, 123']);
  assert.equal(completo.contato.whatsapp.length, 1);
  assert.equal(completo.contato.formulariosDeContato, 1);
  assert.equal(completo.contato.enderecoFisicoPresente, true);
  assert.equal(completo.contato.canalDeAtendimentoPresente, true);
  assert.equal(completo.encarregado.presente, true);
  assert.deepEqual(completo.encarregado.emails.map((e) => e.email), ['privacidade@marcenariamodelo.example']);
  assert.ok(completo.encarregado.termos.some((x) => /encarregad/i.test(x.termo)));
  assert.ok(completo.encarregado.termos.some((x) => x.termo === 'DPO'));
});

test('d-lei-completo: banner de cookies, CMP e rastreador (por URL; sem requisição)', () => {
  const c = completo.cookies;
  assert.equal(c.banner.detectado, true);
  assert.deepEqual(c.banner.botoes.aceitar.map((b) => b.texto), ['Aceitar']);
  assert.deepEqual(c.banner.botoes.recusar.map((b) => b.texto), ['Recusar']);
  assert.deepEqual(c.banner.botoes.gerenciar.map((b) => b.texto), ['Gerenciar preferências']);
  assert.deepEqual(c.nomesCmp, ['Cookiebot']);
  assert.deepEqual(c.nomesRastreadores, ['Google Tag Manager']);
  assert.equal(c.rastreadorConfirmadoPorRequisicao, false); // scripts type=text/plain: não carregados
  assert.equal(c.temIndicioDeBannerOuGestao, true);
  assert.ok(c.indiciosSeletor.some((i) => i.valor === 'cookie-banner'));
});

test('d-lei-completo: formulários, checkbox pré-marcado, preços e condições', () => {
  const f = completo.formularios.itens;
  const home = f.find((x) => x.pagina === '/');
  assert.equal(home.coletaDadoPessoal, true);
  assert.equal(home.temLinkOuAviso, true);
  assert.equal(home.localDoLink, 'dentro-do-form');
  assert.equal(home.linkPrivacidade.href, '/privacidade.html');
  const contato = f.find((x) => x.pagina === '/contato.html');
  assert.equal(contato.coletaDadoPessoal, true);
  assert.equal(contato.temLinkOuAviso, false);
  assert.equal(contato.formularioDeContato, true);
  assert.equal(completo.formularios.semLinkOuAviso, 1);
  assert.deepEqual(completo.checkboxesPreMarcados.map((c) => [c.versao, c.nome, c.consentimentoRelacionado]), [['cru', 'aceite', true], ['final', 'aceite', true]]);

  assert.deepEqual(completo.precos.itens.map((p) => p.valor), ['R$ 197,00', 'R$ 19,70', 'R$ 52,00']);
  assert.deepEqual(completo.precos.itens[0].condicoes.no, ['parcelamento', 'aVista', 'prazoOferta', 'taxas']);
  assert.deepEqual(completo.precos.itens[0].condicoes.bloco, ['parcelamento', 'aVista', 'prazoOferta', 'frete', 'taxas', 'garantia']);
  assert.equal(completo.precos.itens[0].semCondicaoNoBloco, false);
  assert.equal(completo.precos.itens[2].semCondicaoNoBloco, true); // "R$ 52,00" no bloco "Bônus"
  assert.equal(completo.precos.itens[2].semCondicaoNaPagina, false);
  assert.equal(completo.arrependimento.mencionado, true);
  assert.equal(completo.prazoEntregaFrete.mencionado, true);
  assert.equal(completo.promessas.total, 0);
  assert.equal(completo.escassez.itens.length, 0);
  assert.deepEqual(completo.ocultosRelevantes.map((o) => o.trecho), ['0% OFF']);
});

// ---------------------------------------------------------------- escassez
test('d-lei-escassez: contador regressivo que muda entre versões, "restam", "últimas", "só hoje"', () => {
  const e = escassez.escassez;
  assert.deepEqual(e.itens.map((i) => [i.tipo, i.trecho]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['contador-regressivo', '09:35:00'],
    ['restam', 'Restam apenas 3'],
    ['so-hoje', 'Só hoje'],
    ['ultimas', 'Últimas unidades'],
  ]);
  const cont = e.itens.find((i) => i.tipo === 'contador-regressivo');
  assert.equal(cont.seletor, '#cd');
  assert.equal(cont.mudaEntreVersoes.leituras.cru, '10:00:00');
  assert.equal(cont.mudaEntreVersoes.leituras.final, '09:35:00');
  assert.equal(cont.mudaEntreVersoes.contadorAnimado, false); // decresce
  assert.deepEqual(e.itens.filter((i) => i.tipo !== 'contador-regressivo').map((i) => i.mudaEntreVersoes), [null, null, null]);
  assert.equal(e.contadoresRegressivos, 1);
  assert.deepEqual(e.elementosContador.map((x) => x.valor), ['countdown']);
  assert.equal(e.padroesEmJs.length, 1);
  assert.match(e.padroesEmJs[0].trecho, /Date\.now\(\) \+ 3600000/);
  assert.equal(e.variacoesNumericas.length, 1);
  assert.equal(e.variacoesNumericas[0].seletor, '#cd');
  assert.equal(e.recargaNaoMedida, true);
  assert.deepEqual(escassez.ocultosRelevantes.map((o) => o.trecho), ['Oferta encerrada: de R$ 197']);
  assert.deepEqual(escassez.precos.valoresDistintos, ['R$ 97,00']); // o R$ 197 oculto não é preço visível
});
