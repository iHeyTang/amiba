export interface CookieSource {
  id: string;
  browser: string;
  profile: string;
}
export interface CookieSite {
  domain: string;
  count: number;
}
export interface CookieImportResult {
  imported: number;
  preserved: number;
  expired: number;
  unsupported: number;
  failed: number;
}
export interface CookieImportAdapter {
  sources(): Promise<{ supported: boolean; sources: CookieSource[] }>;
  sites(sourceId: string): Promise<CookieSite[]>;
  run(
    sourceId: string,
    /** null imports all websites in this source profile. */
    domains: string[] | null,
    overwrite: boolean,
  ): Promise<CookieImportResult>;
}
