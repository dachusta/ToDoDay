import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export const useDaysStore = defineStore('days', () => {
  const days = ref([])

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

  const isEditor = ref(false)

  function saveDays () {
    isEditor.value = false

    setDays(days.value)
  }
  function editDays () {
    isEditor.value = true
  }
  console.log(import.meta.env.VITE_URL)
  // http://192.168.1.65:3001/setDays
  // https://tododay-api.ru/setDays
  function setDays (days) {
    axios
      .post(`${import.meta.env.VITE_URL}/setDays`, days)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
  }
  function getDays () {
    axios
      .get(`${import.meta.env.VITE_URL}/getDays`)
      .then(function (response) {
        console.log(response)
        console.log(response.data.data)
        days.value = response.data.data
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  return {
    days,
    createDay,
    removeDay,
    toPrevDay,
    toNextDay,
    selectedDay,
    selectDay,
    addTaskToDay,
    removeTask,
    setTaskTime,
    setTaskChecked,
    isEditor,
    saveDays,
    editDays,
    setDays,
    getDays
  }
})
