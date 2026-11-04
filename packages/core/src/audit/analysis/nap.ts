import type { NapDetails } from '@qa/types';
import type { RawJsonLd, RawPage } from './raw-page.js';

/**
 * NAP (business name, address, phone) a page shows (REQ-015 AC-4, Q-27), read from LocalBusiness JSON-LD and
 * <address> elements; a tel: link fills the phone of an address element that has none. Fixed rules, no AI,
 * no request. Pure and deterministic: the page facts are only read.
 */

/** LocalBusiness and the schema.org sub-types sites use most, for "LocalBusiness schema". */
export const LOCAL_BUSINESS_TYPES: ReadonlySet<string> = new Set([
  'LocalBusiness',
  'AnimalShelter',
  'AutomotiveBusiness',
  'AutoRepair',
  'AutoDealer',
  'ChildCare',
  'Dentist',
  'DryCleaningOrLaundry',
  'EmergencyService',
  'EmploymentAgency',
  'EntertainmentBusiness',
  'FinancialService',
  'FoodEstablishment',
  'Bakery',
  'BarOrPub',
  'CafeOrCoffeeShop',
  'FastFoodRestaurant',
  'IceCreamShop',
  'Restaurant',
  'GovernmentOffice',
  'HealthAndBeautyBusiness',
  'BeautySalon',
  'DaySpa',
  'HairSalon',
  'HealthClub',
  'HomeAndConstructionBusiness',
  'Electrician',
  'GeneralContractor',
  'HVACBusiness',
  'Plumber',
  'RoofingContractor',
  'InternetCafe',
  'LegalService',
  'Attorney',
  'Notary',
  'Library',
  'LodgingBusiness',
  'Hotel',
  'Motel',
  'MedicalBusiness',
  'MedicalClinic',
  'Optician',
  'Pharmacy',
  'Physician',
  'ProfessionalService',
  'RealEstateAgent',
  'SelfStorage',
  'ShoppingCenter',
  'SportsActivityLocation',
  'Store',
  'ClothingStore',
  'ElectronicsStore',
  'FurnitureStore',
  'GroceryStore',
  'HardwareStore',
  'JewelryStore',
  'MobilePhoneStore',
  'TravelAgency',
]);

/** Longest name, address or phone kept. */
export const NAP_VALUE_CAP = 200;
/** Most NAP entries kept per page. */
export const NAP_PER_PAGE_CAP = 5;

/** A phone number as written: digits with spaces, dots, dashes or brackets, optionally starting with +. */
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LABEL = /^(?:phone|tel(?:ephone)?|mobile|call(?: us)?|ph)\.?\s*:?\s*/i;
const LABELLED_PHONE = /\b(?:phone|tel(?:ephone)?|mobile|ph)\.?\s*:?\s*(\+?\(?\d[\d\s().-]{5,}\d)/i;

/** True when the JSON-LD type names LocalBusiness or one of its common sub-types (with or without a schema.org prefix). */
export function isLocalBusinessType(type: string): boolean {
  return LOCAL_BUSINESS_TYPES.has(type.replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, ''));
}

/** Every NAP the page shows, LocalBusiness JSON-LD first, then <address> elements; duplicates dropped. */
export function napFromPage(raw: RawPage, urlPath: string): NapDetails[] {
  const telPhone = firstTelPhone(raw);
  const found: NapDetails[] = [];
  for (const block of raw.jsonLd ?? []) found.push(...napFromJsonLd(block, urlPath));
  for (const text of raw.addresses ?? []) {
    const nap = napFromAddressText(text, urlPath, telPhone);
    if (nap) found.push(nap);
  }
  const seen = new Set<string>();
  const unique: NapDetails[] = [];
  for (const nap of found) {
    const key = JSON.stringify([nap.name ?? '', nap.address ?? '', nap.phone ?? '']);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(nap);
    if (unique.length >= NAP_PER_PAGE_CAP) break;
  }
  return unique;
}

/** NAP from a JSON-LD block's LocalBusiness objects (any depth, @graph included). [] when the block does not parse. */
export function napFromJsonLd(block: RawJsonLd, urlPath: string): NapDetails[] {
  if (!(block.types ?? []).some(isLocalBusinessType)) return [];
  let data: unknown;
  try {
    data = JSON.parse(block.raw);
  } catch {
    return [];
  }
  const out: NapDetails[] = [];
  walk(data, 0, (node) => {
    if (!typesOf(node).some(isLocalBusinessType)) return;
    const nap: NapDetails = { urlPath };
    const name = textValue(node.name);
    const address = addressValue(node.address);
    const phone = textValue(node.telephone);
    if (name) nap.name = name;
    if (address) nap.address = address;
    if (phone) nap.phone = phone;
    if (nap.address || nap.phone) out.push(nap);
  });
  return out;
}

/**
 * NAP from an <address> element's text. The phone is the first phone number in it (else the page's first
 * tel: link). With two or more other lines, the first is the name and the rest the address. Null when the
 * text has neither an address nor a phone.
 */
export function napFromAddressText(text: string, urlPath: string, telPhone?: string): NapDetails | null {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  let phone: string | undefined;
  const rest: string[] = [];
  for (const line of lines) {
    const withoutLabel = line.replace(PHONE_LABEL, '');
    const match = PHONE.exec(withoutLabel);
    // A line that is only a phone number (with its label) is the phone, not part of the address.
    if (match && withoutLabel.replace(match[0], '').replace(/[\s,;|]/g, '') === '') {
      phone ??= match[0].trim();
      continue;
    }
    if (EMAIL.test(line) && line.replace(EMAIL, '').replace(/^(?:e-?mail)\s*:?\s*/i, '').trim() === '') continue;
    rest.push(line);
  }
  if (!phone) {
    // A labelled phone number inside an address line ("12 Market St, Chennai. Ph: 044 1234 5678").
    for (const line of rest) {
      const match = LABELLED_PHONE.exec(line);
      if (match) {
        phone = match[1]!.trim();
        break;
      }
    }
  }
  phone ??= telPhone;
  const nap: NapDetails = { urlPath };
  if (rest.length >= 2) {
    nap.name = cap(rest[0]!);
    nap.address = cap(rest.slice(1).join(', '));
  } else if (rest.length === 1) {
    nap.address = cap(rest[0]!);
  }
  if (phone) nap.phone = cap(phone);
  return nap.address || nap.phone ? nap : null;
}

/** The number of the page's first tel: link, as written (percent-decoded), or undefined. */
export function firstTelPhone(raw: Pick<RawPage, 'contactLinks' | 'anchors'>): string | undefined {
  const hrefs = [
    ...(raw.contactLinks ?? []).filter((link) => link.kind === 'tel').map((link) => link.href),
    ...(raw.anchors ?? []).map((a) => a.href),
  ];
  for (const href of hrefs) {
    const match = /^\s*tel:(.*)$/i.exec(href ?? '');
    if (!match) continue;
    let number = match[1]!.split(/[?;]/)[0]!;
    try {
      number = decodeURIComponent(number);
    } catch {
      // Keep it as written.
    }
    number = number.replace(/\s+/g, ' ').trim();
    if (/\d/.test(number)) return cap(number);
  }
  return undefined;
}

type JsonObject = Record<string, unknown>;

const MAX_DEPTH = 20;

function walk(value: unknown, depth: number, visit: (node: JsonObject) => void): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, visit);
    return;
  }
  const node = value as JsonObject;
  visit(node);
  for (const child of Object.values(node)) walk(child, depth + 1, visit);
}

function typesOf(node: JsonObject): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  return [];
}

function textValue(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? cap(text) : undefined;
}

const ADDRESS_PARTS = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'] as const;

function addressValue(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'string') return textValue(value);
  if (value === null || typeof value !== 'object') return undefined;
  const node = value as JsonObject;
  const parts: string[] = [];
  for (const key of ADDRESS_PARTS) {
    let part = node[key];
    if (part !== null && typeof part === 'object' && !Array.isArray(part)) part = (part as JsonObject).name;
    const text = textValue(part);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? cap(parts.join(', ')) : undefined;
}

function cap(text: string): string {
  if (text.length <= NAP_VALUE_CAP) return text;
  // Never split a surrogate pair.
  let end = NAP_VALUE_CAP;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}
