import type { FieldSuggest } from '@kedalion/ui/grid';
import { DEFAULT_TICKET_PATTERN } from './map';

/** Ready-made ticket key patterns for the `ticketPattern` / `keyPattern` fields; a custom regex can still be typed. */
export const TICKET_PATTERN_SUGGEST: FieldSuggest = {
  options: [
    { value: DEFAULT_TICKET_PATTERN, label: 'Any project (ABC-123)' },
    { value: 'ABC-\\d+', label: 'One project (replace ABC)' },
  ],
};
