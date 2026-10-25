import { mount, type VueWrapper } from '@vue/test-utils'
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
 * Общий хост подтверждений (контракты §6.2): импорт (FR-SET-5),
 * удаление архивного дела (FR-T-6) и очистка данных (FR-SET-10).
 * QDialog телепортируется в body, поэтому текст и кнопки ищем в документе.
 */

/** Смонтированные хосты: снимаем их до чистки body, иначе живут их порталы. */
const mounted: VueWrapper[] = []

type UiStore = ReturnType<typeof useUiStore>

async function mountDialog(): Promise<UiStore> {
  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = mount(ConfirmDialog, {
    global: { plugins: [Quasar, pinia, i18n], components: quasarComponents },
    attachTo: document.body,
  })
  mounted.push(wrapper)

  await flush(0)
  return useUiStore()
}

const buttons = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.q-card__actions .q-btn'),
]

const bodyText = (): string => document.body.textContent ?? ''

/**
 * Закрыть диалог и дать порталу Quasar доиграть анимацию до конца.
 *
 * QDialog прячется через `setTimeout` transition-хука Quasar. Если оставить
 * таймер висеть, он срабатывает уже после закрытия окружения jsdom, и прогон
 * падает на «Unhandled Errors: document is not defined» (в отчёте — строка
 * removeFocusWaitFlag из quasar.client.js). Поэтому снимаем хост и ждём, пока
 * портал действительно исчезнет из документа.
 */
async function teardown(): Promise<void> {
  const ui = useUiStore()
  ui.confirmDialog?.resolve(false)
  ui.confirmDialog = null

  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Хост мог быть снят тестом — для очистки это неважно
    }
  }
  await nextTick()

  const deadline = Date.now() + 1000
  while (document.body.querySelector('.q-dialog') !== null && Date.now() < deadline) {
    await flush(20)
  }

  document.body.innerHTML = ''
  await flush(100)
}

afterEach(teardown)

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
