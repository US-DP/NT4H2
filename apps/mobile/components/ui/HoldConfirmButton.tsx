/**
 * HoldConfirmButton — NtButton para acciones irreversibles.
 *
 * Con el ajuste `holdToConfirm` activo el tap no hace nada: la acción se
 * ejecuta solo tras mantener pulsado (~600 ms). Con el ajuste desactivado
 * se comporta como un NtButton normal.
 */

import { useTranslation } from 'react-i18next';
import { useSettingsSafe } from '../../lib/useTheme';
import { NtButton, type NtButtonProps } from './NtButton';

export function HoldConfirmButton({ label, onPress, accessibilityHint, ...rest }: NtButtonProps) {
  const { t } = useTranslation();
  const hold = useSettingsSafe((s) => s.holdToConfirm);
  return (
    <NtButton
      {...rest}
      label={label}
      onPress={hold ? undefined : onPress}
      onLongPress={hold ? onPress : undefined}
      delayLongPress={600}
      accessibilityHint={hold ? t('profile.holdToConfirmHint') : accessibilityHint}
    />
  );
}
