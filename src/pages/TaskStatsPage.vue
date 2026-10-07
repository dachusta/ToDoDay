<template>
  <q-page padding>
    <div class="text-h6">
      {{ t('nav.stats') }}
    </div>
    <p class="text-body2 text-grey-7">
      {{ t('app.name') }} — статистика по делу появится на этапе 7 плана MVP (ТЗ §8.2).
    </p>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ id: string }>()

const { t } = useI18n()
</script>
