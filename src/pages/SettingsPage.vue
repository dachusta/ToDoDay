<template>
  <q-page padding>
    <div class="text-h6">
      {{ t('nav.settings') }}
    </div>
    <p class="text-body2 text-grey-7">
      {{ t('app.name') }} — экран настроек и данных появится на этапе 8 плана MVP (ТЗ §8.2).
    </p>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
