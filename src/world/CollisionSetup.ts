import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';

/** Configures bot-bot and bot-barrier collisions. */
export function setupBotCollisions(
    scene: Phaser.Scene,
    bots: Bot[],
    barriers: Phaser.Physics.Arcade.StaticGroup
): void {
    bots.forEach(bot => bot.sprite.setBounce(1, 1));

    for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
            scene.physics.add.collider(bots[i]!.sprite, bots[j]!.sprite);
        }
    }

    bots.forEach(bot => {
        scene.physics.add.collider(bot.sprite, barriers, undefined, (botObj) => {
            const image = botObj as Phaser.Physics.Arcade.Image;
            image.setBounce(GameConfig.BOT_BARRIER_BOUNCE, GameConfig.BOT_BARRIER_BOUNCE);
            return true;
        });
    });
}
