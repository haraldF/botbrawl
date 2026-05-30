import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';
import { ActionPlanner } from './ActionPlanner.js';

export interface PlanInputContext {
    isPlanning: () => boolean;
    getPlayerBots: () => Bot[];
    canStartRound: () => boolean;
    requestStartRound: () => void;
    onPlanChanged: () => void;
}

/** Routes keyboard/pointer input into bot plans via the ActionPlanner. */
export class PlanInputController {
    private isDragging = false;
    private draggingBot?: Bot | undefined;
    private dragStart?: Phaser.Math.Vector2 | undefined;
    private isDraggingIndicator = false;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly planner: ActionPlanner,
        private readonly ctx: PlanInputContext
    ) {}

    bind(): void {
        this.scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.onKeyDown(event));
        this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) =>
            this.onPointerDown(p, objs)
        );
        this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
        this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (!this.ctx.isPlanning() || !this.ctx.canStartRound()) return;
        if (event.code === 'Space' || event.code === 'Enter') {
            this.ctx.requestStartRound();
            event.preventDefault();
        }
    }

    private onPointerDown(pointer: Phaser.Input.Pointer, hitObjects: Phaser.GameObjects.GameObject[]): void {
        if (!this.ctx.isPlanning()) return;

        const hitIndicator = hitObjects[0];
        if (hitIndicator?.getData('isIndicator')) {
            this.beginDrag(hitIndicator.getData('bot'), pointer, true);
            return;
        }
        const hitBot = this.findPlayerBotAt(pointer.worldX, pointer.worldY);
        if (hitBot) this.beginDrag(hitBot, pointer, false);
    }

    private onPointerMove(pointer: Phaser.Input.Pointer): void {
        if (!this.ctx.isPlanning() || !this.isDragging || !this.draggingBot || !this.dragStart) return;

        const distance = Phaser.Math.Distance.Between(
            this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY
        );
        const exceedsDragThreshold = distance >= GameConfig.DRAG_START_THRESHOLD;
        if (exceedsDragThreshold || this.isDraggingIndicator) {
            this.planner.planFromPointer(this.draggingBot, pointer.worldX, pointer.worldY);
            this.ctx.onPlanChanged();
        }
    }

    private onPointerUp(pointer: Phaser.Input.Pointer): void {
        if (this.ctx.isPlanning() && this.isDragging && this.dragStart) {
            const distance = Phaser.Math.Distance.Between(
                this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY
            );
            const wasTap = distance < GameConfig.DRAG_START_THRESHOLD;
            if (wasTap && !this.isDraggingIndicator) {
                const tappedBot = this.findPlayerBotAt(pointer.worldX, pointer.worldY);
                if (tappedBot?.isAlive) {
                    this.planner.toggleMode(tappedBot);
                    this.ctx.onPlanChanged();
                }
            }
        }
        this.resetDragState();
    }

    private beginDrag(bot: Bot, pointer: Phaser.Input.Pointer, fromIndicator: boolean): void {
        this.isDragging = true;
        this.draggingBot = bot;
        this.isDraggingIndicator = fromIndicator;
        this.dragStart = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
    }

    private resetDragState(): void {
        this.isDragging = false;
        this.draggingBot = undefined;
        this.dragStart = undefined;
        this.isDraggingIndicator = false;
    }

    private findPlayerBotAt(x: number, y: number): Bot | undefined {
        const tapRadius = this.tapRadiusForDevice();
        let best: Bot | undefined;
        let bestDistance = tapRadius + 1;

        for (const bot of this.ctx.getPlayerBots()) {
            if (!bot.isAlive) continue;
            const distance = Phaser.Math.Distance.Between(x, y, bot.sprite.x, bot.sprite.y);
            if (distance <= tapRadius && distance < bestDistance) {
                best = bot;
                bestDistance = distance;
            }
        }
        return best;
    }

    private tapRadiusForDevice(): number {
        const base = GameConfig.TAP_RADIUS_BASE;
        const ratio = window.devicePixelRatio || 1;
        return Math.max(base * ratio, base);
    }
}
