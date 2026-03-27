import dotenv from 'dotenv';
import { DiscordBot } from './interface/discord/bot.js'

dotenv.config();

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:');
  if (error instanceof Error) {
    console.error('  Message:', error.message);
    console.error('  Stack:', error.stack);
  } else {
    console.error('  Error:', error);
    console.error('  Type:', typeof error);
  }
  process.exit(1);
});

try {
  console.log('Starting application...');
  const bot = new DiscordBot();

  console.log('Logging in bot...');
  bot.login().catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down bot...');
    await bot.logout();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down bot...');
    await bot.logout();
    process.exit(0);
  });
} catch (error) {
  console.error('Error during startup:');
  if (error instanceof Error) {
    console.error('  Message:', error.message);
    console.error('  Stack:', error.stack);
  } else {
    console.error('  Error:', error);
    console.error('  Type:', typeof error);
  }
  process.exit(1);
}
