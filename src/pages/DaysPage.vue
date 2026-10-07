<template>
  <q-page padding>
    <div class="text-h6">
      {{ t('nav.days') }}
    </div>
    <p class="text-body2 text-grey-7">
      {{ t('app.name') }} — экран шаблонов дня появится на этапе 4 плана MVP (ТЗ §8.2).
    </p>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
