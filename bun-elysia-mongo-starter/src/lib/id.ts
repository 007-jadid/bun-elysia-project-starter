import { nanoid } from 'nanoid'

export const generateId = () => nanoid()

export const generateCode = (length = 8) => nanoid(length).toUpperCase()
