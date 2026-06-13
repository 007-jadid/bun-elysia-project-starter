import type { Mongoose } from 'mongoose'

export interface MongoConnection {
  client: Mongoose | null
  disconnect: () => Promise<void>
}
