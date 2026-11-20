# Limites do módulo "Subir no Google" (v1)

Dados conferidos em 2026-11-20. Este documento diz o que a nota de SEO mede e o que **não** mede.

## O que a nota de SEO mede
- **Aderência a regras e recomendações documentadas**, por script, no código das páginas lidas: título, descrição, H1, canonical, robots, sitemap, links quebrados, imagens, dados estruturados por tipo de site, viewport, Open Graph, sinais de confiança (autor, data, página "sobre", fontes), sinais de SEO local (telefone, endereço, mapa, `tel:`).
- A conta é `100 − 100·S/(S+C)` (mesma das notas por área). Mesma entrada, mesma nota. Sem Lighthouse e sem modelo na conta.
- Cada achado leva selo: fato verificado, regra documentada, opinião/heurística ou não verificável. Quase tudo no módulo é regra documentada ou **heurística**, e o texto diz qual.

## O que a nota NÃO mede
- **Posição real no Google.** Não existe gabarito de posição, então não existe "taxa de acerto de ranking".
- **Tráfego, concorrência, backlinks, volume de busca e dificuldade de palavra-chave.** Sem dado real a skill escreve "não verificável".
- **O que o Google decide sozinho** (por exemplo, se mostra ou não um resultado enriquecido). O Google diz que não garante nenhum recurso.
- **Páginas não lidas** e páginas atrás de login (como o Perfil da Empresa no Google: a skill só orienta o que conferir lá).

## Aviso fixo no relatório
Ninguém pode garantir o primeiro lugar no Google (Google Search Central, "Do you need an SEO?", consultado em 2026-11-20). Quem vende garantia de resultado nas buscas pode estar fazendo publicidade enganosa (CDC, Lei 8.078/1990, art. 37, texto conferido em planalto.gov.br em 2026-11-20). Não é parecer jurídico. Um teste automático falha se qualquer texto gerado prometer posição.

## Decisões de método que valem lembrar
- **Heurísticas sem fonte oficial** (H1, Open Graph, página "sobre", fontes citadas, telefone em páginas diferentes, mapa, link `tel:`): peso baixo, confiança baixa ou média, selo de opinião.
- **H1:** o Google diz que a ordem e o número de títulos não importam para a busca. A regra existe por leitura e acessibilidade, não por ranking.
- **FAQPage:** o Google descontinuou o resultado enriquecido de FAQ (a partir de 7 de maio de 2026). A skill **não** recomenda esse markup por SEO.
- **CTR "abaixo do esperado"** (só com CSV): comparado com o **próprio site** na mesma faixa de posição (abaixo de 70% da mediana), nunca com tabela de terceiros.
- **CSV do Search Console:** lido só no seu computador, no máximo 5 MB e 50.000 linhas, nada é executado nem enviado, o arquivo não é copiado e não entra no repositório. O Google não publica os nomes exatos das colunas do arquivo exportado, então a skill aceita variações em português e em inglês e avisa o que não reconheceu.
- **Plural e singular** na checagem "consulta sem página própria" são tratados de forma simples (tira o "s" final). Pode errar em palavras irregulares.
