#!/usr/bin/env node
  
import yargs from 'yargs'
import fs from 'fs'
import { hideBin } from 'yargs/helpers'

import Network from './class/Network.js'
import Command from './class/Command.js'
import Transaction from './class/Transaction.js'
import Block from './class/Block.js'
import Miner from './class/Miner.js'
import Blockchain from './class/Blockchain.js'
import log from './class/log.js'

// Analyse des paramètres
const argv = yargs(hideBin(process.argv))
  .option('port', {
    alias: 'p',
    default: '3000',
    description: 'port à utiliser'
  })
  .option('url', {
    alias: 'u',
    default: 'http://localhost',
    description: 'url que le serveur annonce'
  })
  .option('wallet', {
    alias: 'w',
    default: 'default',
    description: 'wallet à utiliser pour controler le noeud'
  })
  .option('mine', {
    alias: 'm',
    type: 'boolean',
    default: false,
    description: 'active le minage'
  })
  .option('bootstrap', {
    alias: 'b',
    description: 'Initialise le genesis de la blockchain avec ce timestamp',
    type: 'number'
  })
  .option('saveOnSig', {
    type: 'boolean',
    default: false,
    description: 'Écrit la db sur disque quand un signal SIGINT est reçu'
  })
  .option('autoSave', {
    type: 'boolean',
    default: false,
    description: 'Écrit la blockchain sur disque régulièrement'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    description: 'Affiche les logs'
  })
  .option('debug', {
    alias: 'd',
    type: 'boolean',
    default: false,
    description: 'Affiche les logs de debug'
  })
  .version('1.0.0')
  .help()
  .argv

// Clé pour controler le serveur
let publicKey

try {
  publicKey = fs.readFileSync(`./wallets/${argv.wallet}/pub`, 'utf8')
} catch (e) {
  if (e.code === 'ENOENT') {
    log.error(`Le wallet ${argv.wallet} n'existe pas. Vous devez utiliser le CLI pour le créer`)
  } else {
    log.error(e)
  }
  process.exit(1)
}

const nodeId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36)

// premier block de la chaine
const genesis = new Block(0, null, [], argv.bootstrap || Date.now())

genesis.powSync() // calcul de la preuve

const network = new Network(argv.port, argv.url, nodeId)
const miner = new Miner()
const blockchain = new Blockchain(genesis)

// Gestion des options
if (argv.verbose) {
  log.verbose = true
  log.log('Mode verbeux')
}

if (argv.debug) {
  log.debuging = true
  log.log('Mode debug')
}

log.log('My node id:', nodeId)

if (argv.saveOnSigkill) {
  process.on('SIGINT', () => {
    if (!fs.existsSync('./saves')) {
      log.info('Création du dossier "saves"')
      fs.mkdirSync('./saves')
    }
    fs.writeFileSync(`./saves/db_${Date.now()}.json`, JSON.stringify(blockchain), 'utf8')
    process.exit(0)
  })
}

if (argv.autoSave) {
  log.info('Sauvegardes automatiques activées')
  if (!fs.existsSync('./saves')) {
    log.info('Création du dossier "saves"')
    fs.mkdirSync('./saves')
  }
  setInterval(() => {
    const filename = `./saves/db_${Date.now()}.json`
    log.info('Save in ', filename)
    fs.writeFile(filename, JSON.stringify(blockchain), 'utf8', (err) => {
      if (err) {
        log.error(err)
      }
    })
  }, 1000 * 60 * 1) // Toutes les minutes
}

if (argv.mine) {
  log.info('Minage activé')
  miner.findPow(blockchain.buildNextBlock())
}

async function setBlock (block, socket, callback = () => {}) {
  if (!block.isValid()) {
    const error = new Error('block error : block invalid')
    log.warn(error, block)
    callback(error.message)
  } else {
    if (await blockchain.addBlock(block, socket)) {
      network.notifyNeighbors('block', block)
      if (argv.mine) {
        const nextBlock = blockchain.buildNextBlock()

        // reward here ;)
        // indice : https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/Array/unshift
        // indice : pour créer une transaction, vous pouvez regarder comment cli.js crée une command

        log.info(`Search for the hash of block ${nextBlock.index}`)

        miner.findPow(nextBlock)
      }
    }

    callback()
  }
}

// # ajout des blocks minés
miner.on('pow', setBlock)

// # gestion des demandes en lecture
network.on('get', function (socket, key, callback) {
  const value = blockchain.get(key)
  if (value !== undefined) {
    log.info(`get ${key}: ${value}`)
    callback(undefined, value) // lit et renvoie la valeur associée à la clef.
  } else {
    const error = new Error(`Field ${key} not exists`)
    log.error(error)
    callback(error.message)
  }
})

network.on('keys', function (socket, callback) {
  log.info('keys')
  callback(undefined, blockchain.keys()) // Object.keys() extrait la liste des clefs d'un object et les renvoie sous forme d'un tableau.
})

network.on('identities', function (socket, callback) {
  log.info('identities')
  callback(undefined, blockchain.getIdentities()) // Object.keys() extrait la liste des clefs d'un object et les renvoie sous forme d'un tableau.
})

network.on('rewards', function (socket, callback) {
  log.info('rewards')
  callback(undefined, blockchain.getRewards()) // Object.keys() extrait la liste des clefs d'un object et les renvoie sous forme d'un tableau.
})

network.on('last', function (socket, callback) {
  log.info('last')

  callback(undefined, blockchain.last())
})

network.on('blockByIndex', function (socket, index, callback) {
  log.info('blockByIndex', index)

  callback(undefined, blockchain.blockByIndex(index))
})

network.on('blockById', function (socket, id, callback) {
  log.info('blockById', id)

  callback(undefined, blockchain.blockById(id))
})

// # notifications
network.on('transaction', function (socket, transaction, callback) {
  log.info('transaction', transaction.id)

  transaction = Transaction.fromObject(transaction)

  if (!transaction.isValid()) {
    const error = new Error('transaction error : transaction invalid')
    log.info(error)
    callback(error.message)
  } else if (transaction.type === 'reward') {
    const error = new Error('transaction error : transaction reward')
    log.info(error)
    callback(error.message)
  } else if (blockchain.addTransaction(transaction)) {
    network.notifyNeighbors('transaction', transaction)
    callback()
  } else {
    callback()
  }
})

network.on('block', function (socket, block, callback) {
  log.info('block', block.id, 'from', socket.id)

  block = Block.fromObject(block)

  setBlock(block, socket, callback)
})

// # gestion des commandes authentifiées
network.on('cmd', function (socket, cmd, callback) {
  cmd = Command.fromObject(cmd)

  if (cmd.user !== publicKey || !cmd.verify()) {
    const error = new Error('cmd error : vous n\'avez pas les droits')
    log.info(error)
    callback(error.message)
  } else if (cmd.type === 'set') {
    log.info('cmd::set', cmd.params.key, cmd.params.value)
    const transaction = Transaction.fromCommand(cmd)
    if (blockchain.addTransaction(transaction)) {
      network.notifyNeighbors('transaction', transaction)
      callback()
    } else {
      const error = new Error('cmd error : cette transaction existe déjà')
      log.info(error)
      callback(error.message)
    }
  } else if (cmd.type === 'addPeer') {
    log.info('cmd::addPeer', cmd.params.url, cmd.params.port)
    const s = network.addPeer(cmd.params.url, cmd.params.port, callback)

    if (s) {
      s.emit('last', (error, last) => {
        if (error) {
          log.error('addPeer::last fail:', error)
        }

        setBlock(Block.fromObject(last), s, callback)
      })
    }
  } else {
    const error = new Error('cmd error : type inconnue')
    log.info(error)
    callback(error.message)
  }
})

// Démarrage du serveur
network.run()
