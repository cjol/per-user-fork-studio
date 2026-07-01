import {
  createMemoryStorage,
  handleAssetRequest,
  type CreateAppResult
} from "@cloudflare/worker-bundler";

interface FacetsApi {
  get<T>(name: string, init: () => { class: unknown; id: string }): T;
  abort(name: string, err: Error): void;
}

export function facetsApi(ctx: unknown): FacetsApi {
  return (
    ctx as {
      facets: FacetsApi;
    }
  ).facets;
}

export function appFacet(options: {
  env: Env;
  facets: FacetsApi;
  built: CreateAppResult;
  name: string;
  buildVersion: number;
  facetGen: number;
  facetVersion: number;
  setFacetVersion(version: number): void;
}): Fetcher {
  const loaderId = `${options.name}-v${options.buildVersion}`;
  const worker = options.env.LOADER.get(loaderId, () => ({
    mainModule: options.built.mainModule,
    modules: options.built.modules,
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"]
  }));
  const facetName = `app-${options.facetGen}`;
  if (options.facetVersion !== options.buildVersion) {
    try {
      options.facets.abort(facetName, new Error("rebuilding app"));
    } catch {
      /* no live facet */
    }
    options.setFacetVersion(options.buildVersion);
  }
  return options.facets.get<Fetcher>(facetName, () => ({
    class: worker.getDurableObjectClass("App"),
    id: facetName
  }));
}

export async function serveBuiltApp(options: {
  built: CreateAppResult;
  request: Request;
  app: Fetcher;
  overlay: string;
}): Promise<Response> {
  const assetRes = await handleAssetRequest(
    options.request,
    options.built.assetManifest,
    createMemoryStorage(options.built.assets ?? {}),
    options.built.assetConfig
  );
  if (assetRes) return assetRes;

  const resp = await options.app.fetch(options.request);
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) return resp;
  let html = await resp.text();
  html = html.includes("</body>")
    ? html.replace("</body>", options.overlay + "</body>")
    : html + options.overlay;
  return new Response(html, {
    status: resp.status,
    headers: { "content-type": "text/html;charset=utf-8" }
  });
}
