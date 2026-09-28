import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outputPath = join(root, "public", "tenders.json");
const SOURCE = "https://www.tenderoman.com/Default.aspx";
const PAGE_SIZE = 100;
const CATEGORY_ID = "6";

const CITY_GOVERNORATE = {
  مسقط: "مسقط",
  مطرح: "مسقط",
  السيب: "مسقط",
  بوشر: "مسقط",
  العامرات: "مسقط",
  قريات: "مسقط",
  صلالة: "ظفار",
  ظفار: "ظفار",
  طاقة: "ظفار",
  سدح: "ظفار",
  رخيوت: "ظفار",
  ضلكوت: "ظفار",
  ثمريت: "ظفار",
  مقشن: "ظفار",
  خصب: "مسندم",
  دبا: "مسندم",
  دباء: "مسندم",
  بخاء: "مسندم",
  مدحاء: "مسندم",
  البريمي: "البريمي",
  محضة: "البريمي",
  السنينة: "البريمي",
  نزوى: "الداخلية",
  نزوي: "الداخلية",
  بهلاء: "الداخلية",
  منح: "الداخلية",
  ادم: "الداخلية",
  الحمراء: "الداخلية",
  ازكي: "الداخلية",
  سمائل: "الداخلية",
  بدبد: "الداخلية",
  عبري: "الظاهرة",
  ينقل: "الظاهرة",
  ضنك: "الظاهرة",
  صحار: "شمال الباطنة",
  شناص: "شمال الباطنة",
  لوى: "شمال الباطنة",
  صحم: "شمال الباطنة",
  الخابورة: "شمال الباطنة",
  السويق: "شمال الباطنة",
  الرستاق: "جنوب الباطنة",
  العوابي: "جنوب الباطنة",
  نخل: "جنوب الباطنة",
  بركاء: "جنوب الباطنة",
  المصنعة: "جنوب الباطنة",
  صور: "جنوب الشرقية",
  مصيرة: "جنوب الشرقية",
  ابراء: "شمال الشرقية",
  المضيبي: "شمال الشرقية",
  بديه: "شمال الشرقية",
  القابل: "شمال الشرقية",
  هيما: "الوسطى",
  هيماء: "الوسطى",
  الدقم: "الوسطى",
  محوت: "الوسطى",
  الجازر: "الوسطى",
  دولي: "خارج عُمان",
};

const BLOCKED_TITLES = ["oil spill", "نفط", "غاز", "weather and tide", "وسائط بحرية"];

export function norm(value) {
  return String(value || "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function muscatToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

const GOVERNORATE_NAMES = ["شمال الباطنة", "جنوب الباطنة", "جنوب الشرقية", "شمال الشرقية", "مسقط", "ظفار", "مسندم", "البريمي", "الداخلية", "الظاهرة", "الوسطى"];

function fold(value) {
  return String(value || "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

export function governorateFromTitle(title) {
  const text = fold(title);
  const named = [...GOVERNORATE_NAMES].sort((a, b) => fold(b).length - fold(a).length);
  for (const name of named) {
    if (text.includes(fold(name))) return name;
  }
  const places = Object.entries(CITY_GOVERNORATE).sort((a, b) => fold(b[0]).length - fold(a[0]).length);
  for (const [name, governorate] of places) {
    const place = fold(name);
    if (place.length < 3) continue;
    if (text.includes(fold(`ولاية ${name}`)) || text.includes(fold(`بولاية ${name}`))) return governorate;
  }
  for (const [name, governorate] of places) {
    const place = fold(name);
    if (place.length < 5) continue;
    if (text.includes(place)) return governorate;
  }
  return null;
}

function governorateFor(city) {
  const key = norm(city);
  for (const [name, governorate] of Object.entries(CITY_GOVERNORATE)) {
    if (norm(name) === key) return governorate;
  }
  return city ? "غير محددة" : "غير محددة";
}

function isClosed(status) {
  const text = norm(status);
  return ["ملغي", "مغلق", "cancel", "closed", "expired"].some((word) => text.includes(word));
}

function isUnrelated(title) {
  const text = norm(title);
  return BLOCKED_TITLES.some((phrase) => text.includes(norm(phrase)));
}

function mapRow(row) {
  const price = Number(row.tnd_copy_price);
  const city = (row.are_name || "").trim();
  const title = (row.tnd_name || "").trim();
  return {
    id: String(row.tdc_id),
    number: row.tnd_number || "",
    title,
    category: row.cat_Name || "إنشاءات الأبنية",
    parentCategory: row.cat_ParentName || "إنشاءات الأبنية",
    classification: "إنشاءات عامة",
    city,
    governorate: governorateFromTitle(title) || governorateFor(city),
    status: row.tnd_sts || "",
    type: row.tender_ad_type || "",
    publishedOn: row.tnd_publish_date || "",
    deadline: row.tnd_buy_tender_date || "",
    publishedIso: parseDate(row.tnd_publish_date),
    deadlineIso: parseDate(row.tnd_buy_tender_date),
    documentPrice: Number.isFinite(price) && price > 0 && price < 999999 ? price : null,
    url: `https://www.tenderoman.com/TenderDetails.aspx?tdc_id=${encodeURIComponent(row.tdc_id)}`,
  };
}

async function fetchPage(from, to) {
  const params = new URLSearchParams({
    id: "1",
    Country_Code: "om",
    catidvalue: CATEGORY_ID,
    buyerid: "",
    cityid: "",
    tendertypeid: "",
    tenderstatusid: "1",
    sortbyid: "0",
    tendernameid: "",
    IDFrom: String(from),
    IDTo: String(to),
    User: "",
    startDate: "",
    endDate: "",
    ComeFrom: "1",
  });
  const response = await fetch(`https://www.tenderoman.com/api/HomePage/GetValue?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "MajanAI/1.0" },
  });
  if (!response.ok) throw new Error(`Tender Oman رد بحالة ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("رد Tender Oman ليس قائمة مناقصات");
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeOpen(tenders, today) {
  const byKey = new Map();
  for (const tender of tenders) {
    if (!tender.deadlineIso || tender.deadlineIso < today) continue;
    if (tender.governorate === "خارج عُمان") continue;
    const key = `${norm(tender.title)}|${norm(tender.city)}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, tender);
      continue;
    }
    const currentScore = `${current.deadlineIso}|${current.number ? "1" : "0"}`;
    const nextScore = `${tender.deadlineIso}|${tender.number ? "1" : "0"}`;
    if (nextScore > currentScore) byKey.set(key, tender);
  }
  return [...byKey.values()].sort((a, b) => a.deadlineIso.localeCompare(b.deadlineIso) || a.title.localeCompare(b.title, "ar"));
}

export async function pullTenders(onProgress) {
  const today = muscatToday();
  const seen = new Set();
  const collected = [];
  let totalAvailable = 0;
  for (let from = 1; from < 20000; from += PAGE_SIZE) {
    const rows = await fetchPage(from, from + PAGE_SIZE - 1);
    if (!rows.length) break;
    totalAvailable = Number(rows[0].TenderCount) || totalAvailable;
    let fresh = 0;
    for (const row of rows) {
      const id = String(row.tdc_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh += 1;
      if (isClosed(row.tnd_sts) || isUnrelated(row.tnd_name)) continue;
      const parent = norm(row.cat_ParentName);
      if (parent && !parent.includes(norm("انشاءات الابنية"))) continue;
      collected.push(mapRow(row));
    }
    onProgress?.({ fetched: seen.size, totalAvailable });
    if (fresh === 0 || rows.length < PAGE_SIZE) break;
    if (totalAvailable && seen.size >= totalAvailable) break;
    await sleep(200);
  }
  const tenders = dedupeOpen(collected, today);
  return {
    source: SOURCE,
    syncedAt: new Date().toISOString(),
    classification: "إنشاءات عامة",
    categoryLabel: "إنشاءات الأبنية",
    totalAvailable,
    fetched: seen.size,
    count: tenders.length,
    tenders,
  };
}

export async function writeTenders(payload) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const payload = await pullTenders((progress) => {
    console.log(`fetched ${progress.fetched}/${progress.totalAvailable || "?"}`);
  });
  await writeTenders(payload);
  console.log(`saved ${payload.count} open tenders`);
}
