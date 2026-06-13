import { AppError } from '../../lib'

export const validateUserId = (id: number): number => {
  if (Number.isNaN(id) || id <= 0) {
    throw new AppError('INVALID_INPUT', 'Invalid user ID')
  }
  return id
}
