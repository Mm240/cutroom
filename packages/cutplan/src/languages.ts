/**
 * Languages the transcriber is asked to listen for.
 *
 * Speech-to-text does not detect the language on its own — it transcribes
 * whatever it hears as the language it was told, so Hindi audio sent as
 * en-US comes back as confident nonsense. The person uploading knows; ask.
 *
 * `font` is the caption face burned into the clip. Arial has no glyphs for
 * most non-Latin scripts, and Cloudinary's subtitle layer accepts only some
 * Google fonts — an unsupported one fails the whole clip with a 400, not
 * just the captions. Every font here was probed against the subtitle layer.
 * Korean and Chinese had no supported font, so those clips ship uncaptioned
 * rather than broken.
 */
export interface Language {
  code: string;
  label: string;
  native: string;
  /** Caption font, or null where Cloudinary has none for the script. */
  font: string | null;
}

const LATIN = 'Noto Sans';

export const LANGUAGES: Language[] = [
  { code: 'en-US', label: 'English (US)', native: 'English', font: LATIN },
  { code: 'en-IN', label: 'English (India)', native: 'English', font: LATIN },
  { code: 'en-GB', label: 'English (UK)', native: 'English', font: LATIN },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी', font: 'Hind' },
  { code: 'mr-IN', label: 'Marathi', native: 'मराठी', font: 'Hind' },
  { code: 'bn-IN', label: 'Bengali', native: 'বাংলা', font: 'Hind Siliguri' },
  { code: 'ta-IN', label: 'Tamil', native: 'தமிழ்', font: 'Hind Madurai' },
  { code: 'te-IN', label: 'Telugu', native: 'తెలుగు', font: 'Hind Guntur' },
  { code: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી', font: 'Hind Vadodara' },
  { code: 'kn-IN', label: 'Kannada', native: 'ಕನ್ನಡ', font: 'Baloo Tamma' },
  { code: 'ml-IN', label: 'Malayalam', native: 'മലയാളം', font: 'Baloo Chettan' },
  { code: 'pa-Guru-IN', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', font: 'Mukta Mahee' },
  { code: 'ur-IN', label: 'Urdu', native: 'اردو', font: 'Cairo' },
  { code: 'es-ES', label: 'Spanish (Spain)', native: 'Español', font: LATIN },
  { code: 'es-US', label: 'Spanish (Latin America)', native: 'Español', font: LATIN },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português', font: LATIN },
  { code: 'fr-FR', label: 'French', native: 'Français', font: LATIN },
  { code: 'de-DE', label: 'German', native: 'Deutsch', font: LATIN },
  { code: 'it-IT', label: 'Italian', native: 'Italiano', font: LATIN },
  { code: 'nl-NL', label: 'Dutch', native: 'Nederlands', font: LATIN },
  { code: 'tr-TR', label: 'Turkish', native: 'Türkçe', font: LATIN },
  { code: 'pl-PL', label: 'Polish', native: 'Polski', font: LATIN },
  { code: 'ru-RU', label: 'Russian', native: 'Русский', font: LATIN },
  { code: 'uk-UA', label: 'Ukrainian', native: 'Українська', font: LATIN },
  { code: 'ar-SA', label: 'Arabic', native: 'العربية', font: 'Cairo' },
  { code: 'id-ID', label: 'Indonesian', native: 'Bahasa Indonesia', font: LATIN },
  { code: 'vi-VN', label: 'Vietnamese', native: 'Tiếng Việt', font: LATIN },
  { code: 'th-TH', label: 'Thai', native: 'ไทย', font: 'Sarabun' },
  { code: 'ja-JP', label: 'Japanese', native: '日本語', font: 'Sawarabi Gothic' },
  { code: 'ko-KR', label: 'Korean', native: '한국어', font: null },
  { code: 'cmn-Hans-CN', label: 'Chinese (Mandarin)', native: '中文', font: null },
];

export const DEFAULT_LANGUAGE = 'en-US';

export function languageFor(code?: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
