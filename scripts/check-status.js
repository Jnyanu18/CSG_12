require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 25000 }).then(async () => {
  const c = mongoose.connection.db.collection('interactions');
  const total   = await c.countDocuments({});
  const batch   = await c.countDocuments({ userId: 'batch_kaggle' });
  const withGT  = await c.countDocuments({ 'actualOutcome.actualValue': { $exists: true } });
  const adapters = await mongoose.connection.db.collection('micro_adapters').countDocuments({});
  console.log('Total interactions :', total);
  console.log('Batch (kaggle)     :', batch);
  console.log('With ground truth  :', withGT);
  console.log('Micro adapters     :', adapters);
  await mongoose.disconnect();
}).catch(function(e) { console.error('Error:', e.message); process.exit(1); });
