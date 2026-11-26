import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outputPath = join(root, "docs", "tenders.json");
const TENDER_OMAN = "https://www.tenderom.com";
const SOURCE = `${TENDER_OMAN}/Default.aspx`;
const ESNAD = "https://etendering.tenderboard.gov.om";
// منذ 29 أكتوبر 2026 يرجع Tender Oman أول 100 نتيجة فقط لكل طلب، وما بعدها يرجع فاضي،
// ويوقف الجهاز أكثر من 10 دقائق بعد قرابة 5 طلبات. لذلك نرسل طلباً واحداً لكل تصنيف (5 طلبات)،
// نطلب فيه المفتوحة فقط (الحالة 2) مرتبة من الأحدث نشراً، ونُبقي المفتوحة من السحب السابق
// للتصنيف الذي وصل للحد، لأن كل سحب يلتقط الجديد فقط.
const PAGE_SIZE = 100;
const OPEN_STATUS = "2";
const NEWEST_FIRST = "0";
const REQUEST_GAP_MS = 5000;
const CLASSIFICATIONS = [
  { id: "6", label: "إنشاءات عامة" },
  { id: "36", label: "طرق وجسور وأنفاق" },
  { id: "37", label: "مياه وصرف صحي" },
  { id: "38", label: "كهرباء وميكانيك" },
  { id: "35", label: "دراسات واستشارات" },
];

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

// أسماء ولايات هي كلمات عادية أيضاً (طاقة، صور، نخل...)، فلا تُحسب إلا بعد كلمة "ولاية".
const AMBIGUOUS_PLACES = new Set(["طاقة", "صور", "منح", "ادم", "نخل", "لوى", "دبا", "ينقل", "سدح", "دولي"].map(fold));
const UNKNOWN_GOVERNORATE = "غير محددة";

function titleWords(title) {
  return fold(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .flatMap((word) => {
      const forms = [word];
      for (const prefix of ["وبال", "بال", "وال", "لل", "ال", "وب", "ب", "و", "ل"]) {
        if (word.startsWith(prefix) && word.length - prefix.length >= 3) forms.push(word.slice(prefix.length));
      }
      return forms;
    });
}

// يرجع أول مكان مذكور في العنوان: { place, governorate }، والمكان ولاية إذا عُرفت.
export function placeFromTitle(title) {
  const text = fold(title);
  const places = Object.entries(CITY_GOVERNORATE).sort((a, b) => fold(b[0]).length - fold(a[0]).length);
  for (const [name, governorate] of places) {
    if (text.includes(fold(`ولاية ${name}`)) || text.includes(fold(`بولاية ${name}`))) return { place: name, governorate };
  }
  const named = [...GOVERNORATE_NAMES].sort((a, b) => fold(b).length - fold(a).length);
  for (const name of named) {
    if (text.includes(fold(name))) return { place: null, governorate: name };
  }
  const words = new Set(titleWords(title));
  for (const [name, governorate] of places) {
    const place = fold(name);
    if (place.length < 3 || AMBIGUOUS_PLACES.has(place)) continue;
    if (words.has(place)) return { place: name, governorate };
  }
  return null;
}

export function governorateFromTitle(title) {
  return placeFromTitle(title)?.governorate || null;
}

function governorateFor(city) {
  const key = norm(city);
  for (const [name, governorate] of Object.entries(CITY_GOVERNORATE)) {
    if (norm(name) === key) return governorate;
  }
  return UNKNOWN_GOVERNORATE;
}

// Tender Oman يكتب "مسقط" لمناقصات الوزارات أينما كان المشروع، فلا نثق بها وحدها.
function deriveGovernorate(title, city) {
  const fromTitle = governorateFromTitle(title);
  if (fromTitle) return fromTitle;
  if (!city || norm(city) === norm("مسقط")) return UNKNOWN_GOVERNORATE;
  return governorateFor(city);
}

function isClosed(status) {
  const text = norm(status);
  return ["ملغي", "مغلق", "cancel", "closed", "expired"].some((word) => text.includes(word));
}

function isUnrelated(title) {
  const text = norm(title);
  return BLOCKED_TITLES.some((phrase) => text.includes(norm(phrase)));
}

const PLATFORMS = [
  {
    label: "مطارات عُمان",
    url: "https://www.omanairports.co.om/ar/content/tenders",
    test: (text) => /مطارات\s*ع.?مان|oman airports/.test(text),
  },
  {
    label: "منصة توريد",
    url: "https://tawreed.oq.com/",
    test: (text) => /majis|hcwtf|riyada card|cetrp|\bswip\b|ccws|rm terminal/.test(text),
  },
  {
    label: "نماء لتوزيع الكهرباء",
    url: "https://distribution.nama.om/Tender",
    test: (text) => /\bnedc\b|substation/.test(text),
  },
  {
    label: "نماء لإنتاج الكهرباء",
    url: "https://negc.nama.om/ar/Home.aspx",
    test: (text) => text.includes("انتاج الكهرباء") || text.includes("إنتاج الكهرباء"),
  },
  {
    label: "جامعة الشرقية",
    url: "https://www.asu.edu.om/",
    test: (text) => text.includes("جامعة الشرقية"),
  },
  {
    label: "عُمان سات",
    url: "https://omansat.com/tenders/",
    test: (text) => text.includes("omansat"),
  },
];

function platformOf(title) {
  const text = String(title || "").toLowerCase();
  return PLATFORMS.find((item) => item.test(text)) || null;
}

function originLabel(row) {
  const company = String(row?.tpb_company_name || "").trim();
  if (company) return company;
  const title = `${row?.tnd_name || ""} ${row?.tnd_name_en || ""}`;
  return platformOf(title)?.label || "تندرز عُمان";
}

function assignPublisher(tender) {
  const company = String(tender.buyer || "").trim();
  if (company) {
    tender.url = "";
    tender.source = "buyer";
    tender.sourceLabel = company;
    tender.originLabel = company;
    return;
  }
  const platform = platformOf(tender.title);
  if (platform) {
    tender.url = platform.url;
    tender.source = "portal";
    tender.sourceLabel = platform.label;
    tender.originLabel = platform.label;
    return;
  }
  tender.url = `${TENDER_OMAN}/TenderDetails.aspx?tdc_id=${encodeURIComponent(tender.id)}`;
  tender.source = "tenderoman";
  tender.sourceLabel = "تندرز عُمان";
  tender.originLabel = "تندرز عُمان";
}

function mapRow(row, classification) {
  const price = Number(row.tnd_copy_price);
  const city = (row.are_name || "").trim();
  const title = (row.tnd_name || "").trim();
  return {
    id: String(row.tdc_id),
    number: row.tnd_number || "",
    title,
    category: row.cat_Name || classification,
    parentCategory: row.cat_ParentName || classification,
    classification,
    city,
    governorate: deriveGovernorate(title, city),
    status: row.tnd_sts || "",
    type: row.tender_ad_type || "",
    publishedOn: row.tnd_publish_date || "",
    deadline: row.tnd_buy_tender_date || "",
    publishedIso: parseDate(row.tnd_publish_date),
    deadlineIso: parseDate(row.tnd_buy_tender_date),
    documentPrice: Number.isFinite(price) && price > 0 && price < 999999 ? price : null,
    url: "",
    buyer: String(row.tpb_company_name || "").trim(),
    source: "unknown",
    sourceLabel: originLabel(row),
    originLabel: originLabel(row),
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function titleKey(value) {
  return fold(value)
    .replace(/\u0640/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function esnadUrl(tenderNo) {
  const mode = "public";
  const publicUrl = "1";
  const direction = "RTL";
  const randomno = "fixedrandomno";
  const hashval = createHash("sha256").update(`${mode}${tenderNo}${publicUrl}${direction}${randomno}`).digest("hex");
  return `${ESNAD}/product/nitParameterView?mode=${mode}&tenderNo=${tenderNo}&PublicUrl=${publicUrl}&CTRL_STRDIRECTION=${direction}&encparam=mode,tenderNo,PublicUrl,CTRL_STRDIRECTION,randomno&hashval=${hashval}`;
}

const STOP_TOKENS = new Set(
  "اعمال عمل انشاء صيانة توريد تركيب تصميم تنفيذ ولاية محافظة منطقة مدرسة بمدرسة و في من على الى عدد اخرى مرافق المطلوبة المرحلة الاولى الثانية الثالثة للتعليم الاساسي الصفوف مبنى تاهيل تطوير مشروع خدمات عقد قائمة الكميات بناء بولاية بمحافظة غرفة غرف تربوية الاعمال"
    .split(/\s+/)
    .map((word) => titleKey(word)),
);

function tokensOf(value) {
  return fold(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((token) => {
      if (token.startsWith("ال") && token.length > 5) return [token.slice(2)];
      if (/^[بوفلك]/.test(token) && token.length > 5) return [token.slice(1)];
      return [token];
    })
    .filter((token) => token.length >= 4 && !STOP_TOKENS.has(token) && !/^\d+$/.test(token));
}

function matchNotice(tender, notices) {
  const exact = notices.find((notice) => notice.key === titleKey(tender.title));
  if (exact) return { notice: exact, score: 2 };
  const wanted = [...new Set(tokensOf(tender.title))];
  if (wanted.length < 2) return null;
  const place = placeFromTitle(tender.title);
  let best = null;
  let bestScore = 0;
  let second = 0;
  for (const notice of notices) {
    if (placesConflict(place, notice.place)) continue;
    let shared = 0;
    for (const token of wanted) {
      if (notice.tokens.has(token) || notice.key.includes(token)) shared += 1;
    }
    const score = shared / wanted.length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = notice;
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || bestScore < 0.6 || bestScore - second < 0.15) return null;
  return { notice: best, score: bestScore };
}

function parseNotices(html) {
  const notices = [];
  for (const chunk of html.split(/<tr\b/i)) {
    const titleMatch = /name="tendDesc\d+"\s+value="([^"]*)"/i.exec(chunk);
    const nitMatch = /getNit\('(\d+)'\)/.exec(chunk);
    if (!titleMatch || !nitMatch) continue;
    const numberMatch = /showTndDesc\([^)]*\)\s*>\s*([^<]+)/.exec(chunk);
    notices.push({
      tenderNo: nitMatch[1],
      title: decodeHtml(titleMatch[1]).trim(),
      number: numberMatch ? decodeHtml(numberMatch[1]).replace(/\s+/g, " ").trim() : "",
    });
  }
  return notices;
}

function parseGrades(html) {
  const match = /<b>\s*الدرجة\s*:?\s*<\/b>[\s\S]{0,1200}?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!match) return [];
  const text = decodeHtml(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter((part) => part && part !== "-" && part !== "—");
}

function pageText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "|"),
  )
    .replace(/ /g, " ")
    .replace(/\s*\|[\s|]*/g, " | ")
    .replace(/[ \t\r\n]+/g, " ");
}

function field(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1].trim() : "";
}

export function parseNoticeDetails(html) {
  const text = pageText(html);
  const governorate = field(text, /المحافظة\s*:\s*\|\s*([^|]+)/).replace(/^محافظة\s+/, "").trim();
  const wilayat = field(text, /الولايات\s*:\s*\|\s*([^|]+)/)
    .split(/[,،]/)
    .map((part) => part.replace(/^ولاية\s+/, "").trim())
    .filter(Boolean);
  const fee = Number(field(text, /رسوم المناقص[ةه]\s*:\s*\|\s*([\d.,]+)/).replace(/,/g, ""));
  return {
    grades: parseGrades(html),
    governorate: GOVERNORATE_NAMES.find((name) => fold(name) === fold(governorate)) || "",
    wilayat,
    number: field(text, /رقم المناقصة\s*:\s*\|\s*([^|]+)/),
    entity: field(text, /الجهة الحكومية\s*:\s*([^|]+)/),
    fee: Number.isFinite(fee) && fee > 0 ? fee : null,
  };
}

// مكانان مذكوران في عنوانين مختلفين = مناقصتان مختلفتين.
// (حقل المحافظة في صفحة إسناد هو مقر الجهة المعلنة، لا مكان المشروع، فلا يصلح للمقارنة.)
function placesConflict(a, b) {
  if (!a || !b) return false;
  if (a.governorate !== b.governorate) return true;
  return Boolean(a.place && b.place && norm(a.place) !== norm(b.place));
}

async function attachGrades(tenders) {
  const targets = tenders.filter((tender) => tender.source === "esnad" && tender.url);
  let done = 0;
  await mapPool(targets, 4, async (tender) => {
    try {
      const details = parseNoticeDetails(await fetchText(tender.url));
      tender.grades = details.grades;
      // نكمل المحافظة المجهولة فقط: من محافظة الجهة في إسناد، إلا مسقط لأنها غالباً مقر الوزارة فقط.
      if (tender.governorate === UNKNOWN_GOVERNORATE && details.governorate && details.governorate !== "مسقط") {
        tender.governorate = details.governorate;
        if (details.wilayat.length === 1) tender.city = details.wilayat[0];
      }
      if (details.number) tender.number = details.number;
      if (details.entity) tender.entity = details.entity;
      if (details.fee != null) tender.documentPrice = details.fee;
    } catch (error) {
      tender.grades = [];
      console.log(`grade miss ${tender.id}: ${error.message}`);
    }
    done += 1;
    if (done % 20 === 0 || done === targets.length) console.log(`grades ${done}/${targets.length}`);
  });
  for (const tender of tenders) {
    if (!Array.isArray(tender.grades)) tender.grades = [];
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "MajanAI/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`إسناد رد بحالة ${response.status}`);
  return response.text();
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return out;
}

async function fetchBoard(viewFlag) {
  const pageUrl = (page) => `${ESNAD}/product/publicDash?viewFlag=${viewFlag}&pageNo=${page}`;
  const first = await fetchText(pageUrl(1));
  const max = Number((/name='hidMax'\s+value='(\d+)'/.exec(first) || [])[1] || 0);
  console.log(`${viewFlag} pages ${max || 1}`);
  const notices = parseNotices(first);
  if (max > 1) {
    const rest = await mapPool(
      Array.from({ length: max - 1 }, (_, index) => index + 2),
      4,
      async (page) => parseNotices(await fetchText(pageUrl(page))),
    );
    for (const rows of rest) notices.push(...rows);
  }
  return { viewFlag, pages: max || 1, notices };
}

function applyCatalog(tenders, raw) {
  const notices = raw.map((notice) => ({
    ...notice,
    key: titleKey(notice.title),
    tokens: new Set(tokensOf(notice.title)),
    place: placeFromTitle(notice.title),
  }));
  if (!notices.length) throw new Error("تعذر قراءة مناقصات إسناد");
  const byKey = new Map();
  for (const notice of notices) {
    if (notice.key && !byKey.has(notice.key)) byKey.set(notice.key, notice);
  }
  // كل إعلان يُربط بمناقصة واحدة فقط: الأقرب عنواناً. البقية تأخذ رابطها الأصلي.
  const owner = new Map();
  const picks = new Map();
  for (const tender of tenders) {
    const exact = byKey.get(titleKey(tender.title));
    const pick = exact ? { notice: exact, score: 2 } : matchNotice(tender, notices);
    if (!pick) continue;
    picks.set(tender, pick);
    const current = owner.get(pick.notice.tenderNo);
    if (!current || pick.score > picks.get(current).score) owner.set(pick.notice.tenderNo, tender);
  }
  let matched = 0;
  let shared = 0;
  for (const tender of tenders) {
    const pick = picks.get(tender);
    if (!pick || owner.get(pick.notice.tenderNo) !== tender) {
      if (pick) shared += 1;
      assignPublisher(tender);
      continue;
    }
    matched += 1;
    tender.url = esnadUrl(pick.notice.tenderNo);
    tender.source = "esnad";
    tender.sourceLabel = "إسناد";
    if (!tender.number && pick.notice.number) tender.number = pick.notice.number;
  }
  if (shared) console.log(`unlinked ${shared} tenders that pointed at an Esnad notice already used`);  return { matched, catalog: notices.length };
}

export async function attachSourceUrls(tenders) {
  const boards = [];
  for (const viewFlag of ["NewTenders", "InProcessTenders"]) {
    boards.push(await fetchBoard(viewFlag));
  }
  const raw = boards.flatMap((board) => board.notices);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(
    join(root, "data", "esnad-catalog.json"),
    JSON.stringify(raw.map((notice) => ({ tenderNo: notice.tenderNo, title: notice.title, number: notice.number }))),
    "utf8",
  );
  const stats = applyCatalog(tenders, raw);
  return {
    ...stats,
    boards: boards.map((board) => ({ viewFlag: board.viewFlag, pages: board.pages, notices: board.notices.length })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(categoryId) {
  const params = new URLSearchParams({
    id: "1",
    Country_Code: "om",
    catidvalue: categoryId,
    buyerid: "",
    cityid: "",
    tendertypeid: "",
    tenderstatusid: OPEN_STATUS,
    sortbyid: NEWEST_FIRST,
    tendernameid: "",
    IDFrom: "1",
    IDTo: String(PAGE_SIZE),
    User: "",
    startDate: "",
    endDate: "",
    ComeFrom: "1",
  });
  const response = await fetch(`${TENDER_OMAN}/api/HomePage/GetValue?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "MajanAI/1.0" },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (Array.isArray(data)) return data;
  // الإيقاف يطول أكثر من 10 دقائق، فإعادة المحاولة لا تفيد.
  if (response.status === 429 || /too many requests/i.test(String(data?.error || text))) {
    throw new Error("Tender Oman أوقف الطلبات مؤقتاً بسبب كثرتها");
  }
  if (!response.ok) throw new Error(`Tender Oman رد بحالة ${response.status}`);
  throw new Error("رد Tender Oman ليس قائمة مناقصات");
}

async function previousTenders() {
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8"));
    return Array.isArray(previous?.tenders) ? previous.tenders : [];
  } catch {
    return [];
  }
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
  const coverage = [];
  const capped = new Set();
  for (const [index, item] of CLASSIFICATIONS.entries()) {
    if (index > 0) await sleep(REQUEST_GAP_MS);
    const rows = await fetchPage(item.id);
    const categoryTotal = rows.length ? Number(rows[0].TenderCount) || rows.length : 0;
    for (const row of rows) {
      const id = String(row.tdc_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (isClosed(row.tnd_sts) || isUnrelated(row.tnd_name)) continue;
      collected.push(mapRow(row, item.label));
    }
    onProgress?.({ label: item.label, fetched: rows.length, totalAvailable: categoryTotal });
    coverage.push({ label: item.label, fetched: rows.length, available: categoryTotal });
    if (categoryTotal > rows.length) capped.add(item.label);
    totalAvailable += categoryTotal;
  }
  if (!collected.length) throw new Error("لم يرجع Tender Oman أي مناقصة مفتوحة");
  // التصنيف اللي وصل للحد: نُبقي مناقصاته المفتوحة من السحب السابق اللي ما رجعت هالمرة.
  let kept = 0;
  for (const old of await previousTenders()) {
    if (!capped.has(old.classification) || seen.has(String(old.id))) continue;
    if (!old.deadlineIso || old.deadlineIso < today) continue;
    seen.add(String(old.id));
    collected.push({ ...old, carried: true });
    kept += 1;
  }
  for (const item of coverage) {
    if (capped.has(item.label)) {
      console.log(`::notice::${item.label}: وصلنا ${item.fetched} من ${item.available}، وأبقينا المفتوحة من السحب السابق`);
    }
  }
  if (kept) console.log(`kept ${kept} open tenders from the previous sync`);
  const tenders = dedupeOpen(collected, today);
  await attachSourceUrls(tenders);
  await attachGrades(tenders);
  return {
    source: SOURCE,
    syncedAt: new Date().toISOString(),
    classification: "إنشاءات عامة",
    classifications: CLASSIFICATIONS.map((item) => item.label),
    categoryLabel: CLASSIFICATIONS.map((item) => item.label).join("، "),
    totalAvailable,
    fetched: seen.size,
    coverage,
    count: tenders.length,
    tenders,
  };
}

// يمنع استبدال القائمة بقائمة أقصر بكثير، حتى ما يختفي نص المناقصات بصمت إذا تغيّر الموقع مرة ثانية.
const MIN_KEEP_RATIO = 0.6;

async function guardAgainstDrop(payload) {
  let previous = null;
  try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return;
  }
  const before = Number(previous?.count) || 0;
  if (before >= 50 && payload.count < before * MIN_KEEP_RATIO) {
    throw new Error(`السحب رجع ${payload.count} مناقصة فقط بعد ما كانت ${before}. لم تُحفظ القائمة. تأكد من موقع Tender Oman.`);
  }
}

export async function writeTenders(payload, { force = false } = {}) {
  if (!force) await guardAgainstDrop(payload);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--grades")) {
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    await attachGrades(payload.tenders);
    await writeTenders(payload);
    const withGrades = payload.tenders.filter((tender) => tender.grades?.length).length;
    console.log(`grades on ${withGrades}/${payload.tenders.length}`);
  } else if (process.argv.includes("--sources") || process.argv.includes("--cached")) {
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    for (const tender of payload.tenders) tender.governorate = deriveGovernorate(tender.title, tender.city);
    const stats = process.argv.includes("--cached")
      ? applyCatalog(payload.tenders, JSON.parse(await readFile(join(root, "data", "esnad-catalog.json"), "utf8")))
      : await attachSourceUrls(payload.tenders);
    const missed = payload.tenders.filter((tender) => !tender.url).map((tender) => tender.title);
    await writeFile(join(root, "data", "_match.txt"), missed.join("\n"), "utf8");
    await attachGrades(payload.tenders);
    await writeTenders(payload);
    console.log(`matched ${stats.matched}/${payload.tenders.length} catalog ${stats.catalog}`);
    console.log(JSON.stringify(stats.boards));
  } else {
    const payload = await pullTenders((progress) => {
      console.log(`${progress.label || ""} ${progress.fetched}/${progress.totalAvailable || "?"}`);
    });
    await writeTenders(payload, { force: process.argv.includes("--force") });
    console.log(`saved ${payload.count} open tenders`);
    console.log(JSON.stringify(payload.coverage));
  }
}
