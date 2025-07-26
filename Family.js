const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Schema for individual family members.  Members accumulate
// a score based on the tasks they complete.
const MemberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    score: { type: Number, default: 0 }
  },
  { _id: true }
);

/**
 * Family schema.  Each family has a unique code and a hashed password
 * used for login.  A family can have multiple members stored as
 * subdocuments.  The timestamps option records when the family was
 * created and last updated.
 */
const FamilySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    members: [MemberSchema]
  },
  { timestamps: true }
);

// Helper method to set the password hash.  This encapsulates the
// bcrypt logic so that calling code can simply provide a plain text
// password and have it hashed automatically.
FamilySchema.methods.setPassword = async function (password) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(password, salt);
};

// Helper method to verify a provided password against the stored hash.
FamilySchema.methods.verifyPassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model('Family', FamilySchema);