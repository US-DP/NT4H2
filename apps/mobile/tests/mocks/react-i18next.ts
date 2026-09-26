/**
 * Mock de react-i18next para los tests de UI.
 *
 * El renderer de tests invoca componentes como funciones (sin dispatcher
 * de React), así que los hooks reales fallan. Este mock devuelve un `t`
 * ligado a la instancia real de i18next (inicializada en ../lib/i18n),
 * por lo que los asserts sobre textos en español siguen funcionando.
 */

import i18n from '../../lib/i18n';

 
type TFn = (key: string, opts?: Record<string, unknown>) => string;

export const useTranslation = () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: ((key: string, opts?: Record<string, unknown>) => i18n.t(key as any, opts as any) as string) as TFn,
  i18n,
});

export const Trans = ({ children }: { children?: unknown }) => children ?? null;

export const initReactI18next = { type: '3rdParty', init: () => undefined };

export const I18nextProvider = ({ children }: { children?: unknown }) => children ?? null;

export const withTranslation = () => (c: unknown) => c;

export default { useTranslation };
