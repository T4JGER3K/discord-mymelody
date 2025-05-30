// models/ReactionRole.js
const { Schema, model } = require('mongoose');

const reactionRoleSchema = new Schema({
  messageId: String,
  channelId: String,
  exclusive: Boolean,
  pairs: [
    {
      emoji: String,
      roleId: String
    }
  ]
});

module.exports = model('ReactionRole', reactionRoleSchema);
