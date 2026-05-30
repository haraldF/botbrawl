import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';
import { planAiActions } from '../planAIActions.js';
import { BulletSystem } from '../world/BulletSystem.js';

export interface RoundDependencies {
    playerBots: Bot[];
    aiBots: Bot[];
    allBots: Bot[];
    barriers: Phaser.Physics.Arcade.StaticGroup;
}

/** Runs a single planning -> execution -> cleanup cycle. */
export class RoundController {
    private readonly roundDurationMs = GameConfig.ROUND_DURATION_MS;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly bullets: BulletSystem
    ) {}

    start(deps: RoundDependencies, onRoundEnded: () => void): void {
        this.resetPlayerSizes(deps.playerBots);
        planAiActions(
            deps.playerBots,
            deps.aiBots,
            deps.barriers,
            GameConfig.MAX_MOVE_DISTANCE,
            GameConfig.SHOOT_PREVIEW_LENGTH
        );
        this.executeActions(deps.allBots);
        this.scene.time.delayedCall(this.roundDurationMs, () => {
            this.cleanupRound(deps.allBots);
            onRoundEnded();
        });
    }

    private resetPlayerSizes(playerBots: Bot[]): void {
        playerBots.forEach(bot => bot.sprite.setScale(1));
    }

    private executeActions(bots: Bot[]): void {
        const durationSeconds = this.roundDurationMs / 1000;
        const fireDelayMs = this.roundDurationMs * GameConfig.SHOT_FIRE_DELAY_FRACTION;
        for (const bot of bots) {
            if (bot.isDisabled) continue;
            if (bot.action.type === 'move') {
                const speed = bot.action.distance / durationSeconds;
                bot.sprite.setVelocity(bot.action.direction.x * speed, bot.action.direction.y * speed);
            } else if (bot.action.type === 'shoot') {
                this.scene.time.delayedCall(fireDelayMs, () => this.bullets.spawnShot(bot));
            } else if (bot.action.type === 'sniper') {
                this.bullets.spawnSniperShot(bot);
            }
        }
    }

    private cleanupRound(bots: Bot[]): void {
        for (const bot of bots) {
            if (!bot.isAlive) continue;
            const usedSniper = bot.action.type === 'sniper';
            bot.sprite.setVelocity(0, 0);
            bot.action = { type: 'none', direction: new Phaser.Math.Vector2(1, 0), distance: 0 };
            delete bot.plannedMove;
            delete bot.plannedShoot;
            delete bot.plannedSniper;

            if (bot.isDisabled) {
                // The disable window covered this round; re-enable for next planning phase.
                bot.isDisabled = false;
                bot.sprite.setAlpha(1);
            } else if (usedSniper) {
                // Sniper recoil: bot is out of commission for the next full round.
                bot.isDisabled = true;
                bot.selectedMode = 'move';
                bot.sprite.setAlpha(GameConfig.DISABLED_BOT_ALPHA);
            }
        }
        this.bullets.clearAll();
    }
}
