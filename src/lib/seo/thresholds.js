export const SEO_THRESHOLDS = {
  opportunityPeriodDays: 28,
  page2to3: { positionMin: 8, positionMax: 30, minImpressions: 20 },
  titleImprove: { maxPosition: 10, minImpressions: 50, maxCtr: 0.02 },
  newQueries: { recentDays: 7, lookbackDays: 28 },
  drops: { minPositionWorsening: 5, minImpressions: 20 },
  cannibalization: { minPages: 2, minImpressionsPerPage: 10 },
};

export const SEO_PERIOD_DAYS = {
  "7d": 7,
  "28d": 28,
  "3m": 90,
  "12m": 365,
};
