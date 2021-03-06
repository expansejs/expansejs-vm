const async = require('async')
const Trie = require('merkle-patricia-tree/secure')
const Block = require('expansejs-block')
const Blockchain = require('expansejs-blockchain')
const BlockHeader = require('expansejs-block/header.js')
const VM = require('../../')
const Level = require('levelup')
const Account = require('expansejs-account')
const utils = require('expansejs-util')
const BN = utils.BN
const rlp = utils.rlp
const testData = require('./test-data')
// inMemory blockchainDB
var blockchainDB = new Level('', { db: require('memdown') })

var state = new Trie()

var blockchain = new Blockchain(blockchainDB)
blockchain.ethash.cacheDB = new Level('./.cachedb')

var vm = new VM({
  state: state,
  blockchain: blockchain
})
var genesisBlock = new Block()

vm.on('beforeTx', function (tx) {
  tx._homestead = true
})

vm.on('beforeBlock', function (block) {
  block.header.isHomestead = function () {
    return true
  }
})

async.series([
  // set up pre-state
  function (next) {
    setupPreConditions(state, testData, next)
  },

  // create and add genesis block
  function (next) {
    genesisBlock.header = new BlockHeader(
                            testData.genesisBlockHeader
                          )
    blockchain.putGenesis(genesisBlock, next)
  },

  // add some following blocks
  function (next) {
    async.eachSeries(testData.blocks, eachBlock, next)

    function eachBlock (raw, cb) {
      try {
        var block = new Block(
            new Buffer(raw.rlp.slice(2), 'hex'))

        // forces the block into thinking they are homestead
        block.header.isHomestead = function () {
          return true
        }
        block.uncleHeaders.forEach(function (uncle) {
          uncle.isHomestead = function () { return true }
        })

        blockchain.putBlock(block, function (err) {
          cb(err)
        })
      } catch (err) {
        cb()
      }
    }
  },

  // make sure the blocks check
  // if a block is missing, vm.runBlockchain will fail
  function runBlockchain (next) {
    vm.runBlockchain(next)
  },

  // get the blockchain head
  function getHead (next) {
    vm.blockchain.getHead(function (err, block) {
      // make sure the state is set before checking post conditions
      state.root = block.header.stateRoot
      next(err)
    })
  }
], function () {
  console.log('--- Finished processing the BlockChain ---')
  console.log('New head:', '0x' + blockchain.meta.rawHead.toString('hex'))
  console.log('Expected:', testData.lastblockhash)
})

function setupPreConditions (state, testData, done) {
  var keysOfPre = Object.keys(testData.pre)

  async.eachSeries(keysOfPre, function (key, callback) {
    var acctData = testData.pre[key]
    var account = new Account()

    account.nonce = format(acctData.nonce)
    account.balance = format(acctData.balance)

    var codeBuf = new Buffer(acctData.code.slice(2), 'hex')
    var storageTrie = state.copy()
    storageTrie.root = null

    async.series([
      function (cb2) {
        var keys = Object.keys(acctData.storage)

        async.forEachSeries(keys, function (key, cb3) {
          var val = acctData.storage[key]
          val = rlp.encode(new Buffer(val.slice(2), 'hex'))
          key = utils.setLength(new Buffer(key.slice(2), 'hex'), 32)

          storageTrie.put(key, val, cb3)
        }, cb2)
      },
      function (cb2) {
        account.setCode(state, codeBuf, cb2)
      },
      function (cb2) {
        account.stateRoot = storageTrie.root

        if (testData.exec && key === testData.exec.address) {
          testData.root = storageTrie.root
        }
        state.put(new Buffer(key, 'hex'), account.serialize(), function () {
          cb2()
        })
      }
    ], callback)
  }, done)
}

function format (a, toZero, isHex) {
  if (a === '') {
    return new Buffer([])
  }

  if (a.slice && a.slice(0, 2) === '0x') {
    a = a.slice(2)
    if (a.length % 2) a = '0' + a
    a = new Buffer(a, 'hex')
  } else if (!isHex) {
    a = new Buffer(new BN(a).toArray())
  } else {
    if (a.length % 2) a = '0' + a
    a = new Buffer(a, 'hex')
  }

  if (toZero && a.toString('hex') === '') {
    a = new Buffer([0])
  }

  return a
}
