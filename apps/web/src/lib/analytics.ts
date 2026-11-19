/** Google Analytics 4 measurement ID from the environment, or null when GA is off. */
export function gaMeasurementId(): string | null {
  const id = (process.env.GA_MEASUREMENT_ID ?? "").trim();
  return /^G-[A-Z0-9]{4,20}$/i.test(id) ? id : null;
}

/** the privacy policy of a language */
export function privacyPath(locale: string): string {
  return locale === "nl" ? "/nl/privacy/" : "/privacy/";
}
