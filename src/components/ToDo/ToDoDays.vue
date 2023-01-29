<script setup>
import ToDoDay from './ToDoDay.vue';

defineProps({
  days: {
    type: Object,
    required: true,
  },
});
</script>

<template>
  <div>
    <ToDoDay
      v-for="day in days"
      :key="day.order"
      :day="day"
      class="day"
      @deleteTask="$emit('deleteTask', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>

</style>
