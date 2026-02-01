class Scene extends Phaser.Scene
{
    create() {
        this.cameras.main.setBackgroundColor('#000');
    }
}

const config = {
    type: Phaser.AUTO,
    scene: Scene,
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    }
};

const game = new Phaser.Game(config);
