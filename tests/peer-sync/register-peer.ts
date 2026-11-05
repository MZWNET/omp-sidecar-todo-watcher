import process from 'node:process'
import { PeerSyncBroker } from '../../src/peer-sync/broker.ts'

const [dbPath, peerId] = process.argv.slice(2)
const broker = new PeerSyncBroker(dbPath, '/repo')
broker.registerPeer(peerId)
broker.close()
