import fs from "node:fs/promises";
import path from "node:path";

const SITEMAP_URL = "https://www.zelfbouw-info.nl/sitemap.xml";
const CANONICAL_HOST = "www.zelfbouw-info.nl";
const OUTPUT_FILE = "zelfbouw_kavels_model.json";
const CONCURRENCY = 10;

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, ""));
}

function parsePriceText(value) {
  const cleaned = normalizeWhitespace(value).replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : null;
}

function mapAvailability(availabilityUrl) {
  const value = String(availabilityUrl ?? "").toLowerCase();
  if (value.endsWith("instock")) return "Beschikbaar";
  if (value.endsWith("outofstock")) return "Niet beschikbaar";
  if (value.endsWith("limitedavailability")) return "Beperkt beschikbaar";
  if (value.endsWith("preorder")) return "In optie";
  return null;
}

function canonicalizeCityUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  parsed.hostname = CANONICAL_HOST;
  if (parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function extractCityUrlsFromSitemap(xmlText) {
  const urls = [...xmlText.matchAll(/<loc>(.*?)<\/loc>/gi)].map((match) => decodeHtmlEntities(match[1]));
  const filtered = urls.filter((value) => {
    try {
      const parsed = new URL(value);
      const pathName = parsed.pathname.replace(/\/+$/, "");
      return /^\/kavels\/[^/]+$/i.test(pathName) && !/\/kennisbank\//i.test(pathName);
    } catch {
      return false;
    }
  });

  const deduped = new Map();
  for (const raw of filtered) {
    const canonical = canonicalizeCityUrl(raw);
    const parsed = new URL(canonical);
    const key = decodeURIComponent(parsed.pathname).toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, canonical);
    }
  }

  return [...deduped.values()].sort((a, b) => a.localeCompare(b, "nl"));
}

function findItemListScriptObject(html) {
  const scriptMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];

  for (const match of scriptMatches) {
    const raw = match[1];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    const graph = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
    const itemList = graph.find((node) => node && node["@type"] === "ItemList");
    if (itemList) {
      return itemList;
    }
  }

  return null;
}

function extractCityName(html, fallbackSlug) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    return normalizeWhitespace(stripTags(h1Match[1]));
  }

  return fallbackSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractProvince(html) {
  const headingMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/i);
  if (!headingMatch) return null;

  const prefix = html.slice(0, headingMatch.index);
  const upperTokens = [...prefix.matchAll(/>([A-ZÀ-Ý][A-ZÀ-Ý\- ]{2,})</g)]
    .map((m) => normalizeWhitespace(m[1]))
    .filter((token) => token.length >= 3 && token.length <= 30);

  const provinceCandidate = upperTokens.reverse().find((token) =>
    [
      "DRENTHE",
      "FLEVOLAND",
      "FRIESLAND",
      "GELDERLAND",
      "GRONINGEN",
      "LIMBURG",
      "NOORD-BRABANT",
      "NOORD-HOLLAND",
      "OVERIJSSEL",
      "UTRECHT",
      "ZEELAND",
      "ZUID-HOLLAND",
    ].includes(token),
  );

  return provinceCandidate ? provinceCandidate : null;
}

function extractCardContextByTitle(bodyHtml, title, startIndex) {
  const index = bodyHtml.indexOf(title, startIndex);
  if (index < 0) {
    return { index: startIndex, snippet: "" };
  }

  const snippet = bodyHtml.slice(index, index + 2600);
  return { index: index + title.length, snippet };
}

function extractCardDetailsFromSnippet(snippet) {
  const text = normalizeWhitespace(stripTags(snippet));

  const statusMatch = snippet.match(/<\/h3>\s*<span[^>]*>(?:\s*<span[^>]*><\/span>)?\s*([^<]{2,40})<\/span>/i);
  const addressMatch = snippet.match(/<div[^>]*text-\[13px\][^>]*>([\s\S]*?)<\/div>/i);
  const areaMatch = text.match(/([0-9][0-9\.,]*)\s*m²/i);
  const postedMatch = text.match(/Geplaatst:\s*([0-9]{1,2}-[0-9]{1,2}-[0-9]{4})/i);
  const priceTextMatch = text.match(/€\s*[0-9\.]+/i);

  const sourceTokenMatches = [...snippet.matchAll(/>([^<>]+)</g)]
    .map((m) => normalizeWhitespace(decodeHtmlEntities(m[1])));

  const filteredSourceTokens = sourceTokenMatches.filter((token) => {
    if (!token) return false;
    if (token === "·") return false;
    if (/^€\s*[0-9\.]+$/.test(token)) return false;
    if (/^Geplaatst:/i.test(token)) return false;
    if (/^\d+[\d\.,]*\s*m²$/i.test(token)) return false;
    return true;
  });

  const sourceCandidates = [...new Set(filteredSourceTokens.filter((token) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]{1,30}$/.test(token)))];

  return {
    status: statusMatch ? normalizeWhitespace(stripTags(statusMatch[1])) : null,
    address: addressMatch ? normalizeWhitespace(stripTags(addressMatch[1])) : null,
    area_m2_text: areaMatch ? `${areaMatch[1]} m²` : null,
    area_m2_value: areaMatch ? Number(areaMatch[1].replace(/[^0-9]/g, "")) : null,
    posted_date: postedMatch ? postedMatch[1] : null,
    price_text: priceTextMatch ? normalizeWhitespace(priceTextMatch[0]) : null,
    price_value: priceTextMatch ? parsePriceText(priceTextMatch[0]) : null,
    source_labels: sourceCandidates,
  };
}

function parseLotFromItemListElement(element, cityContext, snippetDetails) {
  const item = element?.item ?? {};
  const offers = item?.offers ?? {};
  const additionalProperties = Array.isArray(item?.additionalProperty) ? item.additionalProperty : [];
  const normalizedItemName = normalizeWhitespace(item?.name ?? "") || null;

  const areaProperty = additionalProperties.find((prop) =>
    normalizeWhitespace(prop?.name).toLowerCase().includes("oppervlakte"),
  );

  const schemaPrice = offers?.price != null ? Number(offers.price) : null;
  const schemaAvailability = mapAvailability(offers?.availability);
  const sellerName = normalizeWhitespace(offers?.seller?.name ?? "") || null;

  return {
    city_slug: cityContext.slug,
    city_name: cityContext.city_name,
    province: cityContext.province,
    title: normalizedItemName,
    status: snippetDetails.status ?? schemaAvailability,
    address: snippetDetails.address ?? normalizedItemName,
    area_m2: snippetDetails.area_m2_value ?? (areaProperty?.value != null ? Number(areaProperty.value) : null),
    area_text: snippetDetails.area_m2_text,
    posted_date: snippetDetails.posted_date,
    price_eur: snippetDetails.price_value ?? schemaPrice,
    price_text: snippetDetails.price_text,
    source: sellerName,
    source_labels: snippetDetails.source_labels,
    detail_url: item?.url ?? null,
    schema_availability: offers?.availability ?? null,
  };
}

async function fetchText(url) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; KavelsScraper/1.0; +https://www.zelfbouw-info.nl)",
          accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  throw new Error("Unreachable");
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let currentIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;
      if (index >= items.length) {
        return;
      }
      result[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return result;
}

async function scrapeCity(cityUrl) {
  const parsedUrl = new URL(cityUrl);
  const slug = decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean).pop() ?? "");
  const html = await fetchText(cityUrl);

  const bodyHtml = html.split("</head>")[1] ?? html;
  const itemList = findItemListScriptObject(html);
  const itemElements = Array.isArray(itemList?.itemListElement) ? itemList.itemListElement : [];

  const cityName = extractCityName(html, slug);
  const province = extractProvince(html);

  let cursor = 0;
  const lots = itemElements.map((element) => {
    const lotTitle = normalizeWhitespace(element?.item?.name ?? "");
    const cardContext = extractCardContextByTitle(bodyHtml, lotTitle, cursor);
    cursor = cardContext.index;

    const snippetDetails = extractCardDetailsFromSnippet(cardContext.snippet);

    return parseLotFromItemListElement(
      element,
      {
        slug,
        city_name: cityName,
        province,
      },
      snippetDetails,
    );
  });

  return {
    city_slug: slug,
    city_name: cityName,
    city_url: cityUrl,
    province,
    lot_count: lots.length,
    lots,
  };
}

async function main() {
  const startedAt = new Date();
  console.log("Sitemap ophalen...");
  const sitemapXml = await fetchText(SITEMAP_URL);

  const cityUrls = extractCityUrlsFromSitemap(sitemapXml);
  console.log(`Gevonden gemeentepagina's: ${cityUrls.length}`);

  let processed = 0;

  const cityResults = await mapLimit(cityUrls, CONCURRENCY, async (cityUrl) => {
    try {
      const cityResult = await scrapeCity(cityUrl);
      processed += 1;
      if (processed % 25 === 0 || processed === cityUrls.length) {
        console.log(`Voortgang: ${processed}/${cityUrls.length}`);
      }
      return cityResult;
    } catch (error) {
      processed += 1;
      console.error(`Fout bij ${cityUrl}: ${error.message}`);
      return {
        city_slug: decodeURIComponent(new URL(cityUrl).pathname.split("/").filter(Boolean).pop() ?? ""),
        city_name: null,
        city_url: cityUrl,
        province: null,
        lot_count: 0,
        lots: [],
        error: error.message,
      };
    }
  });

  const totalLots = cityResults.reduce((sum, city) => sum + city.lots.length, 0);
  const citiesWithLots = cityResults.filter((city) => city.lots.length > 0).length;

  const flatLots = cityResults.flatMap((city) =>
    city.lots.map((lot, lotIndex) => ({
      id: `${city.city_slug || "unknown"}-${lotIndex + 1}`,
      ...lot,
      city_url: city.city_url,
    })),
  );

  const outputModel = {
    model_version: "1.0",
    source: {
      website: "https://www.zelfbouw-info.nl",
      sitemap: SITEMAP_URL,
    },
    scraped_at: new Date().toISOString(),
    duration_seconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    summary: {
      cities_total: cityResults.length,
      cities_with_lots: citiesWithLots,
      lots_total: totalLots,
    },
    cities: cityResults,
    lots: flatLots,
  };

  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await fs.writeFile(outputPath, JSON.stringify(outputModel, null, 2), "utf8");

  console.log(`Klaar. JSON geschreven naar: ${outputPath}`);
  console.log(`Samenvatting: ${cityResults.length} steden, ${totalLots} kavels.`);
}

main().catch((error) => {
  console.error("Scraper mislukt:", error);
  process.exitCode = 1;
});
