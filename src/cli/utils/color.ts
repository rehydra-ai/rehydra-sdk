import { PIIType } from "../../types/index.js";

let _noColor: boolean | undefined;

export function setNoColor(value: boolean): void {
  _noColor = value;
}

function shouldColorize(): boolean {
  if (_noColor === true) return false;
  if (process.env["NO_COLOR"] !== undefined) return false;
  return process.stderr.isTTY === true;
}

function wrap(code: string, reset: string): (text: string) => string {
  return (text: string) => (shouldColorize() ? `${code}${text}${reset}` : text);
}

export const red = wrap("\x1b[31m", "\x1b[39m");
export const green = wrap("\x1b[32m", "\x1b[39m");
export const yellow = wrap("\x1b[33m", "\x1b[39m");
export const blue = wrap("\x1b[34m", "\x1b[39m");
export const magenta = wrap("\x1b[35m", "\x1b[39m");
export const cyan = wrap("\x1b[36m", "\x1b[39m");
export const dim = wrap("\x1b[2m", "\x1b[22m");
export const bold = wrap("\x1b[1m", "\x1b[22m");

const TYPE_COLORS: Record<string, (text: string) => string> = {
  [PIIType.PERSON]: magenta,
  [PIIType.ORG]: blue,
  [PIIType.LOCATION]: green,
  [PIIType.ADDRESS]: green,
  [PIIType.POSTAL_CODE]: green,
  [PIIType.EMAIL]: cyan,
  [PIIType.PHONE]: cyan,
  [PIIType.URL]: cyan,
  [PIIType.IP_ADDRESS]: cyan,
  [PIIType.IBAN]: yellow,
  [PIIType.BIC_SWIFT]: yellow,
  [PIIType.ACCOUNT_NUMBER]: yellow,
  [PIIType.CREDIT_CARD]: yellow,
  [PIIType.TAX_ID]: red,
  [PIIType.NATIONAL_ID]: red,
  [PIIType.DATE_OF_BIRTH]: red,
  [PIIType.CASE_ID]: dim,
  [PIIType.CUSTOMER_ID]: dim,
};

export function piiTypeColor(type: PIIType): (text: string) => string {
  return TYPE_COLORS[type] ?? dim;
}
