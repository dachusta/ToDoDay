<template>
  <div class="task">
    <input
      id="appt"
      v-model="task.time"
      type="time"
      name="appt"
    >
    <span>~</span>
    <input
      v-model="task.value"
      class="text"
      type="text"
    >
    <input
      v-model="task.checkbox"
      type="checkbox"
    >
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  task: {
    type: Object,
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
