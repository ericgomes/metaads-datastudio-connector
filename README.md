# Meta Ads Connector para Looker Studio

Conector **Community** do Looker Studio (Google Apps Script) que puxa dados do **Meta Ads** (Facebook/Instagram Ads) diretamente para seus dashboards.

## Recursos

- 🔐 Autenticação via **System User Token** (não expira)
- 🏢 Suporte a **múltiplas contas** de clientes com um único token
- 📊 **Breakdowns** por conta, campanha, conjunto de anúncios, anúncio ou plataforma
- 📈 Principais métricas de performance: investimento, impressões, cliques, CTR, CPM, CPC, conversões, ROAS, leads e mais

## Como configurar

O passo a passo completo está em **[SETUP.md](./SETUP.md)** — desde criar o App no Meta for Developers até conectar no Looker Studio.

Resumo das etapas:

1. **Meta** — criar App + Marketing API e gerar o System User Token
2. **Apps Script** — subir `Code.gs` e `appsscript.json`
3. **Looker Studio** — fazer o deploy como conector e conectar com o token

## Métricas disponíveis

| Campo | Descrição |
|-------|-----------|
| Data | Data da métrica |
| Campanha / Conjunto / Anúncio | Dimensões de hierarquia |
| Plataforma | Facebook, Instagram, Audience Network |
| Impressões, Cliques, Investimento | Métricas básicas |
| CPM, CPC, CTR | Métricas de custo/eficiência |
| Conversões, Valor de Conversão, ROAS | Métricas de resultado |
| Leads, Custo por Lead | Geração de leads |

Veja a lista completa em [SETUP.md](./SETUP.md#métricas-disponíveis).

## Estrutura

| Arquivo | Descrição |
|---------|-----------|
| `Code.gs` | Lógica do conector (auth, schema, fetch de dados) |
| `appsscript.json` | Manifesto do Apps Script / Looker Studio |
| `SETUP.md` | Guia de configuração completo |

---

Desenvolvido por [Agência Linka](https://agencialinka.com.br).
