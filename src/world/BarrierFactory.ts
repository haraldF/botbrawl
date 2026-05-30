import { GameConfig } from '../GameConfig.js';

/** Builds the static barrier group placed between the two teams. */
export class BarrierFactory {
    constructor(private readonly scene: Phaser.Scene) {}

    create(): Phaser.Physics.Arcade.StaticGroup {
        const group = this.scene.physics.add.staticGroup();
        const fieldWidth = this.scene.scale.width;
        const fieldHeight = this.scene.scale.height;
        const minX = fieldWidth * GameConfig.BARRIER_MIN_X_FACTOR;
        const maxX = fieldWidth * GameConfig.BARRIER_MAX_X_FACTOR;
        const sliceWidth = (maxX - minX) / (GameConfig.BARRIER_COUNT - 1);
        const padding = GameConfig.BARRIER_PADDING;
        const halfHeight = GameConfig.BARRIER_HEIGHT / 2;

        for (let i = 0; i < GameConfig.BARRIER_COUNT; i++) {
            const x = minX + i * sliceWidth + Phaser.Math.Between(-16, 16);
            const y = Phaser.Math.Between(padding + halfHeight, fieldHeight - padding - halfHeight);
            const barrier = this.scene.physics.add.staticImage(x, y, GameConfig.BARRIER_TEXTURE);
            barrier.setOrigin(0.5, 0.5);
            group.add(barrier);
        }
        group.refresh();
        return group;
    }
}
