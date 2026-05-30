import { GameConfig } from '../GameConfig.js';

/** Ensures all in-game textures exist. Idempotent. */
export class TextureFactory {
    constructor(private readonly scene: Phaser.Scene) {}

    ensureAllTextures(): void {
        this.ensureBarrierTexture();
        this.ensureBotTextures();
    }

    private ensureBarrierTexture(): void {
        if (this.scene.textures.exists(GameConfig.BARRIER_TEXTURE)) return;
        const g = this.scene.add.graphics();
        g.fillStyle(GameConfig.BARRIER_COLOR, 0.95);
        g.fillRect(0, 0, GameConfig.BARRIER_WIDTH, GameConfig.BARRIER_HEIGHT);
        g.generateTexture(GameConfig.BARRIER_TEXTURE, GameConfig.BARRIER_WIDTH, GameConfig.BARRIER_HEIGHT);
        g.destroy();
    }

    private ensureBotTextures(): void {
        this.ensureCircleTexture(GameConfig.BOT_PLAYER_TEXTURE, GameConfig.BOT_PLAYER_COLOR);
        this.ensureCircleTexture(GameConfig.BOT_AI_TEXTURE, GameConfig.BOT_AI_COLOR);
        this.ensureCircleTexture(GameConfig.PARTICLE_TEXTURE, GameConfig.PARTICLE_COLOR);
    }

    private ensureCircleTexture(key: string, color: number): void {
        if (this.scene.textures.exists(key)) return;
        const g = this.scene.add.graphics();
        g.fillStyle(color, 1);
        g.fillCircle(12, 12, 12);
        g.generateTexture(key, 24, 24);
        g.destroy();
    }
}
