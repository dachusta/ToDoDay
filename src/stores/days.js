import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export const useDaysStore = defineStore('days', () => {
  const list = ref([])

  function setList () {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/days/setList?userId=${userId}`, list.value)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  function getList () {
    const userId = 'test'

    axios
      .get(`${import.meta.env.VITE_URL}/days/getList?userId=${userId}`)
      .then(function (response) {
        console.log(response)
        console.log(response.data)
        list.value = response.data
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  function createDay () {
    list.value.push({
      _id: Date.now(),
      tasks: []
    })
  }

  function removeDay (dayId) {
    list.value = list.value.filter((day) => day._id !== dayId)
  }

  function toPrevDay ({ dayId, fromIndex }) {
    const element = list.value[fromIndex]
    list.value.splice(fromIndex, 1)
    list.value.splice(fromIndex - 1, 0, element)
  }

  function toNextDay ({ dayId, fromIndex }) {
    const element = list.value[fromIndex]
    list.value.splice(fromIndex, 1)
    list.value.splice(fromIndex + 1, 0, element)
  }

  const selectedDayId = ref('')

  function selectDay (dayId) {
    console.log(dayId)
    selectedDayId.value = dayId
  }

  function addTask (task) {
    list.value.forEach(day => {
      if (day._id === selectedDayId.value) {
        day.tasks.push({
          _uniqId: Date.now(),
          ...task
        })
      }
    })
  }

  function updateTask (updatedTask) {
    console.log(updatedTask)
    list.value.forEach(day => {
      day.tasks.forEach(task => {
        if (task._id === updatedTask._id) {
          task.color = updatedTask.color
          task.priority = updatedTask.priority
          task.value = updatedTask.value
        }
      })
    })
  }

  function removeTask ({ dayId, taskUniqId }) {
    list.value.forEach(day => {
      if (dayId === day._id) {
        day.tasks = day.tasks.filter(task => taskUniqId !== task._uniqId)
      }
    })
  }

  function setTaskTime ({ dayId, taskUniqId, time }) {
    const userId = 'test'

    // отправка/изменение на бэке
    axios
      .post(`${import.meta.env.VITE_URL}/days/setTaskTime?userId=${userId}`, {
        dayId,
        taskUniqId,
        time
      })
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })

    // дублирование: изменение на фронте
    list.value.forEach(day => {
      if (day._id === dayId) {
        day.tasks.forEach(task => {
          if (task._uniqId === taskUniqId) {
            task.time = time
          }
        })
      }
    })
  }

  function setTaskDone ({ dayId, taskUniqId, checked }) {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/days/setTaskDone?userId=${userId}`, {
        dayId,
        taskUniqId,
        checked
      })
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })

    // дублирование: изменение на фронте
    list.value.forEach(day => {
      if (day._id === dayId) {
        day.tasks.forEach(task => {
          if (task._uniqId === taskUniqId) {
            task.checked = checked
          }
        })
      }
    })
  }

  return {
    list,
    setList,
    getList,
    createDay,
    removeDay,
    toPrevDay,
    toNextDay,
    selectedDayId,
    selectDay,
    addTask,
    updateTask,
    removeTask,
    setTaskTime,
    setTaskDone
  }
})
