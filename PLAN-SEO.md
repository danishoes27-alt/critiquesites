# PLAN-SEO.md (v1): módulo "Subir no Google"

Tarefas pequenas, cada uma com critério de pronto (CP) e teste (T). Um commit por tarefa.

## S1 Regras (JSON)
- S1.1 Schema: aceitar categoria `seo-google` e medidor `seo-google`. CP: validador aceita; T: validar-regras.
- S1.2 `regras/seo-google.json` (ids `seo-...`, fonte, confiança, selo, prompt de correção): H1, viewport, Open Graph, dados estruturados recomendados por tipo, palavra-chave, E-E-A-T (autor, sobre, data, fontes), local (NAP, LocalBusiness, mapa, tel/WhatsApp, orientação do Perfil da Empresa). CP: 100% válidas e com fonte; T: nenhum id repetido com as 308 existentes.
- S1.3 `config/seo-google.json`: regras reaproveitadas de outras áreas, pesos da nota, limites do CSV, janela de oportunidades. CP: usado pelo código, sem números soltos.

## S2 Medidor novo
- S2.1 `lib/medidores/seo-google.mjs`: por página lê H1, viewport, Open Graph, tipos JSON-LD, termos, sinais E-E-A-T, sinais locais (NAP, mapa, tel, WhatsApp). Só medidas. CP: saída determinística; T: fixtures seo-ruim e seo-boa.

## S3 Nota e achados
- S3.1 Detectores em `lib/deteccoes/seo-google.mjs`, um por regra, com citações verificáveis. T: um teste por detector.
- S3.2 `lib/seo-nota.mjs`: nota 0-100 determinística, top achados, selos. T: mesma entrada, mesma nota; seo-boa >> seo-ruim.

## S4 Palavras-chave, conteúdo e local
- S4.1 Termo-alvo por página (title, H1, subtítulos, frequência; sem volume nem posição) e checagem de intenção. T: termo certo; "não verificável" para volume.
- S4.2 E-E-A-T e SEO local (dentro do medidor e dos detectores). T: NAP consistente x inconsistente.

## S5 CSV do Search Console
- S5.1 `lib/search-console.mjs`: leitor próprio (limite de tamanho e linhas, sem executar nada, cabeçalhos PT/EN, separador automático). T: CSV PT, CSV EN, arquivo enorme recusado, linha com fórmula tratada como texto.
- S5.2 Oportunidades: posição 4 a 20 com impressões altas, CTR abaixo da mediana da própria faixa, consulta sem página própria. T: dados inventados; sem CSV nada é inventado.

## S6 Entrega
- S6.1 Integração em `analisar`: módulo só no modo completo ou com `--seo`; `--csv <arquivo>`. T: modo rápido não carrega o módulo.
- S6.2 Relatório HTML/PDF/card: bloco "Subir no Google" com nota, top achados, plano por impacto x esforço, aviso de posição. T: relatório contém nota e aviso.
- S6.3 Reanalisar: variação da nota de SEO. T: duas análises, delta correto.
- S6.4 Prompts de correção: "Referência não é cópia", sem ordem de copiar. T: teste anti-cópia cobre as regras novas.
- S6.5 Teste de promessa proibida (falha quando se injeta "topo do Google"). 

## S7 Documentação
SKILL.md, README.md, CREDITS.md (claude-seo, MIT, com licença e data), `docs/limites-seo.md`, `config/custos.json` (custo medido), DECISOES.md.
