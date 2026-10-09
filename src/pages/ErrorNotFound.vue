<template>
  <!--
    Экран «страница не найдена» (маршрут `:catchAll` в router/routes.ts).
    Строки — из словаря (НФТ ТЗ §7: все строки интерфейса, включая служебные,
    из i18n): раньше здесь были английские литералы шаблона Quasar.
    Заголовок один и первый на экране — при переходе на 404 скринридер должен
    услышать, что страницы нет, а не «404» отдельным блоком.
  -->
  <div class="error-not-found text-center q-pa-md flex flex-center">
    <div>
      <div
        class="error-not-found__code"
        aria-hidden="true"
      >
        404
      </div>

      <h1 class="text-h5 error-not-found__title">
        {{ t('errors.notFoundTitle') }}
      </h1>

      <p class="text-body2 error-not-found__text">
        {{ t('errors.notFoundHint') }}
      </p>

      <q-btn
        class="q-mt-lg"
        color="primary"
        unelevated
        no-caps
        to="/"
        :label="t('errors.notFoundHome')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.error-not-found {
  min-height: 100vh;
  background: var(--app-surface);
  color: var(--app-title);
}

.error-not-found__code {
  font-size: 30vh;
  line-height: 1;
  /* Декоративное число: контраст к фону удержан, но текст основного сообщения
     читается первым (НФТ ТЗ §7) */
  color: var(--app-hint);
}

.error-not-found__title {
  margin: 0;
}

.error-not-found__text {
  margin: 8px 0 0;
  color: var(--app-meta);
}
</style>
