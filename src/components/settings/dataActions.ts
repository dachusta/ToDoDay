import { format, parseISO } from 'date-fns'
import { useI18n } from 'vue-i18n'
import { formatClock } from 'src/services/dates'
import { downloadBlob, exportFileName, pickJsonFile } from 'src/services/dataTransfer'
import { useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'
import type { TimeFormat } from 'src/models/enums'

/**
 * Действия блока «Данные» (FR-SET-4/FR-SET-5/FR-SET-10, вайрфреймы §8).
 *
 * Экспорт и импорт вызываются из двух мест — со страницы настроек и из overflow
 * AppBar / меню «Ещё» (вайрфреймы §9.1/§9.2), поэтому сам сценарий (выбор файла,
 * подтверждение, тосты и ярлыки повтора) живёт здесь, а не дублируется в
 * `MainLayout.vue` и `SettingsPage.vue`. Работа с файлом и DOM — в
 * `services/dataTransfer.ts`, запись данных — в `useSettingsStore`.
 */
export function useDataActions() {
  const { t } = useI18n()
  const settings = useSettingsStore()
  const ui = useUiStore()

  /** Экспорт (FR-SET-4): Blob из стора → скачивание → тост. true — файл выгружен. */
  async function exportData(): Promise<boolean> {
    const result = await settings.exportAll()
    if (result.ok) {
      downloadBlob(result.data, exportFileName())
      ui.notify(t('settings.exported'), 'success')
      return true
    }
    ui.notify(result.error.message, 'error', {
      label: t('common.retry'),
      handler: () => void exportData(),
    })
    return false
  }

  /**
   * Импорт (FR-SET-5): выбор файла → подтверждение перезаписи → запись.
   * Коды ошибок разводят повторы: DB_ERROR — импорт целиком, STORAGE_ERROR
   * (SETTINGS_AFTER_IMPORT) — только запись настроек (контракты §0.2, §5.4).
   */
  async function importData(): Promise<boolean> {
    const file = await pickJsonFile()
    if (file === null) return false

    const confirmed = await ui.openConfirm({
      title: t('settings.import'),
      message: t('settings.importConfirm'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
    })
    if (!confirmed) return false

    const result = await settings.importAll(file)
    if (result.ok) {
      ui.notify(t('settings.imported'), 'success')
      return true
    }

    const reason = (result.error.details as { reason?: unknown } | undefined)?.reason
    if (result.error.code === 'STORAGE_ERROR' && reason === 'SETTINGS_AFTER_IMPORT') {
      // Таблицы Dexie уже импортированы — повторяется только блок settings
      ui.notify(t('settings.settingsNotSaved'), 'error', {
        label: t('settings.retrySettings'),
        handler: () => void retrySettingsWrite(),
      })
      return false
    }

    ui.notify(
      result.error.code === 'VALIDATION_ERROR' ? t('settings.importInvalid') : result.error.message,
      'error',
      { label: t('common.retry'), handler: () => void importData() },
    )
    return false
  }

  /** Повтор только записи настроек после STORAGE_ERROR (FR-SET-5). */
  async function retrySettingsWrite(): Promise<boolean> {
    const result = await settings.retrySettingsWrite()
    if (result.ok) {
      ui.notify(t('settings.settingsSaved'), 'success')
      return true
    }
    ui.notify(result.error.message, 'error', {
      label: t('common.retry'),
      handler: () => void retrySettingsWrite(),
    })
    return false
  }

  /**
   * Очистка (FR-SET-10): подтверждение обязательно, повтор блокируется стором
   * (`busy`). Если экспорта ещё не было, диалог сначала предлагает выгрузить
   * данные (вайрфреймы §8) — отказ от выгрузки очистку не отменяет.
   */
  async function clearData(): Promise<boolean> {
    if (settings.lastBackupAt === null) {
      const exportFirst = await ui.openConfirm({
        title: t('settings.clear'),
        message: t('settings.clearSuggestExport'),
        confirmLabel: t('settings.export'),
        cancelLabel: t('common.cancel'),
      })
      if (exportFirst) await exportData()
    }

    const confirmed = await ui.openConfirm({
      title: t('settings.clear'),
      message: t('settings.clearConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!confirmed) return false

    const result = await settings.clearAll()
    if (result.ok) {
      ui.notify(t('settings.cleared'), 'success')
      return true
    }
    ui.notify(result.error.message, 'error', {
      label: t('common.retry'),
      handler: () => void clearData(),
    })
    return false
  }

  return { exportData, importData, retrySettingsWrite, clearData }
}

/**
 * Подпись «последний экспорт» (вайрфреймы §8): дата и время в выбранном формате
 * (FR-SET-3), «ни разу» — если экспорта ещё не было и `lastBackupAt` пуст.
 * Время проходит через общий `formatClock`, поэтому 12-часовой вид настройки
 * действует и на этой подписи, а не только на сетке дня.
 */
export function backupLabel(
  iso: string | null,
  timeFormat: TimeFormat,
  neverLabel: string,
): string {
  if (iso === null) return neverLabel
  const date = parseISO(iso)
  if (Number.isNaN(date.getTime())) return neverLabel
  return `${format(date, 'yyyy-MM-dd')} ${formatClock(format(date, 'HH:mm'), timeFormat)}`
}
