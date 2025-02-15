#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Server } from 'socket.io'
import { io as ioClient } from 'socket.io-client'

// Analyse des paramètres
const argv = yargs(hideBin(process.argv))
  .option('port', {
    alias: 'p',
    default: '3000',
    description: 'port à utiliser'
  })
  .version('1.0.0')
  .help()
  .argv

// Création de la DB
const db = Object.create(null)
const neighbors = []
const sockets = []

function sync(socket) {
  socket.emit('keys', (error, keys) => {
    if (error) {
        console.error(error)
      } else {
        console.info(keys.join(','))
      }
  })
  //si une cle n'est pas dans notre tableau de clés de la socket, on l'ajoute
  /*
  keys.forEach((element, index)=> {
      if (element) {

      }
  })*/
}

// Initialisation d'une socket
function initSocket (socket) {

  socket.on('get', function (field, callback) {
    if (field in db) {
      console.info(`get ${field}: ${db[field]?.value}`)
      callback(undefined, db[field]) // lit et renvoie la valeur associée à la clef.
    } else {
      const error = new Error(`Field ${field} not exists`)
      console.error(error)
      callback(error.message)
    }
  })

  socket.on('set', function (field, value, callback) {
    if (field in db) { // Si la clef est dans la base de donnée
      if(value === db[field]?.value){ //si la valeur est la meme que precedemment
        callback()
      } else {
        const error = new Error(`set error : Field ${field} exists.`)
        console.info(error)
        callback(error.message)
      }
    } else {
      console.info(`set ${field} : ${value}`)
      db[field] = {
        value,
        date: Date.now() // on sauvegarde la date de création
      }

      sockets.forEach((socket, index) => {
        socket.emit('set', field, value, (error) => {
          if (error) {
            console.error(error)
          } else {
            console.info('OK')
          }
        })
        sockets.push(socket)
      })

      callback()
    }
  })

    socket.on('keys', function (callback) {
    console.info('keys')
    callback(undefined, Object.keys(db)) // Object.keys() extrait la liste des clefs d'un object et les renvoie sous forme d'un tableau.
  })

  socket.on('peers', function (callback) {
    console.info('peers')
    callback(undefined, neighbors)
  })



  socket.on('addPeer', function (port, callback) {
    console.info('addPeer')
    socket = ioClient(`http://localhost:${port}`, {
      path: '/byc'
    });

    var inNeighbors = 0
    if (neighbors.length === 0) {
      neighbors.push(port)
    } else {
      neighbors.forEach((element, index) => {
        if (port === element){
          console.log("neighbor already declared")
          inNeighbors = 1
        } 
      })
      if (inNeighbors == 0) {
        neighbors.push(port)
      }
    }
    

    sockets.push(socket)
    socket.on('connect', () => {
      socket.emit('auth', argv.port, (error) => {
        if (error) {
          console.error(error)
        } else {
          console.info('OK')
        }
      })
      
    })
    initSocket(socket)
    callback()
  })

  socket.on('auth', function (port, callback) {
    console.info('auth')
    var inNeighbors = 0
    if (neighbors.length === 0) {
      neighbors.push(port)
    } else {
      neighbors.forEach((element, index) => {
        if (port === element){
          console.log("neighbor already declared")
          inNeighbors = 1
        } 
      })
      if (inNeighbors == 0) {
        neighbors.push(port)
      }
    }
    sockets.push(socket)
    callback()
  })
}



// Création du serveur
const io = new Server(argv.port, {
  path: '/byc',
  serveClient: false
})

console.info(`Serveur lancé sur le port ${argv.port}.`)

// À chaque nouvelle connexion
io.on('connect', (socket) => {
  console.info('Nouvelle connexion')
  initSocket(socket)
})

