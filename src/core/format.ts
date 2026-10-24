/**
 * Display formatting for facts that may be verified, estimated or unknown.
 * Every formatter returns the certainty alongside the text, so the UI can
 * label estimates and admit unknowns instead of presenting guesses as fact.
 */
import { BUDGET_CAP } from './recommend.ts';
import type { BudgetLevel, Certainty, Duration, Price } from './types.ts';

export type FactCertainty = Certainty | 'unknown';

export interface FormattedFact {
  text: string;
  certainty: FactCertainty;
}

function money(amount: number, currency: string, locale?: string): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${whole ? amount : amount.toFixed(2)}`;
  }
}

export function formatPrice(price: Price | undefined, locale?: string): FormattedFact {
  if (!price) return { text: 'Price not listed', certainty: 'unknown' };
  if (price.minAmount === 0 && price.maxAmount === undefined) return { text: 'Free', certainty: price.certainty };
  const min = price.minAmount === 0 ? 'Free' : money(price.minAmount, price.currency, locale);
  const text = price.maxAmount !== undefined ? `${min}–${money(price.maxAmount, price.currency, locale)}` : min;
  return { text, certainty: price.certainty };
}

function hours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
}

export function formatDuration(duration: Duration | undefined): FormattedFact {
  if (!duration) return { text: 'Duration unknown', certainty: 'unknown' };
  const { minMinutes: min, maxMinutes: max } = duration;
  let text: string;
  if (max === undefined) text = min < 60 ? `${min} min` : `${hours(min)} hr`;
  else if (max <= 90) text = `${min}–${max} min`;
  else if (min < 60) text = `${min} min–${hours(max)} hr`;
  else text = `${hours(min)}–${hours(max)} hr`;
  return { text, certainty: duration.certainty };
}

export function budgetLabel(level: BudgetLevel, currency: string, locale?: string): string {
  if (level === 'free') return 'Free';
  if (level === 'any') return 'Any';
  return `Up to ${money(BUDGET_CAP[level], currency, locale)}`;
}

export function distanceOptionLabel(km: number | null): string {
  return km === null ? 'Any' : `${km} km`;
}

export function timeOptionLabel(minutes: number | null): string {
  if (minutes === null) return 'No limit';
  if (minutes >= 240) return 'Half day';
  return minutes < 60 ? `${minutes} min` : `${hours(minutes)} hr`;
}
