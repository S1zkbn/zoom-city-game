import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const ZIP_URL = "https://download.geonames.org/export/dump/cities15000.zip";
const DATA_DIR = "data";
const ZIP_PATH = path.join(DATA_DIR, "cities15000.zip");
const OUTPUT_PATH = "cities.json";

async function download(url, outputPath) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, buffer);
}

function cleanAlias(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCountryName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function getDifficulty(population, featureCode) {
  if (featureCode === "PPLC" || population >= 1_000_000) {
    return "easy";
  }

  if (population >= 100_000) {
    return "medium";
  }

  return "hard";
}

await mkdir(DATA_DIR, { recursive: true });

if (!existsSync(ZIP_PATH)) {
  console.log("Downloading GeoNames cities15000.zip...");
  await download(ZIP_URL, ZIP_PATH);
}

console.log("Reading zip...");

const zip = new AdmZip(ZIP_PATH);
const entry = zip.getEntries().find((e) => e.entryName.endsWith(".txt"));

if (!entry) {
  throw new Error("No txt file found inside zip.");
}

const text = entry.getData().toString("utf8");
const rows = text.trim().split("\n");

const cities = rows
  .map((line) => {
    const col = line.split("\t");

    const geonameId = Number(col[0]);
    const name = col[1];
    const asciiName = col[2];
    const alternateNames = col[3] || "";
    const lat = Number(col[4]);
    const lng = Number(col[5]);
    const featureClass = col[6];
    const featureCode = col[7];
    const countryCode = col[8];
    const population = Number(col[14] || 0);
    const timezone = col[17];

    if (featureClass !== "P") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!name || !countryCode) return null;

    const aliases = new Set();

    aliases.add(name);
    aliases.add(asciiName);

    for (const alias of alternateNames.split(",")) {
      const a = alias.trim();

      if (a.length >= 2 && a.length <= 60) {
        aliases.add(a);
      }
    }

    const cleanedAliases = [...aliases]
      .map(cleanAlias)
      .filter(Boolean);

    return {
      id: geonameId,
      name,
      asciiName,
      countryCode,
      countryName: getCountryName(countryCode),
      lat,
      lng,
      population,
      timezone,
      featureCode,
      difficulty: getDifficulty(population, featureCode),
      aliases: [...new Set(cleanedAliases)]
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.population - a.population);

await writeFile(OUTPUT_PATH, JSON.stringify(cities));

console.log(`Done. Created ${OUTPUT_PATH}`);
console.log(`Cities: ${cities.length.toLocaleString()}`);