// config/affiliate.js

const SITE_CONFIG = {
  sportsshoes: {
    key: 'sportsshoes',
    name: 'Sportsshoes',
    baseSearchUrl: 'https://www.sportsshoes.com/search/?q=',
    affiliateParam: '',
  },
  startFitness: {
    key: 'startFitness',
    name: 'Start Fitness',
    baseSearchUrl: 'https://www.startfitness.co.uk/catalogsearch/result/?q=',
    affiliateParam: '',
  },
  runningWarehouse: {
    key: 'runningWarehouse',
    name: 'Running Warehouse EU',
    baseSearchUrl: 'https://www.runningwarehouse.eu/search.html?search=',
    affiliateParam: '',
  },
  proDirect: {
    key: 'proDirect',
    name: 'Pro:Direct Running',
    baseSearchUrl: 'https://www.prodirectrunning.com/lists/search.aspx?search=',
    affiliateParam: '',
  },
  runRepeat: {
    key: 'runRepeat',
    name: 'RunRepeat review',
    baseUrl: 'https://runrepeat.com/',
  },
};

function buildUrlWithAffiliate(base, affiliateParam) {
  if (!affiliateParam) return base;
  return base + (base.includes('?') ? '&' : '?') + affiliateParam;
}

export function getAffiliateLinksForShoe(shoe) {
  const query = encodeURIComponent(`${shoe.brand} ${shoe.model}`);
  const links = [];

  for (const siteKey of ['sportsshoes', 'startFitness', 'runningWarehouse', 'proDirect']) {
    const site = SITE_CONFIG[siteKey];
    const base = `${site.baseSearchUrl}${query}`;
    links.push({
      key: site.key,
      label: site.name,
      url: buildUrlWithAffiliate(base, site.affiliateParam),
      type: 'retailer',
    });
  }

  if (shoe.runRepeatSlug) {
    const base = `${SITE_CONFIG.runRepeat.baseUrl}${shoe.runRepeatSlug}`;
    links.push({
      key: SITE_CONFIG.runRepeat.key,
      label: SITE_CONFIG.runRepeat.name,
      url: base,
    });
  }

  return links;
}
