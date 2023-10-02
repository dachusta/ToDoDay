import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { useDaysStore } from './days'

export const useTasksStore = defineStore('tasks', () => {
  const list = ref([])
  const days = useDaysStore()

  function setList () {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/tasks/setList?userId=${userId}`, list.value)
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
      .get(`${import.meta.env.VITE_URL}/tasks/getList?userId=${userId}`)
      .then(function (response) {
        console.log(response)
        console.log(response.data)
        list.value = response.data
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  function createTask (newTask) {
    list.value.unshift({
      _id: Date.now(),
      priority: newTask.priority,
      value: newTask.value,
      color: newTask.color
    })
  }
  function updateTask (newTask) {
    list.value.forEach(task => {
      if (newTask._id === task._id) {
        task.priority = newTask.priority
        task.value = newTask.value
        task.color = newTask.color
      }
    })
    days.updateTask(newTask)
  }

  function removeTask (taskId) {
    list.value = list.value.filter((task) => taskId !== task._id)
  }

  return {
    list,
    setList,
    getList,
    createTask,
    updateTask,
    removeTask
  }
})
