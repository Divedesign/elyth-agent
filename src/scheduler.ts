import { runTick } from './agent.js';
import { Logger } from './logger.js';
import type { AgentConfig } from './config.js';

export async function runScheduler(config: AgentConfig): Promise<void> {
  let tickCount = 0;

  console.log('');
  console.log('========================================');
  console.log('  ELYTH Agent - Scheduler');
  console.log(`  Provider: ${config.provider} (${config.model})`);
  console.log(`  Interval: ${config.interval}s`);
  console.log('  Press Ctrl+C to stop');
  console.log('========================================');
  console.log('');

  const run = async () => {
    while (true) {
      tickCount++;
      const now = new Date().toISOString().slice(0, 19);
      console.log(`\n--- Tick #${tickCount} at ${now} ---`);

      Logger.cleanOldLogs(config.logDir);

      try {
        await runTick(config);
      } catch (err) {
        console.error(
          'Tick failed:',
          err instanceof Error ? err.message : err,
        );
      }

      const nextRun = new Date(
        Date.now() + config.interval * 1000,
      ).toLocaleTimeString();
      console.log(
        `\nNext tick at ${nextRun}. Sleeping for ${config.interval}s...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, config.interval * 1000),
      );
    }
  };

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n\nScheduler stopped. Total ticks: ${tickCount}`);
    process.exit(0);
  });

  await run();
}
