<template>
  <div class="task">
    <input type="time" id="appt" name="appt" v-model="task.time" />
    <span>~</span>
    <input class="text" type="text" v-model="task.value" />
    <input type="checkbox" v-model="task.checkbox" />
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  task: {
    type: Object,
    required: true,
  },
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
