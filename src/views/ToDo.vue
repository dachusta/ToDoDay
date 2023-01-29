<script setup>
import { ref } from "vue";
import ToDoDays from "../components/ToDo/ToDoDays.vue";

const days = ref([
  // day
  {
    order: 1,
    value: [
      // task
      {
        time: "06:00",
        value: "Делать",
      },
    ],
  },
]);

// Добавлять и удалять время
function setTask(day) {
  day.value.push({
    time: "",
    value: "",
  });
}
function deleteTask(findTask) {
  days.value[0].value = days.value[0].value.filter(
    (task) => task.time !== findTask.time
  );
}

// Заносить данные в локалстор и получать от туда
// Сделать PWA
// Настроить уведомления (пуш и системмные)

// const day = [];
</script>
<template>
  {{ days }}

  <ToDoDays :days="days" @setTask="setTask" @deleteTask="deleteTask" />
</template>

<style>
/* @media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
} */
</style>
