// AUTO-GENERATED — do not edit by hand.
// Run `bun run scripts/build-admin-embedded.ts` to regenerate.
// Source: admin/dist/ at 2026-07-22.
//
// Bun resolves the file: imports to a path that works at runtime even
// inside a compiled binary (`bun build --compile`). The manifest maps
// the request path the express handler sees to (resolved-path, mime).

// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_0_assets_Gotham_Book_C1TAP_J8_otf from '../admin/dist/assets/Gotham-Book-C1TAP-J8.otf' with { type: 'file' };
// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_1_assets_Gotham_Medium_DhU0b2rU_otf from '../admin/dist/assets/Gotham-Medium-DhU0b2rU.otf' with { type: 'file' };
// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_2_assets_d_plus_orange_DWhrmeJd_png from '../admin/dist/assets/d-plus-orange-DWhrmeJd.png' with { type: 'file' };
// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_3_assets_index_B0UTNwF0_css from '../admin/dist/assets/index-B0UTNwF0.css' with { type: 'file' };
// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_4_assets_index_DS4SyB0S_js from '../admin/dist/assets/index-DS4SyB0S.js' with { type: 'file' };
// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts
import A_5_index_html from '../admin/dist/index.html' with { type: 'file' };

export interface AdminAsset {
  path: string;
  mime: string;
}

export const ADMIN_ASSETS: Record<string, AdminAsset> = {
  "/admin/assets/Gotham-Book-C1TAP-J8.otf": { path: A_0_assets_Gotham_Book_C1TAP_J8_otf as unknown as string, mime: "application/octet-stream" },
  "/admin/assets/Gotham-Medium-DhU0b2rU.otf": { path: A_1_assets_Gotham_Medium_DhU0b2rU_otf as unknown as string, mime: "application/octet-stream" },
  "/admin/assets/d-plus-orange-DWhrmeJd.png": { path: A_2_assets_d_plus_orange_DWhrmeJd_png as unknown as string, mime: "image/png" },
  "/admin/assets/index-B0UTNwF0.css": { path: A_3_assets_index_B0UTNwF0_css as unknown as string, mime: "text/css; charset=utf-8" },
  "/admin/assets/index-DS4SyB0S.js": { path: A_4_assets_index_DS4SyB0S_js as unknown as string, mime: "application/javascript; charset=utf-8" },
  "/admin/index.html": { path: A_5_index_html as unknown as string, mime: "text/html; charset=utf-8" },
};

/** Index entry point for SPA fallback. */
export const ADMIN_INDEX_HTML: AdminAsset = ADMIN_ASSETS['/admin/index.html'];

export const ADMIN_ASSET_COUNT = 6;
