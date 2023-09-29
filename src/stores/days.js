import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export const useDaysStore = defineStore('days', () => {
  const days = ref([])

  function createDay () {
    days.value.push({
      _id: Date.now(),
      tasks: []
    })
  }
  function removeDay (dayId) {
    days.value = days.value.filter((day) => day._id !== dayId)
  }

  function toPrevDay ({ dayId, fromIndex }) {
    const element = days.value[fromIndex]
    days.value.splice(fromIndex, 1)
    days.value.splice(fromIndex - 1, 0, element)
  }
  function toNextDay ({ dayId, fromIndex }) {
    const element = days.value[fromIndex]
    days.value.splice(fromIndex, 1)
    days.value.splice(fromIndex + 1, 0, element)
  }
  const selectedDayId = ref('')

  function selectDay (dayId) {
    console.log(dayId)
    selectedDayId.value = dayId
  }

  function addTaskToDay (task) {
    days.value.forEach(day => {
      if (day._id === selectedDayId.value) {
        day.tasks.push({
          _id: Date.now(),
          ...task
        })
      }
    })
  }
  function removeTask ({ dayId, taskId }) {
    days.value.forEach(day => {
      if (dayId === day._id) {
        day.tasks = day.tasks.filter(task => taskId !== task._id)
      }
    })
  }
  function setTaskTime ({ dayId, taskId, time }) {
    const userId = 'test'

    // отправка/изменение на бэке
    axios
      .post(`${import.meta.env.VITE_URL}/days/setTaskTime?userId=${userId}`, {
        dayId,
        taskId,
        time
      })
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })

    // дублирование: изменение на фронте
    days.value.forEach(day => {
      if (day._id === dayId) {
        day.tasks.forEach(task => {
          if (task._id === taskId) {
            task.time = time
          }
        })
      }
    })
  }
  function setTaskDone ({ dayId, taskId, checked }) {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/days/setTaskDone?userId=${userId}`, {
        dayId,
        taskId,
        checked
      })
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })

    // дублирование: изменение на фронте
    days.value.forEach(day => {
      if (day._id === dayId) {
        day.tasks.forEach(task => {
          if (task._id === taskId) {
            task.checked = checked
          }
        })
      }
    })
  }

  function setDays () {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/days/setList?userId=${userId}`, days.value)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
  }
  function getDays () {
    const userId = 'test'

    axios
      .get(`${import.meta.env.VITE_URL}/days/getList?userId=${userId}`)
      .then(function (response) {
        console.log(response)
        console.log(response.data)
        days.value = response.data
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
    selectedDayId,
    selectDay,
    addTaskToDay,
    removeTask,
    setTaskTime,
    setTaskDone,
    setDays,
    getDays
  }
})
