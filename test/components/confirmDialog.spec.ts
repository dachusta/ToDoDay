import { mount } from '@vue/test-utils'
import { Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConfirmDialog from 'src/components/common/ConfirmDialog.vue'
import { useUiStore } from 'src/stores/ui'
import { i18n } from 'src/boot/i18n'
import { quasarComponents } from '../vitest/quasar'
import { flush } from '../stores/helpers'

/**
 * Общий хост подтверждений (контракты §6.2). На этапе 2 через него проходит
 * подтверждение импорта (FR-SET-5), дальше — FR-T-6 и FR-SET-10.
 * QDialog телепортируется в body, поэтому текст и кнопки ищем в документе.
 */

async function mountDialog() {
  const pinia = createPinia()
  setActivePinia(pinia)

  mount(ConfirmDialog, {
    global: { plugins: [Quasar, pinia, i18n], components: quasarComponents },
    attachTo: document.body,
  })

  await flush(0)
  return useUiStore()
}

const buttons = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.q-card__actions .q-btn'),
]

const bodyText = (): string => document.body.textContent ?? ''

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ConfirmDialog', () => {
  it('не показывает диалог, пока подтверждение не запрошено', async () => {
    await mountDialog()

    expect(buttons()).toHaveLength(0)
    expect(bodyText()).not.toContain('Удалить дело')
  })

  it('показывает заголовок и текст запроса из стора', async () => {
    const ui = await mountDialog()

    void ui.openConfirm({
      title: 'Удалить дело?',
      message: 'Действие необратимо',
      danger: true,
    })
    await nextTick()
    await nextTick()

    expect(bodyText()).toContain('Удалить дело?')
    expect(bodyText()).toContain('Действие необратимо')
    // Подписи по умолчанию — из i18n (common.cancel / common.confirm)
    expect(buttons().map(button => button.textContent?.trim())).toEqual(['Отмена', 'Подтвердить'])
  })

  it('подтверждение резолвит промис в true и очищает состояние стора', async () => {
    const ui = await mountDialog()

    const answer = ui.openConfirm({ title: 'Импорт из JSON', message: 'Перезаписать все данные?' })
    await nextTick()
    await nextTick()

    buttons()[1]?.click()

    await expect(answer).resolves.toBe(true)
    expect(ui.confirmDialog).toBeNull()
  })

  it('отмена резолвит промис в false', async () => {
    const ui = await mountDialog()

    const answer = ui.openConfirm({ title: 'Импорт из JSON', message: 'Перезаписать все данные?' })
    await nextTick()
    await nextTick()

    buttons()[0]?.click()

    await expect(answer).resolves.toBe(false)
    expect(ui.confirmDialog).toBeNull()
  })

  it('использует переданные подписи кнопок', async () => {
    const ui = await mountDialog()

    void ui.openConfirm({
      title: 'Очистить данные?',
      message: 'Действие необратимо',
      confirmLabel: 'Очистить',
      cancelLabel: 'Оставить',
    })
    await nextTick()
    await nextTick()

    expect(buttons().map(button => button.textContent?.trim())).toEqual(['Оставить', 'Очистить'])
  })
})
