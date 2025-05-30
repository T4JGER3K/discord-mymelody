// models/ReactionRole.js
const mongoose = require('mongoose');

const reactionRoleSchema = new mongoose.Schema({
  guildId:   { type: String, required: true },  // ID serwera (guild)
  channelId: { type: String, required: true },  // ID kanału z wiadomością
  messageId: { type: String, required: true },  // ID wiadomości, na której reagujemy
  emoji:     { type: String, required: true },  // Emoji (nazwa Unicode lub ID emoji)
  roleId:    { type: String, required: true }   // ID roli do nadania
});

// Tworzymy model „ReactionRole” na podstawie powyższego schematu
module.exports = mongoose.model('ReactionRole', reactionRoleSchema);
