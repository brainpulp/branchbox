import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Reverse-image discovery proxy. Two jobs the browser can't do itself:
//  1) POST { imageUrl }  → call SerpAPI Google Lens, return visual matches
//                          (hides the API key; SerpAPI has no browser CORS).
//  2) GET  ?img=<url>    → stream an image back with CORS headers so an
//                          accepted match can be fetched + imported.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  // --- image proxy (CORS-safe download of an accepted match) ---
  if (req.method === "GET") {
    const target = new URL(req.url).searchParams.get("img")
    if (!target) return json({ error: "img query param required" }, 400)
    const r = await fetch(target)
    if (!r.ok) return new Response("upstream fetch failed", { status: 502, headers: CORS })
    const headers = new Headers(CORS)
    headers.set("Content-Type", r.headers.get("Content-Type") ?? "image/jpeg")
    return new Response(r.body, { status: 200, headers })
  }

  // --- visual search ---
  try {
    const { imageUrl } = await req.json()
    if (!imageUrl) return json({ error: "imageUrl required" }, 400)
    const key = Deno.env.get("SERPAPI_KEY")
    if (!key) return json({ error: "SERPAPI_KEY not configured" }, 500)

    const u = new URL("https://serpapi.com/search.json")
    u.searchParams.set("engine", "google_lens")
    u.searchParams.set("url", imageUrl)
    u.searchParams.set("api_key", key)

    const r = await fetch(u)
    const data = await r.json()
    if (!r.ok || data.error) return json({ error: data.error ?? `serpapi ${r.status}` }, 502)

    const matches = (data.visual_matches ?? [])
      .map((m: Record<string, unknown>, i: number) => ({
        id: `lens-${m.position ?? i}`,
        url: (m.image as string) ?? (m.thumbnail as string),
        thumbUrl: m.thumbnail as string,
        title: (m.title as string) ?? "",
        source: (m.source as string) ?? "",
        link: (m.link as string) ?? "",
      }))
      .filter((m: { thumbUrl?: string }) => m.thumbUrl)

    return json({ matches })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
