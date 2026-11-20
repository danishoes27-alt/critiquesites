# Regressão do site de exemplo nº 1 (v3)

Site de exemplo totalmente fictício (fixture `tests/fixtures/exemplo1`: "Estúdio Aurora", "Guia de Receitas Caseiras"). Prova que a skill sabe apontar o que tem que apontar e não afirma o que não pode afirmar. A leitura é feita offline e o resultado é determinístico.

Análise: exemplo1/20261120-0010-d4e49f3e · carimbo 2026-11-20T00:10:13-03:00 · hash d4e49f3eca97082e…

**Resultado: 12 de 12 itens passaram.**

| Item | Tipo | Descrição | Resultado | Detalhe |
|---|---|---|---|---|
| N1 | NÃO pode afirmar | Afirmar "sem dados estruturados" (a página tem WebSite, WebPage, Product, Offer, FAQPage e VideoObject) | passou | medido: tipos {"Article":{"cru":false,"final":false},"FAQPage":{"cru":true,"final":true},"LocalBusiness":{"cru":false,"final":false},"Offer":{"cru":true,"final":true},"Organi |
| N2 | NÃO pode afirmar | Afirmar "sem lazy loading" (45 de 57 imagens usam loading=lazy) | passou | medido no DOM final: 45 de 57 imagens com loading=lazy |
| N3 | NÃO pode afirmar | Afirmar "depoimentos duplicados" (são clones aria-hidden do carrossel) | passou |  |
| N4 | NÃO pode afirmar | Afirmar "0% OFF" ou "oferta encerrada R$ 89" (texto oculto) | passou |  |
| N5 | NÃO pode afirmar | Afirmar "Guia R$ 97 e 200+ receitas" (o visível é R$ 39 e 50 receitas) | passou |  |
| T1 | TEM que apontar | Contadores animados que começam em 0 e mostram valor errado em captura rápida | passou | achado ach-0013: O contador #hero-h1>em>span começa em 0 e só chega a 3000 depois da animação (no HTML cru "Ganhe R$ 3.000"; aos 250 ms "Ganhe R$ 0"; na página final "Ganhe R$ 3.000"). Quem olha uma captura rápida ou uma pré-visualização pode ver o número erra |
| T2 | TEM que apontar | "Ganhe R$ 3.000 por mês" no título como possível promessa de ganho (CDC art. 37) | passou | achado ach-0030: Possível promessa de ganho ou resultado no título principal (h1): "Aprenda a cozinhar melhor em casa e Ganhe R$ 3.000 por mês". Trechos que casaram com o padrão: "Ganhe R$", "R$ 3.000 por mês". O Código de Defesa do Consumidor (art. 37) trata  |
| T3 | TEM que apontar | Links repetidos "R$ 39" sem contexto para leitor de tela | passou | achado ach-0001: Para quem usa leitor de tela, a lista de links da página repete o mesmo texto: 3 links dizem só "R$ 39", sem aria-label nem outro nome que os diferencie, e levam a 3 destinos diferentes. Quem navega por essa lista não sabe qual é qual. O texto |
| T4 | TEM que apontar | Ausência de CNPJ | passou | Não encontramos um CNPJ válido nem o rótulo "razão social" ou "nome empresarial" em texto visível. A página tem oferta (preço ou botão de compra). Páginas lidas: /. |
| T5 | TEM que apontar | Ausência de termos (de uso) | passou | Não encontramos link nem página de termos de uso nas páginas inspecionadas. Páginas lidas: /. Rotas comuns testadas sem página válida: /termos, /termos-de-uso, /termos-e-condicoes, /condicoes-de-uso, /terms, /terms-of-service. |
| T6 | TEM que apontar | Ausência de política de privacidade | passou | Não encontramos link nem página de política de privacidade nas páginas inspecionadas. Páginas lidas: /. Rotas comuns testadas sem página válida: /privacidade, /politica-de-privacidade, /politica-privacidade, /privacy, /privacy-policy, /lgpd, /protecao-de-dados |
| T7 | TEM que apontar | IDs de GA4 e do pixel da Meta vazios | passou | O código tem Google Analytics 4 com identificador vazio: "https://www.googletagmanager.com/gtag/js?id=G-", "gtag('config','G-'". Uma tag assim não mede nada e ainda carrega script. Troque pelo ID real da conta ou remova a tag. / O código tem Meta Pixel com ide |

Quem quiser conferir contra um site real passa a URL por argumento (`node scripts/regressao-caso1.mjs vivo <url>`); o resultado fica em `saidas/` (fora do git).
