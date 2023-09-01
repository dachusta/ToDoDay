<script setup>
import { ref, watch, onMounted } from 'vue'
// import ToDoDays from '../components/ToDo/ToDoDays.vue'
// import axios from 'axios'
import VDay from '../components/ToDo/VDay.vue'
import VNextDay from '../components/ToDo/VNextDay.vue'
import VNewDay from '../components/ToDo/VNewDay.vue'
import VSidebarEditor from '../components/SidebarEditor/VSidebarEditor.vue'

const days = ref([])
watch(
  () => days.value,
  () => {
    localStorage.setItem('days', JSON.stringify(days.value))
  },
  { deep: true }
)
onMounted(() => {
  const daysLS = localStorage.getItem('days')
  if (daysLS) {
    days.value = JSON.parse(daysLS)
  }
})

function createDay () {
  days.value.push({
    id: Date.now(),
    tasks: []
  })
}
function removeDay (id) {
  days.value = days.value.filter((day) => day.id !== id)
}

const selectedDay = ref('')

function selectDay (id) {
  selectedDay.value = id
}

function addTaskToDay (task) {
  days.value.forEach(day => {
    if (day.id === selectedDay.value) {
      day.tasks.push(task)
    }
  })
}
function removeTask (task) {
  // console.log(task)
  days.value.forEach(day => {
    console.log(day.tasks)
    day.tasks = day.tasks.filter(taskObj => task !== taskObj.value)
  })
}
// const days = [
//   {
//     id: 1,
//     tasks: [
//       {
//         time: '06:00',
//         value: 'Дело 1',
//         priority: 1,
//       },
//       {
//         time: '07:00',
//         value: 'Дело 1',
//         priority: 2,
//       },
//     ],
//   },
//   {
//     id: 2,
//     tasks: [
//       {
//         time: '06:00',
//         value: 'Дело 3',
//         priority: 1,
//       },
//       {
//         time: '07:00',
//         value: 'Дело 4',
//         priority: 2,
//       },
//     ],
//   },
// ]
const isEditor = ref(false)
function toggleEditor () {
  isEditor.value = !isEditor.value
}
</script>
<template>
  <div class="page">
    <header class="header">
      <div class="container">
        <nav class="nav">
          <span>Задачи</span>
          <span>Статистика</span>
        </nav>
      </div>
    </header>
    <main class="days">
      <div
        class="button-editor"
        @click="toggleEditor"
      >
        {{ isEditor ? 'Сохранить' : 'Редактировать' }}
      </div>

      <VDay
        v-for="day in days"
        :key="day.id"
        :day="day"
        :selected-day="selectedDay"
        :is-editor="isEditor"
        @remove-day="removeDay"
        @select-day="selectDay"
        @remove-task="removeTask"
      />

      <!-- Режим редактора -->
      <VNewDay
        v-if="isEditor"
        @create-day="createDay"
      />

      <!-- Режим просмотра -->
      <VNextDay
        v-if="false"
        :day="null"
      />
      <!-- <VDay :day="day[0]" /> -->
    </main>
    <VSidebarEditor
      v-if="isEditor"
      class="sidebar"
      @to-day="addTaskToDay"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-areas:
    'header header'
    'days sidebar';
  grid-template-columns: 1fr max-content;
  grid-template-rows: 60px auto;
  height: 100vh;
  color: #fff;
  background: linear-gradient(#6b7587, #1b1e24);
  font-family: Arial, Helvetica, sans-serif;
  /* padding: 0 30px; */
}

.header {
  grid-area: header;
  /* height: 60px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0; */
  display: flex;
  background: rgba(27, 30, 36, 0.5);
}

.container {
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

.nav {
  display: flex;
  /* gap: 30px; */
  height: 100%;
}

.nav span {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0px 30px;
}

.days {
  grid-area: days;
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  column-gap: 30px;
  row-gap: 50px;
  padding: 70px 50px 50px 50px;
  overflow: auto;
}

.button-editor {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 15px 30px;
  border-radius: 5px;
  background: rgba(27, 30, 36, 0.7);
}

.sidebar {
  grid-area: sidebar;
}
</style>
