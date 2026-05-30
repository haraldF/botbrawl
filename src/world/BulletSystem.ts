import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';

export type BulletSprite = Phaser.Physics.Arcade.Image & { ownerBot?: Bot };

export type BotHitHandler = (bot: Bot, bullet: BulletSprite) => void;

const BULLETS_PER_SHOT = 3;

/** Owns the bullet particle group, spawning, lifetime, and collision wiring. */
export class BulletSystem {
    private particles?: Phaser.Physics.Arcade.Group;

    constructor(private readonly scene: Phaser.Scene) {}

    initialize(
        bots: Bot[],
        barriers: Phaser.Physics.Arcade.StaticGroup,
        onBotHit: BotHitHandler
    ): void {
        const particles = this.scene.physics.add.group({
            defaultKey: GameConfig.PARTICLE_TEXTURE,
            maxSize: 200,
        });
        this.particles = particles;

        const botSprites = bots.map(bot => bot.sprite);
        this.scene.physics.add.overlap(particles, botSprites, (a, b) =>
            this.handleBulletBotOverlap(a, b, bots, onBotHit)
        );

        const destroyBullet: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (obj) =>
            this.destroyBullet(obj as BulletSprite);
        this.scene.physics.add.collider(particles, barriers, destroyBullet);
        this.scene.physics.add.overlap(particles, barriers, destroyBullet);
    }

    spawnShot(bot: Bot): void {
        if (!this.particles) return;

        const baseDirection = bot.action.direction.clone().normalize();
        const speed = GameConfig.SHOT_SPEED;
        const startOffset = GameConfig.SHOT_START_OFFSET;
        const maxBulletDistance = Math.min(this.scene.scale.width, this.scene.scale.height) / 2;
        const lifetimeMs = (maxBulletDistance / speed) * 1000;

        for (let i = 0; i < BULLETS_PER_SHOT; i++) {
            const spread = Phaser.Math.FloatBetween(
                -GameConfig.SHOT_SPREAD_DEGREES,
                GameConfig.SHOT_SPREAD_DEGREES
            );
            const direction = baseDirection.clone().rotate(Phaser.Math.DegToRad(spread));
            this.spawnBullet(bot, direction, startOffset, speed, lifetimeMs);
        }
    }

    spawnSniperShot(bot: Bot): void {
        if (!this.particles) return;

        const baseDirection = bot.action.direction.clone().normalize();
        const speed = GameConfig.SHOT_SPEED;
        const startOffset = GameConfig.SHOT_START_OFFSET;
        const baseRange = Math.min(this.scene.scale.width, this.scene.scale.height) / 2;
        const maxBulletDistance = baseRange * GameConfig.SNIPER_RANGE_MULTIPLIER;
        const lifetimeMs = (maxBulletDistance / speed) * 1000;

        for (let i = 0; i < GameConfig.SNIPER_BULLETS_PER_SHOT; i++) {
            const spread = GameConfig.SNIPER_SHOT_SPREAD_DEGREES === 0
                ? 0
                : Phaser.Math.FloatBetween(
                    -GameConfig.SNIPER_SHOT_SPREAD_DEGREES,
                    GameConfig.SNIPER_SHOT_SPREAD_DEGREES
                );
            const direction = baseDirection.clone().rotate(Phaser.Math.DegToRad(spread));
            this.spawnBullet(bot, direction, startOffset, speed, lifetimeMs);
        }
    }

    destroyBullet(bullet: BulletSprite): void {
        if (!bullet.active) return;
        delete bullet.ownerBot;
        bullet.destroy();
    }

    clearAll(): void {
        if (!this.particles) return;
        this.particles.getChildren().forEach(child => {
            const bullet = child as BulletSprite;
            delete bullet.ownerBot;
            bullet.destroy();
        });
        this.particles.clear(true, true);
    }

    private spawnBullet(
        bot: Bot,
        direction: Phaser.Math.Vector2,
        startOffset: number,
        speed: number,
        lifetimeMs: number
    ): void {
        const startX = bot.sprite.x + direction.x * startOffset;
        const startY = bot.sprite.y + direction.y * startOffset;
        const bullet = this.particles!.get(startX, startY, GameConfig.PARTICLE_TEXTURE) as BulletSprite | null;
        if (!bullet) return;

        bullet.setActive(true);
        bullet.setVisible(true);
        bullet.setScale(GameConfig.PARTICLE_SCALE);
        bullet.setDepth(5);
        bullet.setCollideWorldBounds(true);
        bullet.ownerBot = bot;
        bullet.setVelocity(direction.x * speed, direction.y * speed);

        this.scene.time.delayedCall(lifetimeMs, () => this.destroyBullet(bullet));
    }

    private handleBulletBotOverlap(
        a: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
        b: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
        bots: Bot[],
        onBotHit: BotHitHandler
    ): void {
        const bulletA = a as BulletSprite;
        const bulletB = b as BulletSprite;
        const bullet = bulletA.ownerBot ? bulletA : bulletB.ownerBot ? bulletB : undefined;
        if (!bullet) return;

        const otherSprite = bullet === bulletA ? b : a;
        const targetBot = bots.find(candidate => candidate.sprite === otherSprite);
        if (targetBot) onBotHit(targetBot, bullet);
    }
}
