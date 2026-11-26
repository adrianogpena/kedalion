import type { FieldSuggest } from '@kedalion/ui/grid';

const CURRENCIES: readonly (readonly [string, string])[] = [
  ['EUR', 'Euro'], ['USD', 'US dollar'], ['BRL', 'Brazilian real'], ['GBP', 'Pound sterling'], ['JPY', 'Japanese yen'],
  ['CHF', 'Swiss franc'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'], ['CNY', 'Chinese yuan'],
  ['HKD', 'Hong Kong dollar'], ['SGD', 'Singapore dollar'], ['INR', 'Indian rupee'], ['KRW', 'South Korean won'], ['MXN', 'Mexican peso'],
  ['ARS', 'Argentine peso'], ['CLP', 'Chilean peso'], ['COP', 'Colombian peso'], ['ZAR', 'South African rand'], ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'], ['DKK', 'Danish krone'], ['PLN', 'Polish zloty'], ['CZK', 'Czech koruna'], ['HUF', 'Hungarian forint'],
  ['RON', 'Romanian leu'], ['TRY', 'Turkish lira'], ['ILS', 'Israeli shekel'], ['THB', 'Thai baht'], ['IDR', 'Indonesian rupiah'],
  ['PHP', 'Philippine peso'], ['MYR', 'Malaysian ringgit'], ['ISK', 'Icelandic krona'], ['BGN', 'Bulgarian lev'],
];

/** ISO currency codes for the exchange rate `base` / `quote` fields; any other code can still be typed. */
export const CURRENCY_SUGGEST: FieldSuggest = { options: CURRENCIES.map(([value, label]) => ({ value, label })) };
