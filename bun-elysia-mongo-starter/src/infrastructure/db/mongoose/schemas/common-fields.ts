// Shared fields to spread into your Mongoose schemas for consistent
// audit/soft-delete columns across collections.
export const commonFields = {
  createdAt: {
    type: Date,
  },
  updatedAt: {
    type: Date,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: Number,
    default: null,
  },
  updatedBy: {
    type: Number,
    default: null,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
}
