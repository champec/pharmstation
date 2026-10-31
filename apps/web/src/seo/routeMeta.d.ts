export declare const SITE_URL = "https://pharmstation.co.uk";
export declare const SITE_NAME = "PharmStation";
export declare const DEFAULT_TITLE = "PharmStation | Your Digital Pharmacy Workstation";
export declare const DEFAULT_DESCRIPTION = "PharmStation is the digital workstation for UK community pharmacies: CD register, RP log, NHS and private services, online booking, SOPs and patient messaging in one place.";
export interface PageMeta {
    title: string;
    description?: string;
    /** Public pages are indexed by search engines; everything else gets noindex. */
    index: boolean;
}
interface PublicPage {
    path: string;
    title: string;
    description: string;
}
/** Every public, indexable page with a fixed URL. These also make up sitemap.xml. */
export declare const PUBLIC_PAGES: PublicPage[];
export declare function getPageMeta(pathname: string): PageMeta;
export declare function formatTitle(title: string): string;
export {};
//# sourceMappingURL=routeMeta.d.ts.map