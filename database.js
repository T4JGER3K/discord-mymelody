
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Połączono z MongoDB'))
.catch(err => console.error('❌ Błąd połączenia z MongoDB:', err));
