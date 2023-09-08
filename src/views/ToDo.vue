<script setup>
import { ref, watch, onMounted } from 'vue'
// import ToDoDays from '../components/ToDo/ToDoDays.vue'
import axios from 'axios'
import VDay from '../components/ToDo/VDay.vue'
import VNextDay from '../components/ToDo/VNextDay.vue'
import VNewDay from '../components/ToDo/VNewDay.vue'
import VSidebarEditor from '../components/SidebarEditor/VSidebarEditor.vue'

// Сортировка по заданному времени *
// Опасили при чекбоксе *
// Цвет бэкграунда задачи *
// Дата задачи (сегодня, завтра) *
// Возможность менять дни местами *
// (Цикличность) Автоматически менять дни, завтрашний день должна становиться сегодняшней

const days = ref([])
watch(
  () => days.value,
  () => {
    // localStorage.setItem('days', JSON.stringify(days.value))
  },
  { deep: true }
)
onMounted(() => {
  getDays()
  // const daysLS = localStorage.getItem('days')
  // if (daysLS) {
  //   days.value = JSON.parse(daysLS)
  // }
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

function toPrevDay ({ dayID, fromIndex }) {
  const element = days.value[fromIndex]
  days.value.splice(fromIndex, 1)
  days.value.splice(fromIndex - 1, 0, element)
}
function toNextDay ({ dayID, fromIndex }) {
  const element = days.value[fromIndex]
  days.value.splice(fromIndex, 1)
  days.value.splice(fromIndex + 1, 0, element)
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
function removeTask (task, dayID) {
  days.value.forEach(day => {
    if (dayID === day.id) {
      day.tasks = day.tasks.filter(taskObj => task !== taskObj.value)
    }
  })
}
function setTaskTime (params) {
  days.value.forEach(day => {
    if (params.dayID === day.id) {
      day.tasks.forEach(taskObj => {
        if (taskObj.value === params.task) {
          taskObj.time = params.time
        }
      })
    }
  })
}
function setTaskChecked (params) {
  days.value.forEach(day => {
    if (params.dayID === day.id) {
      day.tasks.forEach(taskObj => {
        if (taskObj.value === params.task) {
          taskObj.checked = params.checked
        }
      })
    }
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
// function toggleEditor () {
//   isEditor.value = !isEditor.value
// }
function saveDays () {
  isEditor.value = false

  setDays(days.value)
}
function editDays () {
  isEditor.value = true
}

// http://192.168.1.65:3001/setDays
// https://tododay-api.ru/setDays
function setDays (days) {
  axios
    .post('https://tododay-api.ru/setDays', days)
    .then(function (response) {
      console.log(response)
    })
    .catch(function (error) {
      console.log(error)
    })
}
function getDays () {
  axios
    .get('https://tododay-api.ru/getDays')
    .then(function (response) {
      console.log(response)
      console.log(response.data.data)
      days.value = response.data.data
    })
    .catch(function (error) {
      console.log(error)
    })
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
        class="buttons-editor"
      >
        <button
          v-if="isEditor"
          class="button-save"
          @click="saveDays"
        >
          Сохранить
        </button>
        <button
          v-else
          class="button-edit"
          @click="editDays"
        >
          Редактировать
        </button>
      </div>

      <VDay
        v-for="(day, idx) in days"
        :key="day.id"
        :day="day"
        :order="idx"
        :selected-day="selectedDay"
        :is-editor="isEditor"
        @remove-day="removeDay"
        @select-day="selectDay"
        @remove-task="removeTask"
        @set-task-time="setTaskTime"
        @set-task-checked="setTaskChecked"
        @to-prev-day="toPrevDay"
        @to-next-day="toNextDay"
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

.buttons-editor button {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 15px 30px;
  border-radius: 5px;
  color: inherit;
  border: none;
  background: rgba(27, 30, 36, 0.7);
}

.sidebar {
  grid-area: sidebar;
}
</style>
