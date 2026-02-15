// Main entry with startup queue process
const { processPending } = require('./.slashbot/init-queue');
require('dotenv').config(); // Assume if needed

async function start() {
  console.log('Starting Slashbot...');
  await processPending();
  console.log('Startup complete.'); // In real: start server/agent loop
}

start().catch(console.error);