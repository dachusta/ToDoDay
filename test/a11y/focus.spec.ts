import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QCard, QCardActions, QCardSection, QDialog, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import FocusTrap from 'src/components/common/FocusTrap.vue'
import ConfirmDialog from 'src/components/common/ConfirmDialog.vue'
import { i18n } from 'src/boot/i18n'
import { useUiStore } from 'src/stores/ui'
import { quasarComponents } from '../vitest/quasar'
import { flush } from '../stores/helpers'

/**
 * Доступность модальных слоёв (НФТ ТЗ §7): `aria-modal`,
 * ловушка фокуса и возврат фокуса на элемент-триггер.
 *
 * Здесь воспроизводится каркас приложения: `#q-app` как корень, внутри —
 * экран с кнопкой, `ConfirmDialog` и `FocusTrap`. Порталы Quasar уезжают в
 * `body`, поэтому `inert` на корне не мешает открытому диалогу — это и есть
 * предмет проверки.
 */

const mounted: VueWrapper[] = []

/** Ссылка на `v-model` диалога: тест закрывает его, как это делает приложение. */
const dialogOpen = ref(false)

const Harness = defineComponent({
  components: { ConfirmDialog, FocusTrap, QDialog, QCard, QCardSection, QCardActions },
  setup() {
    return { open: dialogOpen }
  },
  template: `
    <div id="q-app">
      <button id="outside" type="button">Снаружи</button>
      <button id="trigger" type="button" @click="open = true">Открыть</button>
      <ConfirmDialog />
      <FocusTrap />
      <q-dialog v-model="open">
        <q-card>
          <q-card-section>Диалог страницы</q-card-section>
          <q-card-actions>
            <button id="inside" type="button">Внутри</button>
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  `,
})

async function mountHarness(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  dialogOpen.value = false
  document.body.innerHTML = '<div id="app"></div>'

  const wrapper = mount(Harness, {
    global: { plugins: [Quasar, pinia, i18n], components: quasarComponents },
    attachTo: document.getElementById('app') as HTMLElement,
  })
  mounted.push(wrapper)
  await flush(0)
  return wrapper
}

const appRoot = (): HTMLElement | null => document.getElementById('q-app')
const qDialog = (): HTMLElement | null => document.body.querySelector('.q-dialog')

/** Ожидание асинхронного состояния: таймеры Quasar в jsdom идут с задержкой. */
async function waitUntil(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

/** Закрыть окна и дать таймерам Quasar догореть внутри живого окружения. */
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
  while (
    (qDialog() !== null || document.body.querySelector('.q-dialog__backdrop') !== null) &&
    Date.now() < deadline
  ) {
    await flush(20)
  }
  document.body.innerHTML = ''
  await flush(100)
}

afterEach(teardown)

/** Открыть подтверждение через стор: тот же путь, что у страниц. */
async function openConfirm(): Promise<void> {
  void useUiStore().openConfirm({
    title: 'Удалить дело?',
    message: 'Действие необратимо',
    danger: true,
  })
  await nextTick()
  await nextTick()
  await flush(0)
}

describe('Фокус-ловушка модальных окон (НФТ ТЗ §7)', () => {
  it('пока подтверждение открыто, фон приложения получает inert', async () => {
    await mountHarness()
    expect(appRoot()?.hasAttribute('inert')).toBe(false)

    await openConfirm()
    expect(appRoot()?.hasAttribute('inert')).toBe(true)

    // Сам диалог — вне корня приложения (портал Quasar в body), поэтому он
    // остаётся интерактивным, а фокус не может уйти за его пределы
    const dialog = qDialog()
    expect(dialog).not.toBeNull()
    expect(appRoot()?.contains(dialog as Node)).toBe(false)
  })

  it('inert снимается, когда подтверждение закрыто', async () => {
    await mountHarness()
    await openConfirm()
    expect(appRoot()?.hasAttribute('inert')).toBe(true)

    useUiStore().confirmDialog?.resolve(false)
    useUiStore().confirmDialog = null
    await nextTick()
    await flush(0)
    expect(appRoot()?.hasAttribute('inert')).toBe(false)
  })

  it('подтверждение объявлено как modal-диалог', async () => {
    await mountHarness()
    await openConfirm()

    const dialog = qDialog()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
  })

  it('фокус возвращается на элемент-триггер после закрытия диалога страницы', async () => {
    await mountHarness()
    const trigger = document.getElementById('trigger') as HTMLButtonElement

    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await new DOMWrapper(trigger).trigger('click')
    await flush(0)
    expect(qDialog()).not.toBeNull()

    // Закрытие: Quasar через usePortalRefocus возвращает фокус туда, откуда
    // диалог открыли. Возврат идёт по завершении transition-хука, а jsdom не
    // доставляет `transitionend` (прецеденты D18/D30 журнала), поэтому ждём
    // состояние, а не время.
    dialogOpen.value = false
    await waitUntil(() => document.activeElement === trigger)
    expect(document.activeElement).toBe(trigger)
  })
})
