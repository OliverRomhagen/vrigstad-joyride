import { loadPage } from '#lib/pages';
import type { PageLoad } from './$types';

// The component is loaded here, not in the page, so prerendering writes the page's text into the HTML.
export const load: PageLoad = async ({ data }) => ({ ...data, Page: (await loadPage(data.entry.slug))?.default });
