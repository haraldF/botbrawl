import type { Bot, BotAction } from '../Bot.js';

/** Pure logic for converting user input into a bot's planned action. */
export class ActionPlanner {
    constructor(
        private readonly maxMoveDistance: number,
        private readonly shootPreviewLength: number
    ) {}

    /** Switch between move/shoot mode, restoring the previously planned action for that mode. */
    toggleMode(bot: Bot): void {
        bot.selectedMode = bot.selectedMode === 'move' ? 'shoot' : 'move';
        this.syncActionWithMode(bot);
    }

    /** Plan a move/shoot from the current bot position toward a pointer location. */
    planFromPointer(bot: Bot, pointerX: number, pointerY: number): void {
        const origin = this.botOrigin(bot);
        const direction = this.directionFromOriginTo(origin, pointerX, pointerY);

        if (bot.selectedMode === 'move') {
            const distance = Math.min(
                this.maxMoveDistance,
                Phaser.Math.Distance.Between(origin.x, origin.y, pointerX, pointerY)
            );
            this.assignMoveAction(bot, origin, direction, distance);
        } else {
            this.assignShootAction(bot, origin, direction);
        }
    }

    private syncActionWithMode(bot: Bot): void {
        const previouslyPlanned = bot.selectedMode === 'move' ? bot.plannedMove : bot.plannedShoot;
        if (previouslyPlanned) {
            bot.action = this.cloneAction(previouslyPlanned);
            return;
        }

        const origin = this.botOrigin(bot);
        const direction = this.normalizedDirection(bot.action.direction);

        if (bot.selectedMode === 'move') {
            const fallbackTarget = bot.action.target
                ? bot.action.target.clone()
                : origin.clone().add(direction.clone().scale(this.maxMoveDistance));
            const distance = Math.min(
                this.maxMoveDistance,
                Phaser.Math.Distance.Between(origin.x, origin.y, fallbackTarget.x, fallbackTarget.y)
            );
            this.assignMoveAction(bot, origin, direction, distance);
        } else {
            this.assignShootAction(bot, origin, direction);
        }
    }

    private assignMoveAction(
        bot: Bot,
        origin: Phaser.Math.Vector2,
        direction: Phaser.Math.Vector2,
        distance: number
    ): void {
        const target = origin.clone().add(direction.clone().scale(distance));
        const action: BotAction = {
            type: 'move',
            direction: direction.clone(),
            distance,
            target,
        };
        bot.action = action;
        bot.plannedMove = this.cloneAction(action);
    }

    private assignShootAction(
        bot: Bot,
        origin: Phaser.Math.Vector2,
        direction: Phaser.Math.Vector2
    ): void {
        const target = origin.clone().add(direction.clone().scale(this.shootPreviewLength));
        const action: BotAction = {
            type: 'shoot',
            direction: direction.clone(),
            distance: 0,
            target,
        };
        bot.action = action;
        bot.plannedShoot = this.cloneAction(action);
    }

    private cloneAction(action: BotAction): BotAction {
        const clone: BotAction = {
            type: action.type,
            direction: action.direction.clone(),
            distance: action.distance,
        };
        if (action.target) clone.target = action.target.clone();
        return clone;
    }

    private botOrigin(bot: Bot): Phaser.Math.Vector2 {
        return new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
    }

    private directionFromOriginTo(origin: Phaser.Math.Vector2, x: number, y: number): Phaser.Math.Vector2 {
        const direction = new Phaser.Math.Vector2(x - origin.x, y - origin.y);
        if (direction.lengthSq() === 0) direction.set(1, 0);
        return direction.normalize();
    }

    private normalizedDirection(direction: Phaser.Math.Vector2): Phaser.Math.Vector2 {
        const result = direction.clone();
        if (result.lengthSq() === 0) result.set(1, 0);
        return result.normalize();
    }
}
