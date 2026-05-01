export type PortfolioHolding = {
  ticker: string;
  assetClass: string;
  account?: string;
  shares?: number;
  currentPrice?: number;
  marketValue?: number;
  costBasis: number;
  income12m?: number;
};

export type PortfolioHoldingWithTotals = PortfolioHolding & {
  marketValue: number;
  costValue: number;
  unrealizedGainLoss: number;
  portfolioPct: number;
};

export function calculatePortfolioTotals(holdings: PortfolioHolding[]) {
  const enriched = holdings.map((holding) => {
    const shares = holding.shares ?? 1;
    const marketValue = typeof holding.marketValue === 'number'
      ? holding.marketValue
      : shares * (holding.currentPrice ?? 0);
    const costValue = shares * holding.costBasis;
    return {
      ...holding,
      marketValue,
      costValue,
      unrealizedGainLoss: marketValue - costValue,
      portfolioPct: 0,
    };
  });

  const totalMarketValue = enriched.reduce((sum, holding) => sum + holding.marketValue, 0);
  const totalCostBasis = enriched.reduce((sum, holding) => sum + holding.costValue, 0);
  const unrealizedGainLoss = totalMarketValue - totalCostBasis;

  return {
    totalMarketValue,
    totalCostBasis,
    unrealizedGainLoss,
    holdings: enriched.map((holding) => ({
      ...holding,
      portfolioPct: totalMarketValue > 0 ? (holding.marketValue / totalMarketValue) * 100 : 0,
    })) as PortfolioHoldingWithTotals[],
  };
}

export function parseCurrencyValue(input: string) {
  const cleaned = input.replace(/[$,\s]/g, '').toLowerCase();
  if (!cleaned) return 0;
  const multiplier = cleaned.endsWith('k') ? 1_000 : cleaned.endsWith('m') ? 1_000_000 : 1;
  const numeric = parseFloat(cleaned.replace(/[km]$/, ''));
  return Number.isNaN(numeric) ? 0 : numeric * multiplier;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
