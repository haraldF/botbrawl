import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';

/** Draws planned move/shoot indicators for the human player's bots. */
export class PlanRenderer {
    private graphics?: Phaser.GameObjects.Graphics;
    private indicators?: Phaser.GameObjects.Group;

    constructor(private readonly scene: Phaser.Scene) {}

    create(): void {
        this.graphics = this.scene.add.graphics();
        this.indicators = this.scene.add.group();
    }

    clear(): void {
        this.graphics?.clear();
        this.indicators?.clear(true, true);
    }

    render(bots: Bot[]): void {
        if (!this.graphics || !this.indicators) return;
        this.clear();
        for (const bot of bots) {
            if (bot.action.type === 'move') this.renderMovePlan(bot);
            else if (bot.action.type === 'shoot') this.renderShootPlan(bot);
            else if (bot.action.type === 'sniper') this.renderSniperPlan(bot);
        }
    }

    private renderMovePlan(bot: Bot): void {
        const color = GameConfig.PLAN_MOVE_COLOR;
        const rawTarget = bot.action.target ?? new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
        const target = this.clampToVisibleArea(rawTarget.x, rawTarget.y, GameConfig.MOVE_INDICATOR_RADIUS);
        const g = this.graphics!;

        g.lineStyle(2, color, 0.7);
        g.strokeLineShape(new Phaser.Geom.Line(bot.sprite.x, bot.sprite.y, target.x, target.y));
        g.fillStyle(color, 0.25);
        g.fillCircle(target.x, target.y, 8);
        g.lineStyle(1.5, color, 0.9);
        g.strokeCircle(target.x, target.y, 10);

        this.addInteractiveIndicator(bot, target.x, target.y, GameConfig.MOVE_INDICATOR_RADIUS);
    }

    private renderShootPlan(bot: Bot): void {
        const color = GameConfig.PLAN_SHOOT_COLOR;
        const maxBulletDistance = Math.min(this.scene.scale.width, this.scene.scale.height) / 2;
        const direction = bot.action.direction.clone().normalize();
        const start = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y)
            .add(direction.clone().scale(GameConfig.SHOT_START_OFFSET));
        const rawEnd = start.clone().add(direction.clone().scale(maxBulletDistance));
        const end = this.clampToVisibleArea(rawEnd.x, rawEnd.y, GameConfig.SHOOT_INDICATOR_RADIUS);
        const g = this.graphics!;

        g.lineStyle(2, color, 0.7);
        g.strokeLineShape(new Phaser.Geom.Line(bot.sprite.x, bot.sprite.y, end.x, end.y));
        g.fillStyle(color, 0.4);
        g.fillCircle(end.x, end.y, 4);

        this.addInteractiveIndicator(bot, end.x, end.y, GameConfig.SHOOT_INDICATOR_RADIUS);
    }

    private renderSniperPlan(bot: Bot): void {
        const color = GameConfig.PLAN_SNIPER_COLOR;
        const baseRange = Math.min(this.scene.scale.width, this.scene.scale.height) / 2;
        const maxBulletDistance = baseRange * GameConfig.SNIPER_RANGE_MULTIPLIER;
        const direction = bot.action.direction.clone().normalize();
        const start = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y)
            .add(direction.clone().scale(GameConfig.SHOT_START_OFFSET));
        const rawEnd = start.clone().add(direction.clone().scale(maxBulletDistance));
        const end = this.clampToVisibleArea(rawEnd.x, rawEnd.y, GameConfig.SHOOT_INDICATOR_RADIUS);
        const g = this.graphics!;

        // Thin precise beam.
        g.lineStyle(1, color, 0.95);
        g.strokeLineShape(new Phaser.Geom.Line(start.x, start.y, end.x, end.y));

        // Crosshair at the target end.
        const crosshairRadius = 10;
        g.lineStyle(1.5, color, 1);
        g.strokeCircle(end.x, end.y, crosshairRadius);
        g.strokeLineShape(new Phaser.Geom.Line(end.x - crosshairRadius - 4, end.y, end.x - crosshairRadius + 2, end.y));
        g.strokeLineShape(new Phaser.Geom.Line(end.x + crosshairRadius - 2, end.y, end.x + crosshairRadius + 4, end.y));
        g.strokeLineShape(new Phaser.Geom.Line(end.x, end.y - crosshairRadius - 4, end.x, end.y - crosshairRadius + 2));
        g.strokeLineShape(new Phaser.Geom.Line(end.x, end.y + crosshairRadius - 2, end.x, end.y + crosshairRadius + 4));
        g.fillStyle(color, 0.9);
        g.fillCircle(end.x, end.y, 2);

        this.addInteractiveIndicator(bot, end.x, end.y, GameConfig.SHOOT_INDICATOR_RADIUS);
    }

    private addInteractiveIndicator(bot: Bot, x: number, y: number, baseRadius: number): void {
        const radius = baseRadius * (window.devicePixelRatio || 1);
        const indicator = this.scene.add.circle(x, y, radius);
        indicator.setData('isIndicator', true);
        indicator.setData('bot', bot);
        indicator.setInteractive();
        this.indicators!.add(indicator);
    }

    /** Clamp a point so the indicator stays inside the visible viewport. */
    private clampToVisibleArea(x: number, y: number, _indicatorRadius: number): Phaser.Math.Vector2 {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        return new Phaser.Math.Vector2(
            Phaser.Math.Clamp(x, 0, width),
            Phaser.Math.Clamp(y, 0, height)
        );
    }
}
