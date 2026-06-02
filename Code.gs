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
  if (!token) return false;
  try {
    var resp = UrlFetchApp.fetch(
      META_API_BASE + '/me?access_token=' + token,
      { muteHttpExceptions: true }
    );
    return !JSON.parse(resp.getContentText()).error;
  } catch (e) {
    return false;
  }
}

function setCredentials(request) {
  PropertiesService.getUserProperties().setProperty('dscc.token', request.userToken);
  return { errorCode: 'NONE' };
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty('dscc.token');
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig(request) {
  var config = CC.newConfig();
  var token  = PropertiesService.getUserProperties().getProperty('dscc.token');
  var accounts = fetchAdAccounts(token);

  var accountSelect = config.newSelectSingle()
    .setId('ad_account_id')
    .setName('Conta de Anúncios')
    .setIsDynamic(true);

  accounts.forEach(function (acc) {
    accountSelect.addOption(
      config.newOptionBuilder()
        .setLabel(acc.name + ' (' + acc.account_id + ')')
        .setValue('act_' + acc.account_id)
    );
  });

  config.newSelectSingle()
    .setId('breakdown')
    .setName('Nível de Detalhamento')
    .addOption(config.newOptionBuilder().setLabel('Conta (sem breakdown)').setValue('account'))
    .addOption(config.newOptionBuilder().setLabel('Campanha').setValue('campaign'))
    .addOption(config.newOptionBuilder().setLabel('Conjunto de Anúncios').setValue('adset'))
    .addOption(config.newOptionBuilder().setLabel('Anúncio').setValue('ad'))
    .addOption(config.newOptionBuilder().setLabel('Plataforma').setValue('platform'));

  config.setDateRangeRequired(true);
  return config.build();
}

function fetchAdAccounts(token) {
  var url = META_API_BASE + '/me/adaccounts?fields=account_id,name&limit=200&access_token=' + token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(resp.getContentText());
  if (data.error) {
    CC.newUserError()
      .setDebugText(data.error.message)
      .setText('Erro ao buscar contas: ' + data.error.message)
      .throwException();
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
  f.newMetric().setId('frequency').setName('Frequência').setType(T.NUMBER).setAggregation(A.AUTO);
  f.newMetric().setId('cpm').setName('CPM').setType(T.CURRENCY_BRL).setAggregation(A.AUTO);
  f.newMetric().setId('cpc').setName('CPC').setType(T.CURRENCY_BRL).setAggregation(A.AUTO);
  f.newMetric().setId('ctr').setName('CTR').setType(T.PERCENT).setAggregation(A.AUTO);
  f.newMetric().setId('conversions').setName('Conversões').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('conversion_value').setName('Valor de Conversão').setType(T.CURRENCY_BRL).setAggregation(A.SUM);
  f.newMetric().setId('roas').setName('ROAS').setType(T.NUMBER).setAggregation(A.AUTO);
  f.newMetric().setId('cost_per_conversion').setName('Custo por Conversão').setType(T.CURRENCY_BRL).setAggregation(A.AUTO);
  f.newMetric().setId('video_views').setName('Views de Vídeo (100%)').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('post_engagement').setName('Engajamento').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('page_likes').setName('Curtidas na Página').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('leads').setName('Leads').setType(T.NUMBER).setAggregation(A.SUM);
  f.newMetric().setId('cost_per_lead').setName('Custo por Lead').setType(T.CURRENCY_BRL).setAggregation(A.AUTO);

  return { schema: f.build() };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function getData(request) {
  var token      = PropertiesService.getUserProperties().getProperty('dscc.token');
  var accountId  = request.configParams.ad_account_id;
  var breakdown  = request.configParams.breakdown || 'account';
  var startDate  = request.dateRange.startDate;
  var endDate    = request.dateRange.endDate;
  var reqFields  = request.fields.map(function (f) { return f.name; });

  var rawData    = fetchInsights(token, accountId, breakdown, startDate, endDate);
  var allSchema  = getSchema(request).schema;
  var reqSchema  = allSchema.filter(function (s) { return reqFields.indexOf(s.name) >= 0; });

  var rows = rawData.map(function (row) {
    return {
      values: reqSchema.map(function (field) { return extractValue(field.name, row); })
    };
  });

  return { schema: reqSchema, rows: rows };
}

function fetchInsights(token, accountId, breakdown, startDate, endDate) {
  var level = breakdown === 'platform' ? 'account' : breakdown;

  var fields = [
    'date_start',
    'campaign_id', 'campaign_name',
    'adset_id', 'adset_name',
    'ad_id', 'ad_name',
    'impressions', 'clicks', 'spend', 'reach', 'frequency',
    'cpm', 'cpc', 'ctr',
    'actions', 'action_values',
    'video_p100_watched_actions'
  ].join(',');

  var timeRange = encodeURIComponent('{"since":"' + startDate + '","until":"' + endDate + '"}');
  var breakdownParam = breakdown === 'platform' ? '&breakdowns=publisher_platform' : '';

  var base = META_API_BASE + '/' + accountId + '/insights'
    + '?fields=' + fields
    + '&time_range=' + timeRange
    + '&time_increment=1'
    + '&level=' + level
    + '&limit=500'
    + '&access_token=' + token
    + breakdownParam;

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
    case 'frequency':        return floatVal(row.frequency);
    case 'cpm':              return floatVal(row.cpm);
    case 'cpc':              return floatVal(row.cpc);
    case 'ctr':              return floatVal(row.ctr) / 100;
    case 'link_clicks':      return actionInt(row.actions, 'link_click');
    case 'conversions':      return purchaseInt(row.actions);
    case 'conversion_value': return purchaseFloat(row.action_values);
    case 'roas': {
      var cv = purchaseFloat(row.action_values);
      var sp = floatVal(row.spend);
      return sp > 0 ? cv / sp : 0;
    }
    case 'cost_per_conversion': {
      var conv = purchaseInt(row.actions);
      var sp2  = floatVal(row.spend);
      return conv > 0 ? sp2 / conv : 0;
    }
    case 'video_views':      return actionInt(row.video_p100_watched_actions, 'video_view');
    case 'post_engagement':  return actionInt(row.actions, 'post_engagement');
    case 'page_likes':       return actionInt(row.actions, 'like');
    case 'leads':            return actionInt(row.actions, 'lead') || actionInt(row.actions, 'onsite_conversion.lead_grouped');
    case 'cost_per_lead': {
      var leads = actionInt(row.actions, 'lead') || actionInt(row.actions, 'onsite_conversion.lead_grouped');
      var sp3   = floatVal(row.spend);
      return leads > 0 ? sp3 / leads : 0;
    }
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
