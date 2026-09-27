/**
 * LinkedIn Jobs selector map (D.5).
 *
 * Externalized so the selector-health probe + the parser can share one
 * source of truth. LinkedIn re-skins their DOM every few weeks; when that
 * happens we bump `SELECTOR_VERSION` and the probe (D.8 cron) alerts on
 * drift instead of the discover script silently returning zero rows.
 *
 * Both CSS-attribute selectors and cheerio-friendly plain selectors live
 * here (no XPath, no :has-text — kept portable between Playwright DOM and
 * cheerio pure-HTML parsing).
 */

export const SELECTOR_VERSION = 'linkedin-v1';

export const SELECTORS = {
  // Search page inputs (Playwright side).
  searchInput: 'input[aria-label*="Search job titles"]',
  locationInput: 'input[aria-label*="City"]',
  remoteFilterButton: 'button[aria-label*="Remote filter"]',
  nextButton: 'button[aria-label="View next page"]',

  // Job card + fields (shared by Playwright DOM reads and cheerio parsing).
  jobCard: 'li.jobs-search-results__list-item, div.job-search-card, li[data-occludable-job-id]',
  jobLink: 'a.base-card__full-link, a.job-card-container__link',
  jobTitle: 'h3.base-search-card__title, a.job-card-container__link span[aria-hidden="true"]',
  company: 'h4.base-search-card__subtitle a, .job-card-container__primary-description',
  location: '.job-search-card__location, .job-card-container__metadata-item',
  postedAt: 'time.job-search-card__listdate, time.job-search-card__listdate--new',
  easyApplyBadge: 'li.job-search-card__easy-apply-label, .job-card-container__easy-apply-label',
  promotedBadge: '.job-search-card__promoted, [data-tracking-control-name*="promoted"]',
  expiredBadge: '.job-search-card__benefits--expired, .result-benefits--expired',

  // Whole-page structural anchors used by selectorHealth probing.
  resultsList: 'ul.jobs-search__results-list, div.jobs-search-results-list',
  noResults: '.jobs-search-no-results, .jobs-search-no-results-banner',
} as const;

export type SelectorKey = keyof typeof SELECTORS;
