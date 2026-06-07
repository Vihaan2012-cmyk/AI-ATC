// Multi-language ATC scaffold. A SMALL set of canned controller phrases routed through a language
// layer. English is fully populated; other languages fall back to English until translated.
// Deterministic. Most ATC worldwide is English — this is for flavor / future expansion.

export type Language = 'en' | 'es' | 'fr' | 'de';

type PhraseKey = 'roger' | 'standby' | 'sayAgain' | 'goodDay' | 'unable' | 'wilco';

const PHRASES: Record<Language, Partial<Record<PhraseKey, string>>> = {
  en: {
    roger: 'roger',
    standby: 'standby',
    sayAgain: 'say again',
    goodDay: 'good day',
    unable: 'unable',
    wilco: 'wilco',
  },
  es: {
    roger: 'recibido',
    standby: 'espere',
    sayAgain: 'repita',
    goodDay: 'buen día',
  },
  fr: {
    roger: 'bien reçu',
    standby: 'attendez',
    sayAgain: 'répétez',
    goodDay: 'bonne journée',
  },
  de: {
    roger: 'verstanden',
    standby: 'warten',
    sayAgain: 'wiederholen',
    goodDay: 'schönen Tag',
  },
};

/** Translate a canned phrase, falling back to English when a language lacks it. */
export function phrase(key: PhraseKey, lang: Language = 'en'): string {
  return PHRASES[lang]?.[key] ?? PHRASES.en[key] ?? key;
}

/** True if the language code is one we know (else callers should use 'en'). */
export function isLanguage(v: string): v is Language {
  return v === 'en' || v === 'es' || v === 'fr' || v === 'de';
}
