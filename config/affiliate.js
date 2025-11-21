// config/affiliate.js

const RETAILERS = [
  {
    key: 'sportsshoes',
    label: 'Sportsshoes',
    baseSearchUrl: 'https://www.sportsshoes.com/search/?q=',
  },
  {
    key: 'startFitness',
    label: 'Start Fitness',
    baseSearchUrl: 'https://www.startfitness.co.uk/catalogsearch/result/?q=',
  },
  {
    key: 'runningWarehouse',
    label: 'Running Warehouse EU',
    baseSearchUrl: 'https://www.runningwarehouse.eu/search.html?search=',
  },
  {
    key: 'proDirect',
    label: 'Pro:Direct Running',
    baseSearchUrl: 'https://www.prodirectrunning.com/lists/search.aspx?search=',
  },
  {
    key: 'runRepeat',
    label: 'RunRepeat review',
    baseSearchUrl: 'https://runrepeat.com/search?q=',
  },
];

function buildUrlWithAffiliate(base) {
  return base;
}

/**
 * Generate affiliate links for a given shoe name. The engine only needs a
 * string; retailers handle the search query on their side.
 *
 * @param {string} shoeName
 * @returns {Array<{key: string, label: string, url: string, type?: string}>}
 */
export function getAffiliateLinksForShoe(shoeName) {
  if (!shoeName) return [];
  const query = encodeURIComponent(shoeName);

  return RETAILERS.map((site) => {
    const url = `${site.baseSearchUrl}${query}`;
    return {
      key: site.key,
      label: site.label,
      url: buildUrlWithAffiliate(url),
      type: site.key === 'runRepeat' ? 'resource' : 'retailer',
    };
  });
}
