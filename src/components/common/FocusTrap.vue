<template>
  <!--
    Ловушка фокуса для модальных окон (НФТ ТЗ §7, этап 10 плана).

    Разметка пустая (`hidden`): компонент ведёт только атрибут `inert` на корне
    приложения, пока открыт подтверждающий диалог `uiStore.openConfirm`.

    Почему `inert`, а не перехват Tab: `inert` — механизм платформы, который разом
    убирает фон из порядка табуляции, из дерева доступности и из указателя.
    Порталы Quasar (QDialog, QMenu) телепортируются в `body`, то есть лежат **вне**
    корня приложения, поэтому открытый диалог остаётся интерактивным, а фокус
    физически не может уйти в перекрытый интерфейс.

    Подтверждение — единственный модальный слой, не привязанный к разметке
    экрана: его открывает любая страница через стор (контракты §6.2). Диалоги
    страниц (`q-dialog` с `v-model`) гасят фон собственным `aria-modal` Quasar,
    а возврат фокуса на триггер делает `usePortalRefocus` самого QDialog.
  -->
  <div hidden />
</template>

<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useUiStore } from 'src/stores/ui'

/**
 * Корень приложения: `inert` ставится на `#q-app` — узел, в который Quasar
 * монтирует интерфейс. Порталы диалогов живут в `body` и остаются активными.
 */
const APP_ROOT_ID = 'q-app'

const ui = useUiStore()

function setInert(active: boolean): void {
  const root = document.getElementById(APP_ROOT_ID)
  // Приложение, смонтированное не в `#q-app` (компонентные тесты), пропускаем:
  // иначе `inert` встал бы на `body` вместе с открытым диалогом.
  if (root === null) return
  if (active) root.setAttribute('inert', '')
  else root.removeAttribute('inert')
}

watch(() => ui.confirmDialog !== null, setInert, { immediate: true })

onUnmounted(() => setInert(false))
</script>
