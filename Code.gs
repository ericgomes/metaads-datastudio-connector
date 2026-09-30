var CC = DataStudioApp.createCommunityConnector();
var META_API_BASE = 'https://graph.facebook.com/v23.0';

// Chave onde o token é guardado (UserProperties). Trocar o sufixo força uma
// reautenticação única: o Looker deixa de ver a credencial antiga e reexibe a
// tela de token. Usado ao migrar do token curto do Explorer para o System User
// Token (que não expira).
var TOKEN_KEY = 'meta.token.v2';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAdminUser() {
  // Habilita a exibição das mensagens de debug (setDebugText) para você.
  return true;
}

function getAuthType() {
  return CC.newAuthTypeResponse()
    .setAuthType(CC.AuthType.USER_TOKEN)
    .setHelpUrl('https://business.facebook.com/settings/system-users')
    .build();
}

function isAuthValid() {
  var token = PropertiesService.getUserProperties().getProperty(TOKEN_KEY);
  return validateToken(token);
}

function setCredentials(request) {
  // USER_TOKEN envia { username, token }. O Meta só usa o token;
  // o username é ignorado (obrigatório apenas na UI do Looker Studio).
  var token = request.userToken.token;
  if (!validateToken(token)) {
    return { errorCode: 'INVALID_CREDENTIALS' };
  }
  PropertiesService.getUserProperties().setProperty(TOKEN_KEY, token);
  return { errorCode: 'NONE' };
}

function validateToken(token) {
  if (!token) return false;
  try {
    // Valida em /me/adaccounts (não em /me): exige o escopo `ads_read`, que é o
    // que o conector realmente precisa. Um token sem essa permissão retorna
    // erro #200 (Missing Permissions) aqui — assim é rejeitado e o Looker
    // reexibe a tela de token, em vez de passar e falhar depois no getData.
    var resp = UrlFetchApp.fetch(
      META_API_BASE + '/me/adaccounts?limit=1&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    return !JSON.parse(resp.getContentText()).error;
  } catch (e) {
    return false;
  }
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig(request) {
  try {
    return buildConfig(request);
  } catch (e) {
    // Surface the real error in the Looker Studio dialog instead of the
    // generic "error caused by this connector" message.
    CC.newUserError()
      .setDebugText('getConfig: ' + (e.stack || e.message || e))
      .setText('Erro ao carregar configuração: ' + (e.message || e))
      .throwException();
  }
}

function buildConfig(request) {
  var config = CC.getConfig();
  var token  = PropertiesService.getUserProperties().getProperty(TOKEN_KEY);
  var accounts = fetchAdAccounts(token);

  var accountSelect = config.newSelectSingle()
    .setId('ad_account_id')
    .setName('Conta de Anúncios');

  if (!accounts.length) {
    // Sem contas: o token é válido mas nenhuma conta de anúncios foi
    // vinculada ao System User. Evita um select vazio (que quebra a UI).
    accountSelect.addOption(
      config.newOptionBuilder()
        .setLabel('Nenhuma conta encontrada — vincule contas ao System User')
        .setValue('')
    );
  }

  accounts.forEach(function (acc) {
    accountSelect.addOption(
      config.newOptionBuilder()
        .setLabel(acc.name + ' (' + acc.account_id + ')')
        .setValue('act_' + acc.account_id)
    );
  });

  // Sem seletor de nível: os dados vêm no grão mais fino (anúncio + plataforma)
  // e o usuário escolhe o nível de detalhamento no relatório, arrastando as
  // dimensões (campanha / conjunto / anúncio / plataforma, ou nenhuma = conta).
  config.setDateRangeRequired(true);
  return config.build();
}

function fetchAdAccounts(token) {
  if (!token) throw new Error('Token ausente. Refaça a autenticação.');
  var url = META_API_BASE + '/me/adaccounts?fields=account_id,name&limit=200'
    + '&access_token=' + encodeURIComponent(token);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var text = resp.getContentText();
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Resposta inesperada do Meta (HTTP ' + resp.getResponseCode() + '): '
      + text.slice(0, 200));
  }
  if (data.error) {
    throw new Error('API do Meta: ' + data.error.message
      + ' (code ' + data.error.code + ')');
  }
  return data.data || [];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function getSchema(request) {
  var f = CC.getFields();
  var T = CC.FieldType;
  var A = CC.AggregationType;

  // Dimensions
  f.newDimension().setId('date').setName('Data (Dia)').setType(T.YEAR_MONTH_DAY);
  f.newDimension().setId('year_month').setName('Data (Ano Mês)').setType(T.YEAR_MONTH);
  f.newDimension().setId('account_id').setName('ID Conta').setType(T.TEXT);
  f.newDimension().setId('account_name').setName('Conta').setType(T.TEXT);
  f.newDimension().setId('campaign_id').setName('ID Campanha').setType(T.TEXT);
  f.newDimension().setId('campaign_name').setName('Campanha').setType(T.TEXT);
  f.newDimension().setId('adset_id').setName('ID Conjunto').setType(T.TEXT);
  f.newDimension().setId('adset_name').setName('Conjunto de Anúncios').setType(T.TEXT);
  f.newDimension().setId('ad_id').setName('ID Anúncio').setType(T.TEXT);
  f.newDimension().setId('ad_name').setName('Anúncio').setType(T.TEXT);
  f.newDimension().setId('ad_status').setName('Status do Anúncio').setType(T.TEXT);
  f.newDimension().setId('platform').setName('Plataforma').setType(T.TEXT);

  // Metrics
  f.newMetric().setId('impressions').setName('Impressões').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('clicks').setName('Cliques (todos)').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('link_clicks').setName('Cliques no Link').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('spend').setName('Investimento').setType(T.CURRENCY_BRL).setAggregation(A.SUM);
  f.newMetric().setId('reach').setName('Alcance').setType(T.NUMBER).setAggregation(A.SUM);
  // Métricas de razão: definidas como fórmulas para agregar corretamente em
  // qualquer nível (o Looker soma as bases e só depois divide).
  f.newMetric().setId('frequency').setName('Frequência').setType(T.NUMBER)
    .setFormula('SUM($impressions) / SUM($reach)').setAggregation(A.AUTO);
  f.newMetric().setId('cpm').setName('CPM').setType(T.CURRENCY_BRL)
    .setFormula('SUM($spend) / SUM($impressions) * 1000').setAggregation(A.AUTO);
  f.newMetric().setId('cpc').setName('CPC').setType(T.CURRENCY_BRL)
    .setFormula('SUM($spend) / SUM($clicks)').setAggregation(A.AUTO);
  f.newMetric().setId('ctr').setName('CTR').setType(T.PERCENT)
    .setFormula('SUM($clicks) / SUM($impressions)').setAggregation(A.AUTO);
  f.newMetric().setId('conversions').setName('Conversões').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('conversion_value').setName('Valor de Conversão').setType(T.CURRENCY_BRL).setAggregation(A.SUM);
  f.newMetric().setId('roas').setName('ROAS').setType(T.NUMBER)
    .setFormula('SUM($conversion_value) / SUM($spend)').setAggregation(A.AUTO);
  f.newMetric().setId('cost_per_conversion').setName('Custo por Conversão').setType(T.CURRENCY_BRL)
    .setFormula('SUM($spend) / SUM($conversions)').setAggregation(A.AUTO);
  f.newMetric().setId('video_views').setName('Views de Vídeo (100%)').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('post_engagement').setName('Engajamento').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('page_likes').setName('Curtidas na Página').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('leads').setName('Leads').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('cost_per_lead').setName('Custo por Lead').setType(T.CURRENCY_BRL)
    .setFormula('SUM($spend) / SUM($leads)').setAggregation(A.AUTO);

  return { schema: f.build() };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function getData(request) {
  try {
    return buildData(request);
  } catch (e) {
    CC.newUserError()
      .setDebugText('getData: ' + (e.stack || e.message || e))
      .setText('Erro ao carregar dados: ' + (e.message || e))
      .throwException();
  }
}

function buildData(request) {
  var token      = PropertiesService.getUserProperties().getProperty(TOKEN_KEY);
  var accountId  = request.configParams.ad_account_id;
  var startDate  = request.dateRange.startDate;
  var endDate    = request.dateRange.endDate;
  var reqFields  = request.fields.map(function (f) { return f.name; });

  var rawData    = fetchInsights(token, accountId, startDate, endDate, reqFields);
  var allSchema  = getSchema(request).schema;
  var reqSchema  = allSchema.filter(function (s) { return reqFields.indexOf(s.name) >= 0; });

  var rows = rawData.map(function (row) {
    return {
      values: reqSchema.map(function (field) { return extractValue(field.name, row); })
    };
  });

  return { schema: reqSchema, rows: rows };
}

// Dimensões do schema (o resto de request.fields são métricas).
var DIMENSION_IDS = ['date', 'year_month', 'account_id', 'account_name', 'campaign_id', 'campaign_name',
  'adset_id', 'adset_name', 'ad_id', 'ad_name', 'ad_status', 'platform'];

// Métricas derivadas do array `actions` — exigem buscar actions/action_values/video.
// Inclui as fórmulas cujas bases são de ação (roas→conversion_value, etc.).
var ACTION_METRIC_IDS = ['link_clicks', 'conversions', 'conversion_value', 'video_views',
  'post_engagement', 'page_likes', 'leads', 'roas', 'cost_per_conversion', 'cost_per_lead'];

// Janela (dias) por chamada QUANDO há breakdown de plataforma: período longo +
// breakdown estoura o limite SÍNCRONO do Meta (devolve vazio sem erro). Sem
// breakdown não é preciso fatiar — a consulta no nível pedido resolve.
var CHUNK_DAYS = 30;

// Consulta o Meta NO NÍVEL que o gráfico pede (definido pelas dimensões em
// reqFields). Métricas aditivas ficam corretas e o Meta deduplica Alcance/
// Frequência no nível certo (somar alcance entre anúncios/plataformas infla).
function fetchInsights(token, accountId, startDate, endDate, reqFields) {
  var dims        = reqFields.filter(function (f) { return DIMENSION_IDS.indexOf(f) >= 0; });
  var level       = chooseLevel(dims);
  var byPlatform  = dims.indexOf('platform') >= 0;
  var byDay       = dims.indexOf('date') >= 0;
  var byMonth     = dims.indexOf('year_month') >= 0;
  var needActions = reqFields.some(function (f) { return ACTION_METRIC_IDS.indexOf(f) >= 0; });
  var needStatus  = reqFields.indexOf('ad_status') >= 0;

  var deliveryMetrics = ['impressions', 'clicks', 'spend', 'reach'];
  var actionApiFields = ['actions', 'action_values', 'video_p100_watched_actions'];

  // Incremento temporal: diário se a dimensão Data (dia) for usada; mensal se só
  // Data (Ano Mês); nenhum caso contrário. O incremento mensal faz o Meta
  // deduplicar Alcance/Frequência POR MÊS (somar os dias inflaria).
  var increment = byDay ? 1 : (byMonth ? 'monthly' : null);
  var withDate  = byDay || byMonth;

  // Sem breakdown: entrega + actions na MESMA chamada (o zeramento só ocorre com
  // breakdown) e SEM fatiar (a consulta no nível pedido cabe no limite síncrono).
  // Alcance vem deduplicado pelo Meta no nível certo.
  if (!byPlatform) {
    var opts   = { level: level, breakdown: '', increment: increment };
    var fields = (withDate ? ['date_start'] : []).concat(hierarchyFields(level), deliveryMetrics);
    if (needActions) fields = fields.concat(actionApiFields);
    var rows = fetchInsightsPaged(token, accountId, fields, timeRange(startDate, endDate), opts);
    return attachAdStatus(rows, token, accountId, needStatus);
  }

  // Com breakdown de plataforma: sempre diário (para a chave de merge ser única
  // por dia×plataforma), fatiado em janelas, entrega e actions separadas e
  // mescladas por (id do nível + data + plataforma).
  var optsP   = { level: level, breakdown: 'publisher_platform', increment: 1 };
  var idField = primaryIdField(level);
  var deliveryFields = ['date_start'].concat(hierarchyFields(level), deliveryMetrics);
  var actionFields   = ['date_start', idField].concat(actionApiFields);

  var deliveryRows = [];
  var actionRows   = [];
  dateWindows(startDate, endDate, CHUNK_DAYS).forEach(function (w) {
    var tr = timeRange(w.since, w.until);
    deliveryRows = deliveryRows.concat(fetchInsightsPaged(token, accountId, deliveryFields, tr, optsP));
    if (needActions) {
      actionRows = actionRows.concat(fetchInsightsPaged(token, accountId, actionFields, tr, optsP));
    }
  });

  if (needActions) {
    var key = function (r) {
      return (r[idField] || '') + '|' + (r.date_start || '') + '|' + (r.publisher_platform || '');
    };
    var actionMap = {};
    actionRows.forEach(function (r) { actionMap[key(r)] = r; });
    deliveryRows.forEach(function (r) {
      var a = actionMap[key(r)];
      if (a) {
        r.actions                    = a.actions;
        r.action_values              = a.action_values;
        r.video_p100_watched_actions = a.video_p100_watched_actions;
      }
    });
  }

  return attachAdStatus(deliveryRows, token, accountId, needStatus);
}

// Status (Ativo/Pausado) NÃO vem no /insights — é atributo do anúncio. Busca
// separada em /ads?fields=id,effective_status e merge por ad_id. O status é o
// ATUAL (não histórico): o Meta não guarda o status "daquele dia".
function attachAdStatus(rows, token, accountId, needStatus) {
  if (!needStatus || !rows.length) return rows;
  var statusMap = fetchAdStatuses(token, accountId);
  rows.forEach(function (r) {
    if (r.ad_id) r.ad_status = statusMap[r.ad_id] || '';
  });
  return rows;
}

function fetchAdStatuses(token, accountId) {
  var url = META_API_BASE + '/' + accountId + '/ads'
    + '?fields=id,effective_status&limit=500'
    + '&access_token=' + encodeURIComponent(token);
  var map = {};
  while (url) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    if (data.error) {
      throw new Error('API do Meta (status) [code ' + data.error.code + ']: ' + data.error.message);
    }
    (data.data || []).forEach(function (a) { map[a.id] = translateStatus(a.effective_status); });
    url = (data.paging && data.paging.next) ? data.paging.next : null;
  }
  return map;
}

// Traduz o effective_status do Meta para rótulos amigáveis (PT-BR).
var STATUS_LABELS = {
  ACTIVE:               'Ativo',
  PAUSED:               'Pausado',
  ADSET_PAUSED:         'Pausado (conjunto)',
  CAMPAIGN_PAUSED:      'Pausado (campanha)',
  PENDING_REVIEW:       'Em análise',
  DISAPPROVED:          'Reprovado',
  PREAPPROVED:          'Pré-aprovado',
  PENDING_BILLING_INFO: 'Aguardando cobrança',
  IN_PROCESS:           'Em processamento',
  WITH_ISSUES:          'Com problemas',
  ARCHIVED:             'Arquivado',
  DELETED:              'Excluído'
};

function translateStatus(status) {
  return STATUS_LABELS[status] || status || '';
}

// Nível da API do Meta conforme a dimensão de hierarquia mais fina pedida.
function chooseLevel(dims) {
  // ad_status é atributo do anúncio → exige o nível 'ad' (join por ad_id).
  if (dims.indexOf('ad_id') >= 0 || dims.indexOf('ad_name') >= 0 || dims.indexOf('ad_status') >= 0) return 'ad';
  if (dims.indexOf('adset_id') >= 0 || dims.indexOf('adset_name') >= 0) return 'adset';
  if (dims.indexOf('campaign_id') >= 0 || dims.indexOf('campaign_name') >= 0) return 'campaign';
  return 'account';
}

// Campos de id/nome de hierarquia disponíveis no nível (do topo até o nível).
function hierarchyFields(level) {
  var f = ['account_id', 'account_name'];
  if (level === 'campaign' || level === 'adset' || level === 'ad') f = f.concat(['campaign_id', 'campaign_name']);
  if (level === 'adset' || level === 'ad') f = f.concat(['adset_id', 'adset_name']);
  if (level === 'ad') f = f.concat(['ad_id', 'ad_name']);
  return f;
}

function primaryIdField(level) {
  return level === 'ad'       ? 'ad_id'
       : level === 'adset'    ? 'adset_id'
       : level === 'campaign' ? 'campaign_id'
       : 'account_id';
}

function timeRange(since, until) {
  return encodeURIComponent('{"since":"' + since + '","until":"' + until + '"}');
}

// Divide [startDate, endDate] (YYYY-MM-DD) em janelas de no máximo `days` dias.
function dateWindows(startDate, endDate, days) {
  var windows = [];
  var cur = new Date(startDate + 'T00:00:00Z');
  var end = new Date(endDate + 'T00:00:00Z');
  while (cur <= end) {
    var winEnd = new Date(cur.getTime());
    winEnd.setUTCDate(winEnd.getUTCDate() + days - 1);
    if (winEnd > end) winEnd = end;
    windows.push({ since: ymd(cur), until: ymd(winEnd) });
    cur = new Date(winEnd.getTime());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return windows;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function fetchInsightsPaged(token, accountId, fieldsArray, timeRangeParam, opts) {
  var url = META_API_BASE + '/' + accountId + '/insights'
    + '?fields=' + fieldsArray.join(',')
    + '&time_range=' + timeRangeParam
    + '&level=' + opts.level
    + '&limit=500'
    + '&access_token=' + encodeURIComponent(token);
  if (opts.increment) url += '&time_increment=' + opts.increment;
  if (opts.breakdown) url += '&breakdowns=' + opts.breakdown;

  var allData = [];
  while (url) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());

    if (data.error) {
      // Propaga a mensagem REAL do Meta (código + texto). Lançar um Error comum
      // (em vez de CC.newUserError, que o catch do getData re-embrulha em
      // "Exception" genérico) faz a causa aparecer no diálogo do Looker.
      throw new Error('API do Meta [code ' + data.error.code
        + (data.error.error_subcode ? '/' + data.error.error_subcode : '')
        + ']: ' + data.error.message);
    }

    if (data.data) allData = allData.concat(data.data);
    url = (data.paging && data.paging.next) ? data.paging.next : null;
  }
  return allData;
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

function extractValue(fieldName, row) {
  switch (fieldName) {
    case 'date':             return (row.date_start || '').replace(/-/g, '');
    case 'year_month':       return (row.date_start || '').slice(0, 7).replace('-', '');
    case 'account_id':       return row.account_id    || '';
    case 'account_name':     return row.account_name  || '';
    case 'campaign_id':      return row.campaign_id   || '';
    case 'campaign_name':    return row.campaign_name || '';
    case 'adset_id':         return row.adset_id      || '';
    case 'adset_name':       return row.adset_name    || '';
    case 'ad_id':            return row.ad_id         || '';
    case 'ad_name':          return row.ad_name       || '';
    case 'ad_status':        return row.ad_status     || '';
    case 'platform':         return row.publisher_platform || 'all';
    case 'impressions':      return intVal(row.impressions);
    case 'clicks':           return intVal(row.clicks);
    case 'spend':            return floatVal(row.spend);
    case 'reach':            return intVal(row.reach);
    case 'link_clicks':      return actionInt(row.actions, 'link_click');
    case 'conversions':      return purchaseInt(row.actions);
    case 'conversion_value': return purchaseFloat(row.action_values);
    case 'video_views':      return actionInt(row.video_p100_watched_actions, 'video_view');
    case 'post_engagement':  return actionInt(row.actions, 'post_engagement');
    case 'page_likes':       return actionInt(row.actions, 'like');
    case 'leads':            return leadCount(row.actions);
    // frequency, cpm, cpc, ctr, roas, cost_per_conversion e cost_per_lead
    // são campos com fórmula (getSchema) e calculados pelo Looker Studio.
    default: return null;
  }
}

function intVal(v)   { return parseInt(v  || 0, 10); }
function floatVal(v) { return parseFloat(v || 0); }

function getAction(actions, type) {
  if (!Array.isArray(actions)) return null;
  return actions.find(function (a) { return a.action_type === type; }) || null;
}

function actionInt(actions, type) {
  var a = getAction(actions, type);
  return a ? parseInt(a.value, 10) : 0;
}

function leadCount(actions) {
  // Prioriza 'lead' (form/pixel padrão); se ausente, usa o agrupado onsite.
  return actionInt(actions, 'lead')
      || actionInt(actions, 'onsite_conversion.lead_grouped');
}

function purchaseInt(actions) {
  return actionInt(actions, 'offsite_conversion.fb_pixel_purchase')
      || actionInt(actions, 'purchase')
      || actionInt(actions, 'omni_purchase');
}

function purchaseFloat(actionValues) {
  var types = [
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
    'omni_purchase'
  ];
  for (var i = 0; i < types.length; i++) {
    var a = getAction(actionValues, types[i]);
    if (a) return parseFloat(a.value);
  }
  return 0;
}
