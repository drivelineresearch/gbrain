import type { Page } from './types.ts';

/**
 * Per-page extraction policy. `extractable: false` keeps a page searchable
 * and graph-linked while preventing derived atoms/conversation facts.
 * Accept the string form as well because legacy importers may preserve a
 * quoted YAML scalar.
 */
export function isPageExtractable(
  page: Pick<Page, 'frontmatter'>,
): boolean {
  const value = page.frontmatter?.extractable;
  return value !== false
    && !(typeof value === 'string' && value.trim().toLowerCase() === 'false');
}
