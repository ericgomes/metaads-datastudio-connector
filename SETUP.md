# Meta Ads Connector — Guia de Configuração

## Parte 1: Criar App no Meta for Developers

1. Acesse https://developers.facebook.com/apps
2. Clique em **Criar App**
3. Selecione tipo: **Outros** → **Business**
4. Preencha nome (ex: "Agência Looker Studio") e e-mail
5. No painel do App, vá em **Configurações → Básico**
6. Anote o **App ID** e o **App Secret** (vai precisar depois)

### Adicionar produto Marketing API

1. No painel do App, clique em **Adicionar produto**
2. Encontre **Marketing API** e clique em **Configurar**
3. Pronto — o app agora tem acesso às APIs de anúncios

---

## Parte 2: Gerar System User Token (não expira)

1. Acesse https://business.facebook.com/settings/system-users
2. Clique em **Adicionar** → crie um System User com papel **Admin**
3. Clique no System User criado → **Gerar novo token**
4. Selecione o App que você criou na Parte 1
5. Marque as permissões:
   - `ads_read`
   - `ads_management` (necessário para listar contas)
   - `business_management`
   - `read_insights`
6. Clique em **Gerar token** e **copie o token** — você não verá novamente
7. Adicione as contas dos clientes a este System User:
   - Ainda na tela do System User, clique em **Adicionar ativos**
   - Selecione **Contas de anúncios** das contas de cada cliente
   - Permissão: **Analisar campanha**

---

## Parte 3: Criar o projeto no Google Apps Script

1. Acesse https://script.google.com
2. Clique em **Novo projeto**
3. Renomeie para "Meta Ads Connector"
4. Substitua o conteúdo do arquivo `Code.gs` pelo conteúdo do arquivo `Code.gs` deste repositório
5. Clique no ícone de engrenagem (Configurações do projeto)
6. Ative **"Mostrar arquivo de manifesto 'appsscript.json' no editor"**
7. Abra o `appsscript.json` e substitua pelo conteúdo do arquivo deste repositório
8. Salve (Ctrl+S)

---

## Parte 4: Deploy no Looker Studio

1. No Apps Script, clique em **Implantar → Nova implantação**
2. Tipo: **Complemento do Looker Studio**
3. Descrição: "v1"
4. Clique em **Implantar** e copie a URL do deployment (começa com `https://datastudio.google.com/...`)

### Conectar no Looker Studio

1. Abra https://lookerstudio.google.com
2. Clique em **Criar → Fonte de dados**
3. Role até o final e clique em **Criar seu próprio conector**
4. Cole a URL do deployment e pressione Enter
5. Clique em **Autorizar**
6. Em **Token de acesso**, cole o System User Token gerado na Parte 2
7. Selecione a **Conta de Anúncios** do cliente
8. Escolha o **Nível de detalhamento** (Campanha, Conjunto, Anúncio, etc.)
9. Clique em **Conectar**

---

## Métricas disponíveis

| Campo | Descrição |
|-------|-----------|
| Data | Data da métrica |
| Campanha / Conjunto / Anúncio | Dimensões de hierarquia |
| Plataforma | Facebook, Instagram, Audience Network |
| Impressões | Total de impressões |
| Cliques (todos) | Todos os cliques |
| Cliques no Link | Cliques que levaram ao destino |
| Investimento | Valor gasto (R$) |
| Alcance | Pessoas únicas alcançadas |
| Frequência | Média de vezes que cada pessoa viu |
| CPM | Custo por mil impressões |
| CPC | Custo por clique |
| CTR | Taxa de cliques |
| Conversões | Compras rastreadas pelo Pixel |
| Valor de Conversão | Receita atribuída |
| ROAS | Retorno sobre investimento em ads |
| Custo por Conversão | Gasto ÷ conversões |
| Views de Vídeo (100%) | Visualizações completas |
| Engajamento | Total de interações com o post |
| Leads | Leads gerados (formulário ou pixel) |
| Custo por Lead | Gasto ÷ leads |

---

## Para adicionar uma nova conta de cliente

1. Acesse https://business.facebook.com/settings/system-users
2. Selecione o System User
3. Clique em **Adicionar ativos** → **Contas de anúncios**
4. Adicione a conta do novo cliente com permissão **Analisar campanha**
5. O token já existente passa a ter acesso — não precisa gerar novo token
