var CC = DataStudioApp.createCommunityConnector();
var META_API_BASE = 'https://graph.facebook.com/v19.0';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthType() {
  return CC.newAuthTypeResponse()
    .setAuthType(CC.AuthType.USER_TOKEN)
    .setHelpUrl('https://business.facebook.com/settings/system-users')
    .build();
}

function isAuthValid() {
  var token = PropertiesService.getUserProperties().getProperty('dscc.token');
  return validateToken(token);
}

function setCredentials(request) {
  // USER_TOKEN envia { username, token }. O Meta só usa o token;
  // o username é ignorado (obrigatório apenas na UI do Looker Studio).
  var token = request.userToken.token;
  if (!validateToken(token)) {
    return { errorCode: 'INVALID_CREDENTIALS' };
  }
  PropertiesService.getUserProperties().setProperty('dscc.token', token);
  return { errorCode: 'NONE' };
}

function validateToken(token) {
  if (!token) return false;
  try {
    var resp = UrlFetchApp.fetch(
      META_API_BASE + '/me?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    return !JSON.parse(resp.getContentText()).error;
  } catch (e) {
    return false;
  }
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty('dscc.token');
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
  var token  = PropertiesService.getUserProperties().getProperty('dscc.token');
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
  f.newDimension().setId('date').setName('Data').setType(T.YEAR_MONTH_DAY);
  f.newDimension().setId('campaign_id').setName('ID Campanha').setType(T.TEXT);
  f.newDimension().setId('campaign_name').setName('Campanha').setType(T.TEXT);
  f.newDimension().setId('adset_id').setName('ID Conjunto').setType(T.TEXT);
  f.newDimension().setId('adset_name').setName('Conjunto de Anúncios').setType(T.TEXT);
  f.newDimension().setId('ad_id').setName('ID Anúncio').setType(T.TEXT);
  f.newDimension().setId('ad_name').setName('Anúncio').setType(T.TEXT);
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
  var token      = PropertiesService.getUserProperties().getProperty('dscc.token');
  var accountId  = request.configParams.ad_account_id;
  var startDate  = request.dateRange.startDate;
  var endDate    = request.dateRange.endDate;
  var reqFields  = request.fields.map(function (f) { return f.name; });

  var rawData    = fetchInsights(token, accountId, startDate, endDate);
  var allSchema  = getSchema(request).schema;
  var reqSchema  = allSchema.filter(function (s) { return reqFields.indexOf(s.name) >= 0; });

  var rows = rawData.map(function (row) {
    return {
      values: reqSchema.map(function (field) { return extractValue(field.name, row); })
    };
  });

  return { schema: reqSchema, rows: rows };
}

function fetchInsights(token, accountId, startDate, endDate) {
  // Sempre no grão mais fino: nível de anúncio + breakdown por plataforma.
  // Assim o Looker Studio consegue agregar para qualquer nível (conta,
  // campanha, conjunto, anúncio ou plataforma) apenas escolhendo dimensões.
  var fields = [
    'date_start',
    'campaign_id', 'campaign_name',
    'adset_id', 'adset_name',
    'ad_id', 'ad_name',
    'impressions', 'clicks', 'spend', 'reach',
    'actions', 'action_values',
    'video_p100_watched_actions'
  ].join(',');

  var timeRange = encodeURIComponent('{"since":"' + startDate + '","until":"' + endDate + '"}');

  var base = META_API_BASE + '/' + accountId + '/insights'
    + '?fields=' + fields
    + '&time_range=' + timeRange
    + '&time_increment=1'
    + '&level=ad'
    + '&breakdowns=publisher_platform'
    + '&limit=500'
    + '&access_token=' + encodeURIComponent(token);

  var allData = [];
  var url = base;

  while (url) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());

    if (data.error) {
      CC.newUserError()
        .setDebugText(JSON.stringify(data.error))
        .setText('Erro na API do Meta: ' + data.error.message)
        .throwException();
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
    case 'campaign_id':      return row.campaign_id   || '';
    case 'campaign_name':    return row.campaign_name || '';
    case 'adset_id':         return row.adset_id      || '';
    case 'adset_name':       return row.adset_name    || '';
    case 'ad_id':            return row.ad_id         || '';
    case 'ad_name':          return row.ad_name       || '';
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
