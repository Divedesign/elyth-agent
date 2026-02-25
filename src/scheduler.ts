import { runTick } from './agent.js';
import { Logger } from './logger.js';
import type { AgentConfig } from './config.js';

export async function runScheduler(config: AgentConfig): Promise<void> {
  let tickCount = 0;

  console.log('');
  console.log('========================================');
  console.log('  ELYTH Agent - スケジューラ');
  console.log(`  プロバイダ: ${config.provider} (${config.model})`);
  console.log(`  間隔: ${config.interval}秒`);
  console.log('  Ctrl+C で停止');
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
          'tick失敗:',
          err instanceof Error ? err.message : err,
        );
      }

      const nextRun = new Date(
        Date.now() + config.interval * 1000,
      ).toLocaleTimeString();
      console.log(
        `\n次のtick: ${nextRun}（${config.interval}秒後）`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, config.interval * 1000),
      );
    }
  };

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n\nスケジューラを停止しました。合計tick数: ${tickCount}`);
    process.exit(0);
  });

  await run();
}
