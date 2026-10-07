<template>
  <q-page padding>
    <div class="text-h6">
      {{ t('nav.tasks') }}
    </div>
    <p class="text-body2 text-grey-7">
      {{ t('app.name') }} — экран дел появится на этапе 3 плана MVP (ТЗ §8.2).
    </p>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
