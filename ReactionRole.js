
const mongoose = require('mongoose');

const reactionRoleSchema = new mongoose.Schema({
  guildId:   { type: String, required: true }, 
  channelId: { type: String, required: true },  
  messageId: { type: String, required: true },  
  emoji:     { type: String, required: true },  
  roleId:    { type: String, required: true },   
  exclusive: { type: Boolean, default: false }    
});


module.exports = mongoose.model('ReactionRole', reactionRoleSchema);
