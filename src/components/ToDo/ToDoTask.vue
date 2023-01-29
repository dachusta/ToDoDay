<script setup>
defineProps({
  task: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['deleteTask'])
// Добавлять и удалять время
function deleteTask(findTask) {
  emit('deleteTask', findTask)

  // days.value[0].value = days.value[0].value.filter(
  //   (task) => task.time !== findTask.time
  // );
}
</script>

<template>
  <div class="task">
    <input v-model="task.time" type="time" />
    <input v-model="task.value" type="text" />
    <button @click="deleteTask(task)">x</button>
  </div>
</template>

<style lang="scss" scoped>
.task {
  display: flex;
}
</style>
