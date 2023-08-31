<template>
  <div class="task">
    <input
      id="appt"
      v-model="task.time"
      type="time"
      name="appt"
    >
    <span>~</span>
    <VInputText
      v-model="task.value"
    />
    <VButton
      v-if="isEditor"
      @click="$emit('removeTask', task.value)"
    >
      ✘
    </VButton>
    <input
      v-else
      v-model="task.checkbox"
      type="checkbox"
    >
  </div>
</template>

<script setup>
import { ref } from 'vue'
import VButton from '../VButton.vue'
import VInputText from '../VInputText.vue'

defineProps({
  task: {
    type: Object,
    required: true
  },
  isEditor: {
    type: Boolean,
    required: true
  }
})

const time = ref('')
const value = ref('')
const checkbox = ref(false)
</script>

<style scoped>
.task {
  display: flex;
  gap: 15px;
  padding: 10px 15px;
  border-radius: 5px;
  background: rgba(27, 30, 36, 0.5);
  border: 1px solid #ffffff;

  .text {
    width: 100%;
  }
}
</style>
