import { GameConfig } from '../GameConfig.js';

/** In-scene Phaser text elements: info HUD and win overlay. */
export class Hud {
    private infoText?: Phaser.GameObjects.Text;
    private winText?: Phaser.GameObjects.Text;

    constructor(private readonly scene: Phaser.Scene) {}

    create(): void {
        this.infoText = this.scene.add.text(
            16, 16, '',
            GameConfig.INFO_TEXT_STYLE as Phaser.Types.GameObjects.Text.TextStyle
        );
        this.infoText.setScrollFactor(0);
        // The DOM status element provides the same info; hide the in-scene HUD.
        this.infoText.setVisible(false);
    }

    setInfo(lines: string[]): void {
        this.infoText?.setText(lines);
    }

    showWin(message: string): void {
        if (this.winText) {
            this.winText.setText(message);
            this.winText.setVisible(true);
            return;
        }
        this.winText = this.scene.add.text(
            this.scene.scale.width / 2,
            this.scene.scale.height / 2,
            message,
            GameConfig.WIN_TEXT_STYLE as Phaser.Types.GameObjects.Text.TextStyle
        ).setOrigin(0.5);
    }

    hideWin(): void {
        this.winText?.setVisible(false);
    }
}
