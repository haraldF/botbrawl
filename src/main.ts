import { GameConfig } from './GameConfig.js';
import { GameScene } from './scene/GameScene.js';

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    scene: GameScene,
    input: { keyboard: true },
    physics: {
        default: 'arcade',
        arcade: { debug: false },
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GameConfig.GAME_WIDTH,
        height: GameConfig.GAME_HEIGHT,
        fullscreenTarget: 'game-container',
    },
};

new Phaser.Game(config);

window.addEventListener('resize', () => {
    setTimeout(() => window.scrollTo(0, 0), 100);
});


